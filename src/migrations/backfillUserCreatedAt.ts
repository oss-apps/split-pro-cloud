import { type PrismaClient } from '@prisma/client';

import { getCreatedAtExactSince } from '~/server/userCreatedAt';

export const BACKFILL_BATCH_SIZE = 500;
const STATEMENT_TIMEOUT_MS = 5000;
const LOCK_TIMEOUT_MS = 2000;

type Db = Pick<PrismaClient, '$transaction' | '$queryRaw'>;

/**
 * Estimates `User.createdAt` for users from before the column existed, the rows still NULL.
 *
 * The estimate is the earliest of the timestamps that are written at the moment the user did or
 * was linked to something, so they already existed then:
 * - expenses they added (`addedBy`), notes they wrote, recurring rules they set up
 * - their balances and friendships, created when the user was first involved
 * - their push devices' `updatedAt` (a token moving to another user keeps its `createdAt`)
 * - their sessions' expiry minus 30 days, the shortest session length (app sessions last longer)
 * - `emailVerified`, set when they sign in by email
 * - feedback they sent from the app (imported feedback has external, email-matched times)
 * Left out because they can predate the user: expenses they only pay for or share (payers and
 * participants can be edited in later), groups they own (ownership moves when an owner leaves)
 * and group membership (no timestamp). Estimates are capped at when the column was added.
 *
 * Users with none of these stay NULL. Works through users in id order, `batchSize` per short
 * transaction, and only ever fills NULLs: safe to run again and never overwrites an exact time.
 */
export const backfillUserCreatedAt = async (
  db: Db,
  { batchSize = BACKFILL_BATCH_SIZE }: { batchSize?: number } = {},
) => {
  const cap = (await getCreatedAtExactSince(db)) ?? new Date();
  const capAt = cap.toISOString().slice(0, 23);

  let afterId = 0;
  let batches = 0;
  let updated = 0;

  for (;;) {
    const ids = (
      await db.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "User"
        WHERE "createdAt" IS NULL AND "id" > ${afterId}
        ORDER BY "id" LIMIT ${batchSize}
      `
    ).map(({ id }) => id);

    if (0 === ids.length) {
      return { batches, updated };
    }

    afterId = ids.at(-1)!;
    batches += 1;
    updated += await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`);
      return tx.$executeRaw`
        WITH "seen" AS (
          SELECT "addedBy" AS "userId", "createdAt" AS "at" FROM "Expense"
            WHERE "addedBy" = ANY(${ids})
          UNION ALL SELECT "createdById", "createdAt" FROM "ExpenseNote"
            WHERE "createdById" = ANY(${ids})
          UNION ALL SELECT "createdById", "createdAt" FROM "RecurringExpense"
            WHERE "createdById" = ANY(${ids})
          UNION ALL SELECT "userId", "createdAt" FROM "Balance" WHERE "userId" = ANY(${ids})
          UNION ALL SELECT "userId", "createdAt" FROM "Friendship" WHERE "userId" = ANY(${ids})
          UNION ALL SELECT "friendId", "createdAt" FROM "Friendship" WHERE "friendId" = ANY(${ids})
          UNION ALL SELECT "userId", "updatedAt" FROM "DevicePushToken" WHERE "userId" = ANY(${ids})
          UNION ALL SELECT "userId", "expires" - INTERVAL '30 days' FROM "Session"
            WHERE "userId" = ANY(${ids})
          UNION ALL SELECT "userId", "createdAt" FROM "Feedback"
            WHERE "userId" = ANY(${ids}) AND "source" <> 'import'
          UNION ALL SELECT "id", "emailVerified" FROM "User" WHERE "id" = ANY(${ids})
        ),
        "estimate" AS (
          SELECT "userId", LEAST(MIN("at"), ${capAt}::timestamp) AS "at"
          FROM "seen"
          WHERE "at" IS NOT NULL
          GROUP BY "userId"
        )
        UPDATE "User" u
        SET "createdAt" = e."at"
        FROM "estimate" e
        WHERE u."id" = e."userId" AND u."createdAt" IS NULL
      `;
    });
  }
};
