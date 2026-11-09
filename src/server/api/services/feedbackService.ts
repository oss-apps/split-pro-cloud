import { type Feedback, Prisma, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { db as defaultDb } from '~/server/db';
import { type FeedbackEmailDetails, sendFeedbackEmail } from '~/server/mailer';

const HOUR_MS = 60 * 60 * 1000;

export const FEEDBACK_MIN_LENGTH = 10;
export const FEEDBACK_MAX_LENGTH = 5000;
export const FEEDBACK_SOURCES = ['web', 'ios', 'android'] as const;

/** The same message from the same person within this window is a resend, not new feedback. */
export const DUPLICATE_WINDOW_MS = 24 * HOUR_MS;
export const FEEDBACK_RATE_LIMIT = { limit: 10, windowMs: HOUR_MS };

export const submitFeedbackInput = z.object({
  feedback: z.string().trim().min(FEEDBACK_MIN_LENGTH).max(FEEDBACK_MAX_LENGTH),
  /** One per draft, so retrying the same draft never saves it twice. */
  clientKey: z.string().uuid().optional(),
  source: z.enum(FEEDBACK_SOURCES).optional(),
  appVersion: z.string().trim().max(50).optional(),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInput>;

export type FeedbackSender = { id: number; email?: string | null; name?: string | null };

type Deps = {
  db: PrismaClient;
  notify: (feedback: FeedbackEmailDetails) => Promise<unknown>;
};

const defaultDeps: Deps = { db: defaultDb, notify: sendFeedbackEmail };

/**
 * Whether more feedback from someone who sent `recentCount` in the last rate limit window would
 * be too many.
 */
export const isOverFeedbackLimit = (recentCount: number) =>
  recentCount >= FEEDBACK_RATE_LIMIT.limit;

export const isUniqueViolation = (error: unknown, field: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  'P2002' === error.code &&
  JSON.stringify(error.meta?.target ?? '').includes(field);

/**
 * The feedback this submission repeats, if any: the same draft (`clientKey`), or the same message
 * from the same person within a day, which covers older apps that don't send a key.
 */
const findExisting = async (
  tx: Prisma.TransactionClient,
  userId: number,
  message: string,
  clientKey: string | undefined,
  now: Date,
) => {
  if (clientKey) {
    const byKey = await tx.feedback.findUnique({ where: { clientKey } });
    if (byKey) {
      if (byKey.userId !== userId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Feedback key already used' });
      }
      return byKey;
    }
  }

  return tx.feedback.findFirst({
    where: { userId, message, createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Saves feedback, then emails us about it without waiting. Resubmitting returns the saved
 * feedback instead of saving or emailing it again.
 */
export const submitFeedback = async (
  user: FeedbackSender,
  input: SubmitFeedbackInput,
  /** Where it came from when the client doesn't say: older app builds only send the message. */
  fallbackSource: 'web' | 'mobile',
  { db, notify }: Deps = defaultDeps,
): Promise<{ id: string; created: boolean }> => {
  if (!user.email) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add an email address to send feedback' });
  }

  const email = user.email;
  const message = input.feedback.trim();
  const now = new Date();

  let result: { feedback: Feedback; created: boolean };
  try {
    // Locking the sender's row makes their submissions one at a time, so two quick resends can't
    // both miss each other in the checks below.
    result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;

      const existing = await findExisting(tx, user.id, message, input.clientKey, now);
      if (existing) {
        return { feedback: existing, created: false };
      }

      const recentCount = await tx.feedback.count({
        where: {
          userId: user.id,
          createdAt: { gte: new Date(now.getTime() - FEEDBACK_RATE_LIMIT.windowMs) },
        },
      });
      if (isOverFeedbackLimit(recentCount)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too much feedback at once. Try again in an hour.',
        });
      }

      const feedback = await tx.feedback.create({
        data: {
          userId: user.id,
          email,
          name: user.name ?? null,
          message,
          source: input.source ?? fallbackSource,
          // An empty version is no version
          appVersion: input.appVersion ? input.appVersion : null,
          clientKey: input.clientKey ?? null,
        },
      });
      return { feedback, created: true };
    });
  } catch (error) {
    if (!input.clientKey || !isUniqueViolation(error, 'clientKey')) {
      throw error;
    }

    const existing = await db.feedback.findUnique({ where: { clientKey: input.clientKey } });
    if (existing?.userId !== user.id) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Feedback key already used' });
    }
    result = { feedback: existing, created: false };
  }

  const { feedback, created } = result;
  if (created) {
    notify(feedback).catch((error) =>
      console.error('Failed to email feedback', feedback.id, error),
    );
  }

  return { id: feedback.id, created };
};
