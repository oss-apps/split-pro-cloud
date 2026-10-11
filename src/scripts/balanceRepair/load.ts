import { Prisma, type PrismaClient } from '@prisma/client';

import {
  type ReplayExpense,
  type ReplayInput,
  type StoredAllocation,
  type StoredBalance,
  type StoredGroupBalance,
  parsePairKey,
} from './replay';

export const SETTLEMENT_ALLOCATION_MIGRATION = '20261011120000_add_settlement_allocations';

type Tx = Prisma.TransactionClient;

export type Snapshot = ReplayInput & {
  /** Database time when the snapshot was read. */
  loadedAt: Date;
  expenseAmounts: Map<string, number>;
};

type ExpenseRow = {
  id: string;
  paidBy: number;
  currency: string;
  groupId: number | null;
  splitType: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  addedBy: number;
  updatedBy: number | null;
  settlementAllocationVersion: number | null;
};

type ParticipantRow = { expenseId: string; userId: number; amount: number };

const toExpenses = (expenseRows: ExpenseRow[], participantRows: ParticipantRow[]) => {
  const participantsByExpense = new Map<string, { userId: number; amount: number }[]>();
  participantRows.forEach(({ expenseId, userId, amount }) => {
    const participants = participantsByExpense.get(expenseId);
    if (participants) {
      participants.push({ userId, amount });
    } else {
      participantsByExpense.set(expenseId, [{ userId, amount }]);
    }
  });

  return expenseRows.map(
    (row): ReplayExpense => ({
      id: row.id,
      paidBy: row.paidBy,
      currency: row.currency,
      groupId: row.groupId,
      isSettlement: 'SETTLEMENT' === row.splitType,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      deletedAt: row.deletedAt?.getTime() ?? null,
      addedBy: row.addedBy,
      updatedBy: row.updatedBy,
      edited: null !== row.updatedBy,
      allocationVersion: row.settlementAllocationVersion,
      participants: participantsByExpense.get(row.id) ?? [],
    }),
  );
};

const getCutoff = async (tx: Tx) => {
  const migrations = await tx.$queryRaw<{ finishedAt: Date | null }[]>`
    SELECT finished_at AS "finishedAt" FROM _prisma_migrations
    WHERE migration_name = ${SETTLEMENT_ALLOCATION_MIGRATION} AND rolled_back_at IS NULL`;
  const finishedAt = migrations[0]?.finishedAt;
  return finishedAt ? finishedAt.getTime() : Number.POSITIVE_INFINITY;
};

const dbNow = async (tx: Tx) => {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  if (!clock) {
    throw new Error('Could not read the database clock');
  }
  return clock.now;
};

/**
 * Reads everything the plan needs in one REPEATABLE READ transaction, so it is built from a
 * consistent snapshot even while users keep writing.
 */
export const loadSnapshot = async (db: PrismaClient): Promise<Snapshot> =>
  db.$transaction(
    async (tx) => {
      const loadedAt = await dbNow(tx);
      const expenseRows = await tx.$queryRaw<ExpenseRow[]>`
        SELECT id, "paidBy", currency, "groupId", "splitType"::text AS "splitType", amount,
               "createdAt", "updatedAt", "deletedAt", "addedBy", "updatedBy",
               "settlementAllocationVersion"
        FROM "Expense"`;
      const participantRows = await tx.$queryRaw<ParticipantRow[]>`
        SELECT "expenseId", "userId", amount FROM "ExpenseParticipant"`;
      const balances = await tx.$queryRaw<StoredBalance[]>`
        SELECT "userId", "friendId", currency, amount, "importedFromSplitwise" FROM "Balance"`;
      const groupBalances = await tx.$queryRaw<StoredGroupBalance[]>`
        SELECT "groupId", currency, "userId", "firendId" AS "friendId", amount FROM "GroupBalance"`;
      const allocations = await tx.$queryRaw<StoredAllocation[]>`
        SELECT "settlementExpenseId", "groupId", currency, "userId", "friendId", amount
        FROM "SettlementAllocation"`;
      const groupUsers = await tx.$queryRaw<{ groupId: number; userId: number }[]>`
        SELECT "groupId", "userId" FROM "GroupUser"`;

      return {
        loadedAt,
        expenses: toExpenses(expenseRows, participantRows),
        expenseAmounts: new Map(expenseRows.map((row) => [row.id, row.amount])),
        balances,
        groupBalances,
        allocations,
        memberships: new Set(groupUsers.map((g) => `${g.groupId}:${g.userId}`)),
        cutoff: await getCutoff(tx),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 60_000,
      timeout: 15 * 60_000,
    },
  );

/**
 * Inside the caller's transaction, reads every row that bears on the given pairs: all their
 * expenses in any currency (an edit can change currency), the expenses the plan used, every
 * personal expense and every settlement any of the people is on (for the person-level
 * eligibility rules), their Balance, GroupBalance and SettlementAllocation rows and their
 * group memberships. Under SERIALIZABLE these reads make concurrent writers to the same rows
 * conflict with the repair.
 */
export const loadPairSlice = async (
  tx: Tx,
  keys: string[],
  extraExpenseIds: string[],
): Promise<ReplayInput & { now: Date }> => {
  const pairs = [
    ...new Map(keys.map(parsePairKey).map(({ lo, hi }) => [`${lo}|${hi}`, { lo, hi }])).values(),
  ];
  const los = pairs.map((p) => p.lo);
  const his = pairs.map((p) => p.hi);
  const users = [...new Set([...los, ...his])];

  const now = await dbNow(tx);
  const expenseRows = await tx.$queryRaw<ExpenseRow[]>`
    SELECT e.id, e."paidBy", e.currency, e."groupId", e."splitType"::text AS "splitType",
           e.amount, e."createdAt", e."updatedAt", e."deletedAt", e."addedBy", e."updatedBy",
           e."settlementAllocationVersion"
    FROM "Expense" e
    WHERE e.id = ANY(${extraExpenseIds}::text[])
       OR EXISTS (
         SELECT 1 FROM "ExpenseParticipant" p
         JOIN unnest(${los}::int[], ${his}::int[]) AS k(lo, hi)
           ON (e."paidBy" = k.lo AND p."userId" = k.hi) OR (e."paidBy" = k.hi AND p."userId" = k.lo)
         WHERE p."expenseId" = e.id)
       OR ((e."groupId" IS NULL OR e."splitType" = 'SETTLEMENT') AND (
         e."paidBy" = ANY(${users}::int[]) OR e."addedBy" = ANY(${users}::int[])
         OR e."updatedBy" = ANY(${users}::int[])
         OR EXISTS (
           SELECT 1 FROM "ExpenseParticipant" p
           WHERE p."expenseId" = e.id AND p."userId" = ANY(${users}::int[]))))`;
  const participantRows = await tx.$queryRaw<ParticipantRow[]>`
    SELECT "expenseId", "userId", amount FROM "ExpenseParticipant"
    WHERE "expenseId" = ANY(${expenseRows.map((row) => row.id)}::text[])`;
  const balances = await tx.$queryRaw<StoredBalance[]>`
    SELECT b."userId", b."friendId", b.currency, b.amount, b."importedFromSplitwise"
    FROM "Balance" b JOIN unnest(${los}::int[], ${his}::int[]) AS k(lo, hi)
      ON (b."userId" = k.lo AND b."friendId" = k.hi) OR (b."userId" = k.hi AND b."friendId" = k.lo)`;
  const groupBalances = await tx.$queryRaw<StoredGroupBalance[]>`
    SELECT gb."groupId", gb.currency, gb."userId", gb."firendId" AS "friendId", gb.amount
    FROM "GroupBalance" gb JOIN unnest(${los}::int[], ${his}::int[]) AS k(lo, hi)
      ON (gb."userId" = k.lo AND gb."firendId" = k.hi) OR (gb."userId" = k.hi AND gb."firendId" = k.lo)`;
  const allocations = await tx.$queryRaw<StoredAllocation[]>`
    SELECT a."settlementExpenseId", a."groupId", a.currency, a."userId", a."friendId", a.amount
    FROM "SettlementAllocation" a JOIN unnest(${los}::int[], ${his}::int[]) AS k(lo, hi)
      ON (a."userId" = k.lo AND a."friendId" = k.hi) OR (a."userId" = k.hi AND a."friendId" = k.lo)`;

  const groupUsers = await tx.$queryRaw<{ groupId: number; userId: number }[]>`
    SELECT "groupId", "userId" FROM "GroupUser" WHERE "userId" = ANY(${users}::int[])`;

  return {
    now,
    expenses: toExpenses(expenseRows, participantRows),
    balances,
    groupBalances,
    allocations,
    memberships: new Set(groupUsers.map((g) => `${g.groupId}:${g.userId}`)),
    cutoff: await getCutoff(tx),
  };
};
