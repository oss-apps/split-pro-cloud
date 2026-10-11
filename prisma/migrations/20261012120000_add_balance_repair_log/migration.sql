-- CreateTable
CREATE TABLE "BalanceRepairLog" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "groupId" INTEGER,
    "currency" TEXT,
    "expenseId" TEXT,
    "userId" INTEGER NOT NULL,
    "friendId" INTEGER,
    "before" INTEGER,
    "delta" INTEGER NOT NULL,
    "after" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceRepairLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceRepairLog_runId_scope_idx" ON "BalanceRepairLog"("runId", "scope");

