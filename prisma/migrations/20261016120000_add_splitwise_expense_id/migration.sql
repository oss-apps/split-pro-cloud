-- Expense is the largest table. Give up instead of queueing behind a long transaction, which
-- would block every query on Expense while waiting for its lock.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "splitwiseExpenseId" TEXT,
ADD COLUMN     "splitwisePart" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_splitwiseExpenseId_splitwisePart_key" ON "Expense"("splitwiseExpenseId", "splitwisePart");
