-- Expense is the largest table. Give up instead of queueing behind a long transaction, which
-- would block every query on Expense while waiting for its lock.
SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'LAST_DAY_OF_MONTH', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED');

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" SERIAL NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "timezone" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "nextOccurrenceDate" DATE NOT NULL,
    "nextOccurrenceAt" TIMESTAMP(3) NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "groupId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppMetadata" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppMetadata_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RecurringExpense_status_nextOccurrenceAt_idx" ON "RecurringExpense"("status", "nextOccurrenceAt");

-- CreateIndex
CREATE INDEX "RecurringExpense_groupId_idx" ON "RecurringExpense"("groupId");

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: nullable columns without a default, so existing rows are not rewritten.
ALTER TABLE "Expense" ADD COLUMN     "occurrenceDate" DATE,
ADD COLUMN     "recurringId" INTEGER;

-- AddForeignKey: every existing row is NULL, so the check below has nothing to find.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringId_occurrenceDate_key" ON "Expense"("recurringId", "occurrenceDate");

ALTER TABLE "Expense" VALIDATE CONSTRAINT "Expense_recurringId_fkey";
