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

-- Records everyone with a balance from the balance-only import, so no history is imported for
-- them on top of it, even once the rows are gone (removing a settled friend deletes them). This
-- can't prove someone never had a balance-only import: rows deleted before it ran leave no trace.
-- What makes turning history on safe is the balance check of each import (balanceConsistency.ts),
-- which refuses a pair whose stored balance doesn't match its expenses. These marks, and the
-- import's check of importedFromSplitwise rows, are an extra layer.
INSERT INTO "SplitwiseImportPerson" ("userId", "mode")
SELECT "userId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
UNION
SELECT "friendId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
ON CONFLICT DO NOTHING;

COMMIT;
