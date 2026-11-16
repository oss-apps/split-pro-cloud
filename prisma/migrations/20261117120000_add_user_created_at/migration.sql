-- Users had no creation time. Add one, nullable: new rows get the time they are created, rows from
-- before this migration get an estimate (their earliest recorded activity) or stay null without any.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMP(3);

-- Backfill: the earliest timestamp tied to each user, in one UPDATE. Every source is at or after
-- the user existed, so the estimate errs late, never early:
-- - expense times are when it was added to SplitPro, not its expense date
-- - `emailVerified` is their latest email sign-in
-- - a session's `expires` minus 30 days (the shortest session length, web; app sessions last
--   180) is at or after it was last renewed; capped at now
-- Accounts (OAuth links) and verification tokens have no timestamps. Each table is read once and
-- grouped by user: most of these user columns have no index, so per-user lookups would scan.
WITH "firstSeen" AS (
    SELECT "userId", MIN("at") AS "at"
    FROM (
        SELECT "addedBy" AS "userId", "createdAt" AS "at" FROM "Expense"
        UNION ALL SELECT "paidBy", "createdAt" FROM "Expense"
        UNION ALL
            SELECT ep."userId", e."createdAt"
            FROM "ExpenseParticipant" ep
            JOIN "Expense" e ON e."id" = ep."expenseId"
        UNION ALL SELECT "createdById", "createdAt" FROM "ExpenseNote"
        UNION ALL SELECT "userId", "createdAt" FROM "Group"
        UNION ALL SELECT "userId", "createdAt" FROM "Friendship"
        UNION ALL SELECT "friendId", "createdAt" FROM "Friendship"
        UNION ALL SELECT "userId", "createdAt" FROM "Balance"
        UNION ALL SELECT "friendId", "createdAt" FROM "Balance"
        UNION ALL SELECT "createdById", "createdAt" FROM "RecurringExpense"
        UNION ALL SELECT "userId", "createdAt" FROM "DevicePushToken"
        UNION ALL SELECT "userId", "createdAt" FROM "Feedback"
        UNION ALL
            SELECT "userId", LEAST("expires" - INTERVAL '30 days', NOW() AT TIME ZONE 'UTC')
            FROM "Session"
        UNION ALL SELECT "id", "emailVerified" FROM "User"
    ) AS "seen"
    WHERE "userId" IS NOT NULL AND "at" IS NOT NULL
    GROUP BY "userId"
)
UPDATE "User" u
SET "createdAt" = f."at"
FROM "firstSeen" f
WHERE f."userId" = u."id";

-- Only rows created from now on get a default
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
