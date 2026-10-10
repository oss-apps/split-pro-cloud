-- CreateTable
CREATE TABLE "QuickSplit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickSplitPerson" (
    "id" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickSplitPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickSplitExpense" (
    "id" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidBy" TEXT NOT NULL,
    "splitAmong" TEXT[],
    "exact" INTEGER[],
    "isPayment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickSplitExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickSplitPerson_splitId_idx" ON "QuickSplitPerson"("splitId");

-- CreateIndex
CREATE INDEX "QuickSplitExpense_splitId_createdAt_idx" ON "QuickSplitExpense"("splitId", "createdAt");

-- AddForeignKey
ALTER TABLE "QuickSplitPerson" ADD CONSTRAINT "QuickSplitPerson_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "QuickSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickSplitExpense" ADD CONSTRAINT "QuickSplitExpense_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "QuickSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
