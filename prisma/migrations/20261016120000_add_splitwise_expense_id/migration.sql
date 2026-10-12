-- All or nothing: a failure part way (e.g. the lock timeout below) leaves no columns behind.
BEGIN;

-- Expense is the largest table. Give up instead of queueing behind a long transaction, which
-- would block every query on Expense while waiting for its lock.
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "SplitwiseImportMode" AS ENUM ('BALANCE', 'HISTORY');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "splitwiseExpenseId" TEXT,
ADD COLUMN     "splitwisePart" INTEGER,
ADD COLUMN     "splitwiseScope" TEXT;

-- CreateTable
CREATE TABLE "SplitwiseImportPerson" (
    "userId" INTEGER NOT NULL,
    "mode" "SplitwiseImportMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitwiseImportPerson_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SplitwiseImportLock" (
    "key" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitwiseImportLock_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_splitwiseExpenseId_splitwiseScope_splitwisePart_key" ON "Expense"("splitwiseExpenseId", "splitwiseScope", "splitwisePart");

-- Everyone with a balance from the balance-only import keeps it, so no history can be imported
-- for them on top of it. The flag can disappear later (removing a settled friend deletes the
-- rows), so it is recorded here once. Importing history stays off until it is turned on (see the
-- PR), and turning it on runs this again for anything written in the meantime.
INSERT INTO "SplitwiseImportPerson" ("userId", "mode")
SELECT "userId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
UNION
SELECT "friendId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
ON CONFLICT DO NOTHING;

COMMIT;
