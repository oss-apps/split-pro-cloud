import {
  type FeedbackReply,
  FeedbackReplyStatus,
  FeedbackStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { z } from 'zod';

import { db as defaultDb } from '~/server/db';
import { MailNotSentError, sendFeedbackReplyEmail } from '~/server/mailer';

import { isUniqueViolation } from './feedbackService';

/**
 * Reviewing and replying to feedback, for the internal admin API.
 */

export const FEEDBACK_LIST_MAX = 200;
export const FEEDBACK_IMPORT_MAX = 500;
const IMPORTED_MESSAGE_MAX = 50_000;
const REPLY_MAX = 20_000;
/** Reserving a reply retries this often when another request changes it meanwhile. */
const RESERVE_ATTEMPTS = 3;

export class FeedbackNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}
/** A reply with this key is being sent, or it's unknown whether it went: not sending it again. */
export class ReplyInProgressError extends Error {}

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

const replySelect = {
  id: true,
  message: true,
  idempotencyKey: true,
  deliveryStatus: true,
  sentAt: true,
  createdAt: true,
} satisfies Prisma.FeedbackReplySelect;

const feedbackInclude = {
  user: { select: { id: true, name: true, email: true, deletedAt: true } },
  replies: { select: replySelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FeedbackInclude;

type FeedbackWithDetails = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>;
type ReplyDetails = Pick<FeedbackReply, keyof typeof replySelect>;

const toReplyJson = (reply: ReplyDetails) => ({
  id: reply.id,
  message: reply.message,
  idempotencyKey: reply.idempotencyKey,
  deliveryStatus: reply.deliveryStatus,
  sentAt: reply.sentAt?.toISOString() ?? null,
  createdAt: reply.createdAt.toISOString(),
});

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

type Reservation =
  | { send: false; reply: ReplyDetails }
  | { send: true; reply: ReplyDetails; to: string; original: string };

/**
 * Claims the reply with this key for sending, or finds that it was sent. Each step is a single
 * atomic write (the unique key on insert, a conditional update from FAILED), so only one request
 * ever holds a reply in SENDING, and nothing stays locked while the email goes out.
 */
const reserveReply = async (
  db: PrismaClient,
  id: string,
  message: string,
  idempotencyKey: string,
  attempt = 1,
): Promise<Reservation> => {
  const retry = () => {
    if (RESERVE_ATTEMPTS <= attempt) {
      throw new ReplyInProgressError('Delivery in progress or uncertain; not resending');
    }
    return reserveReply(db, id, message, idempotencyKey, attempt + 1);
  };

  const feedback = await db.feedback.findUnique({
    where: { id },
    select: { message: true, email: true, user: { select: { email: true } } },
  });
  if (!feedback) {
    throw new FeedbackNotFoundError('Feedback not found');
  }
  const target = { to: feedback.user?.email ?? feedback.email, original: feedback.message };

  const existing = await db.feedbackReply.findUnique({
    where: { idempotencyKey },
    select: { ...replySelect, feedbackId: true },
  });

  if (!existing) {
    try {
      const reply = await db.feedbackReply.create({
        data: { feedbackId: id, message, idempotencyKey },
        select: replySelect,
      });
      return { send: true, reply, ...target };
    } catch (error) {
      // Another request took the key first: look again at what it did
      if (isUniqueViolation(error, 'idempotencyKey')) {
        return retry();
      }
      throw error;
    }
  }

  if (existing.feedbackId !== id) {
    throw new IdempotencyConflictError('idempotencyKey was used for other feedback');
  }
  if (FeedbackReplyStatus.SENT === existing.deliveryStatus) {
    return { send: false, reply: existing };
  }
  if (FeedbackReplyStatus.SENDING === existing.deliveryStatus) {
    throw new ReplyInProgressError('Delivery in progress or uncertain; not resending');
  }

  // FAILED certainly wasn't sent: claim it again, unless another retry just did
  const { count } = await db.feedbackReply.updateMany({
    where: { id: existing.id, deliveryStatus: FeedbackReplyStatus.FAILED },
    data: { deliveryStatus: FeedbackReplyStatus.SENDING, message },
  });
  if (0 === count) {
    return retry();
  }
  return {
    send: true,
    reply: { ...existing, message, deliveryStatus: FeedbackReplyStatus.SENDING },
    ...target,
  };
};

type ReplyDeps = { db: PrismaClient; send: typeof sendFeedbackReplyEmail };

/**
 * Emails a reply to whoever sent the feedback and records it, at most once per `idempotencyKey`.
 *
 * The reply is reserved as SENDING first, then the email is sent outside any transaction. When it
 * certainly failed, the reply is marked FAILED and the same key can be retried; when it's uncertain
 * (e.g. the connection dropped mid-send) it stays SENDING and isn't sent again. Throws
 * `MailNotSentError` in both cases, and `ReplyInProgressError` for a key that's SENDING.
 */
export const replyToFeedback = async (
  id: string,
  { message, idempotencyKey }: z.infer<typeof replyBody>,
  { db, send }: ReplyDeps = { db: defaultDb, send: sendFeedbackReplyEmail },
) => {
  const reservation = await reserveReply(db, id, message, idempotencyKey);
  if (!reservation.send) {
    return { reply: toReplyJson(reservation.reply), created: false };
  }

  try {
    await send({ to: reservation.to, reply: message, original: reservation.original });
  } catch (error) {
    if (error instanceof MailNotSentError && error.definite) {
      await db.feedbackReply.update({
        where: { id: reservation.reply.id },
        data: { deliveryStatus: FeedbackReplyStatus.FAILED },
      });
    }
    throw error;
  }

  const [reply] = await db.$transaction([
    db.feedbackReply.update({
      where: { id: reservation.reply.id },
      data: { deliveryStatus: FeedbackReplyStatus.SENT, sentAt: new Date() },
      select: replySelect,
    }),
    db.feedback.updateMany({ where: { id }, data: { status: FeedbackStatus.REPLIED } }),
  ]);
  return { reply: toReplyJson(reply), created: true };
};

type ImportItem = z.infer<typeof importBody>['items'][number];
type ImportOutcome = 'created' | 'skipped' | 'unmatched';

/**
 * Imports one item for a live account with its email, in a transaction that holds that account
 * against deletion until the feedback is saved.
 */
const importItem = async (db: PrismaClient, item: ImportItem): Promise<ImportOutcome> => {
  try {
    return await db.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "User"
        WHERE lower(email) = lower(${item.email}) AND "deletedAt" IS NULL
        ORDER BY id LIMIT 1 FOR SHARE`;
      if (!user) {
        return 'unmatched';
      }

      const existing = await tx.feedback.findUnique({
        where: { externalId: item.externalId },
        select: { id: true },
      });
      if (existing) {
        return 'skipped';
      }

      const replies = item.replies ?? [];
      await tx.feedback.create({
        data: {
          externalId: item.externalId,
          userId: user.id,
          email: item.email,
          message: item.message,
          source: 'import',
          status: 0 < replies.length ? FeedbackStatus.REPLIED : FeedbackStatus.NEW,
          createdAt: new Date(item.createdAt),
          replies: {
            create: replies.map((reply) => ({
              message: reply.message,
              idempotencyKey: reply.idempotencyKey,
              deliveryStatus: FeedbackReplyStatus.SENT,
              sentAt: new Date(reply.sentAt),
              createdAt: new Date(reply.sentAt),
            })),
          },
        },
      });
      return 'created';
    });
  } catch (error) {
    // Imported meanwhile by another run
    if (isUniqueViolation(error, 'externalId')) {
      return 'skipped';
    }
    throw error;
  }
};

/**
 * Adds feedback from before it was saved here, e.g. from the feedback emails. Only feedback from
 * an existing, not deleted, account is imported: anything else is counted as `unmatched` and not
 * stored, so feedback of deleted accounts doesn't come back. Items already imported (by
 * `externalId`) are skipped, so it's safe to run again.
 */
export const importFeedback = async (
  { items }: z.infer<typeof importBody>,
  db: PrismaClient = defaultDb,
) => {
  const counts: Record<ImportOutcome, number> = { created: 0, skipped: 0, unmatched: 0 };

  // One at a time keeps the counts exact when the same externalId appears twice in a batch.
  await items.reduce(async (previous, item) => {
    await previous;
    counts[await importItem(db, item)] += 1;
  }, Promise.resolve());

  return counts;
};
