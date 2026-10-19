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
ADD COLUMN     "splitwiseScope" TEXT,
ADD COLUMN     "splitwiseEdited" BOOLEAN NOT NULL DEFAULT false;

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

-- An expense imported from Splitwise only counts as imported while nobody changed it in SplitPro.
-- Any update of the expense (edit, delete, restore, currency, group, repeat), and any insert,
-- update or delete of its participants, sets "splitwiseEdited" for good. The import's own insert
-- of participants, into an expense it inserted in the same transaction, leaves it untouched.
-- Triggers, so every way of writing these rows is covered, now and later.
CREATE FUNCTION "splitwise_expense_edited"() RETURNS trigger AS $$
BEGIN
  NEW."splitwiseEdited" := true;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "Expense_splitwise_edited"
BEFORE UPDATE ON "Expense"
FOR EACH ROW
WHEN (OLD."splitwiseExpenseId" IS NOT NULL OR NEW."splitwiseExpenseId" IS NOT NULL)
EXECUTE FUNCTION "splitwise_expense_edited"();

CREATE FUNCTION "splitwise_participants_edited"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Expense" e SET "splitwiseEdited" = true
    FROM (SELECT DISTINCT "expenseId" FROM new_rows) c
    WHERE e.id = c."expenseId" AND e."splitwiseExpenseId" IS NOT NULL AND NOT e."splitwiseEdited"
      AND e.xmin <> pg_current_xact_id()::xid;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE "Expense" e SET "splitwiseEdited" = true
    FROM (SELECT "expenseId" FROM old_rows UNION SELECT "expenseId" FROM new_rows) c
    WHERE e.id = c."expenseId" AND e."splitwiseExpenseId" IS NOT NULL AND NOT e."splitwiseEdited";
  ELSE
    UPDATE "Expense" e SET "splitwiseEdited" = true
    FROM (SELECT DISTINCT "expenseId" FROM old_rows) c
    WHERE e.id = c."expenseId" AND e."splitwiseExpenseId" IS NOT NULL AND NOT e."splitwiseEdited";
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "ExpenseParticipant_splitwise_inserted"
AFTER INSERT ON "ExpenseParticipant" REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "splitwise_participants_edited"();

CREATE TRIGGER "ExpenseParticipant_splitwise_updated"
AFTER UPDATE ON "ExpenseParticipant" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "splitwise_participants_edited"();

CREATE TRIGGER "ExpenseParticipant_splitwise_deleted"
AFTER DELETE ON "ExpenseParticipant" REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "splitwise_participants_edited"();

-- Finds accounts whose emails differ only in capitals or spaces, which an import must not pick
-- between.
CREATE INDEX "User_email_normalized_idx" ON "User" (lower(btrim("email", E' \t\r\n')));

-- Records everyone with a balance from the balance-only import, so no history is imported for
-- them on top of it, even once the rows are gone (removing a settled friend deletes them). This
-- can't prove someone never had a balance-only import: rows deleted before it ran leave no trace.
-- What makes turning history on safe is the clean-slate check of each import
-- (balanceConsistency.ts): it refuses any pair with SplitPro history other than imported expenses,
-- or with balances those don't explain. These marks, and the import's check of
-- importedFromSplitwise rows, are an extra layer.
INSERT INTO "SplitwiseImportPerson" ("userId", "mode")
SELECT "userId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
UNION
SELECT "friendId", 'BALANCE'::"SplitwiseImportMode" FROM "Balance" WHERE "importedFromSplitwise"
ON CONFLICT DO NOTHING;

COMMIT;
