import { FeedbackStatus, Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { db as defaultDb } from '~/server/db';
import { sendFeedbackReplyEmail } from '~/server/mailer';

import { isUniqueViolation } from './feedbackService';

/**
 * Reviewing and replying to feedback, for the internal admin API.
 */

export const FEEDBACK_LIST_MAX = 200;
export const FEEDBACK_IMPORT_MAX = 500;
const IMPORTED_MESSAGE_MAX = 50_000;
const REPLY_MAX = 20_000;
/** Replies send their email inside the transaction, so allow for a slow SMTP server. */
const REPLY_TRANSACTION_TIMEOUT_MS = 30_000;

export class FeedbackNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

const statusSchema = z.nativeEnum(FeedbackStatus);

export const listFeedbackQuery = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(FEEDBACK_LIST_MAX).default(50),
  cursor: z.string().min(1).optional(),
});

export const replyBody = z.object({
  message: z.string().trim().min(1).max(REPLY_MAX),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const statusBody = z.object({ status: statusSchema });

export const importBody = z.object({
  items: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(500),
        email: z.string().trim().email(),
        message: z.string().trim().min(1).max(IMPORTED_MESSAGE_MAX),
        createdAt: z.string().datetime({ offset: true }),
        source: z.literal('import').optional(),
        replies: z
          .array(
            z.object({
              message: z.string().trim().min(1).max(REPLY_MAX),
              sentAt: z.string().datetime({ offset: true }),
              idempotencyKey: z.string().trim().min(1).max(200),
            }),
          )
          .optional(),
      }),
    )
    .max(FEEDBACK_IMPORT_MAX),
});

const feedbackInclude = {
  user: { select: { id: true, name: true, email: true, deletedAt: true } },
  replies: {
    select: { id: true, message: true, idempotencyKey: true, sentAt: true },
    orderBy: { sentAt: 'asc' },
  },
} satisfies Prisma.FeedbackInclude;

type FeedbackWithDetails = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>;

const toFeedbackJson = (feedback: FeedbackWithDetails) => ({
  id: feedback.id,
  createdAt: feedback.createdAt.toISOString(),
  updatedAt: feedback.updatedAt.toISOString(),
  status: feedback.status,
  source: feedback.source,
  appVersion: feedback.appVersion,
  message: feedback.message,
  email: feedback.email,
  name: feedback.name,
  user: feedback.user
    ? {
        id: feedback.user.id,
        name: feedback.user.name,
        email: feedback.user.email,
        deletedAt: feedback.user.deletedAt?.toISOString() ?? null,
      }
    : null,
  replies: feedback.replies.map(toReplyJson),
});

const toReplyJson = (reply: {
  id: string;
  message: string;
  idempotencyKey: string;
  sentAt: Date;
}) => ({
  id: reply.id,
  message: reply.message,
  idempotencyKey: reply.idempotencyKey,
  sentAt: reply.sentAt.toISOString(),
});

/**
 * Newest first. Pass the previous page's `nextCursor` as `cursor` for the next page.
 */
export const listFeedback = async (
  query: z.infer<typeof listFeedbackQuery>,
  db: PrismaClient = defaultDb,
) => {
  const rows = await db.feedback.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.since ? { createdAt: { gte: new Date(query.since) } } : {}),
    },
    include: feedbackInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const items = rows.slice(0, query.limit);
  return {
    items: items.map(toFeedbackJson),
    nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null,
  };
};

export const setFeedbackStatus = async (
  id: string,
  status: FeedbackStatus,
  db: PrismaClient = defaultDb,
) => {
  try {
    const feedback = await db.feedback.update({
      where: { id },
      data: { status },
      include: feedbackInclude,
    });
    return toFeedbackJson(feedback);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && 'P2025' === error.code) {
      throw new FeedbackNotFoundError('Feedback not found');
    }
    throw error;
  }
};

type ReplyDeps = { db: PrismaClient; send: typeof sendFeedbackReplyEmail };

/**
 * Emails a reply to whoever sent the feedback and records it. A reply with the same
 * `idempotencyKey` returns the recorded one without emailing again. Throws `MailNotSentError` and
 * records nothing when the email doesn't go out.
 */
export const replyToFeedback = async (
  id: string,
  { message, idempotencyKey }: z.infer<typeof replyBody>,
  { db, send }: ReplyDeps = { db: defaultDb, send: sendFeedbackReplyEmail },
) => {
  const run = () =>
    db.$transaction(
      async (tx) => {
        // One reply at a time per feedback, so a retried request waits and then finds the first.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Feedback" WHERE id = ${id} FOR UPDATE`;
        if (0 === locked.length) {
          throw new FeedbackNotFoundError('Feedback not found');
        }

        const existing = await tx.feedbackReply.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.feedbackId !== id) {
            throw new IdempotencyConflictError('idempotencyKey was used for other feedback');
          }
          return { reply: existing, created: false };
        }

        const feedback = await tx.feedback.findUniqueOrThrow({
          where: { id },
          include: { user: { select: { email: true } } },
        });

        await send({
          to: feedback.user?.email ?? feedback.email,
          reply: message,
          original: feedback.message,
        });

        const reply = await tx.feedbackReply.create({
          data: { feedbackId: id, message, idempotencyKey },
        });
        await tx.feedback.update({ where: { id }, data: { status: FeedbackStatus.REPLIED } });
        return { reply, created: true };
      },
      { timeout: REPLY_TRANSACTION_TIMEOUT_MS },
    );

  try {
    const { reply, created } = await run();
    return { reply: toReplyJson(reply), created };
  } catch (error) {
    // Another feedback's reply took the key between our check and insert
    if (isUniqueViolation(error, 'idempotencyKey')) {
      throw new IdempotencyConflictError('idempotencyKey was used for other feedback');
    }
    throw error;
  }
};

/**
 * Adds feedback from before it was saved here, e.g. from the feedback emails. Items already
 * imported (by `externalId`) are skipped, so it's safe to run again. Links each to the account with
 * the same email, if there is one.
 */
export const importFeedback = async (
  { items }: z.infer<typeof importBody>,
  db: PrismaClient = defaultDb,
) => {
  const counts = { created: 0, skipped: 0, linked: 0 };
  if (0 === items.length) {
    return counts;
  }

  const existing = await db.feedback.findMany({
    where: { externalId: { in: items.map((item) => item.externalId) } },
    select: { externalId: true },
  });
  const imported = new Set(existing.map((feedback) => feedback.externalId));

  const emails = [...new Set(items.map((item) => item.email.toLowerCase()))];
  const users = await db.$queryRaw<{ id: number; email: string }[]>`
    SELECT id, lower(email) AS email FROM "User"
    WHERE lower(email) IN (${Prisma.join(emails)}) AND "deletedAt" IS NULL
    ORDER BY id`;
  const userIdByEmail = new Map<string, number>();
  users.forEach((user) => {
    if (!userIdByEmail.has(user.email)) {
      userIdByEmail.set(user.email, user.id);
    }
  });

  // One at a time keeps the counts exact when the same externalId appears twice in a batch.
  await items.reduce(async (previous, item) => {
    await previous;

    if (imported.has(item.externalId)) {
      counts.skipped += 1;
      return;
    }

    const userId = userIdByEmail.get(item.email.toLowerCase()) ?? null;
    const replies = item.replies ?? [];
    try {
      await db.feedback.create({
        data: {
          externalId: item.externalId,
          userId,
          email: item.email,
          message: item.message,
          source: 'import',
          status: 0 < replies.length ? FeedbackStatus.REPLIED : FeedbackStatus.NEW,
          createdAt: new Date(item.createdAt),
          replies: {
            create: replies.map((reply) => ({
              message: reply.message,
              idempotencyKey: reply.idempotencyKey,
              sentAt: new Date(reply.sentAt),
            })),
          },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, 'externalId')) {
        imported.add(item.externalId);
        counts.skipped += 1;
        return;
      }
      throw error;
    }

    imported.add(item.externalId);
    counts.created += 1;
    if (null !== userId) {
      counts.linked += 1;
    }
  }, Promise.resolve());

  return counts;
};
