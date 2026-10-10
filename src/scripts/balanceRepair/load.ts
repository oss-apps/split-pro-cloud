import { Prisma, type PrismaClient } from '@prisma/client';

import {
  type ReplayExpense,
  type ReplayInput,
  type StoredAllocation,
  type StoredBalance,
  type StoredGroupBalance,
} from './replay';

export const SETTLEMENT_ALLOCATION_MIGRATION = '20261011120000_add_settlement_allocations';

export type Snapshot = ReplayInput & {
  loadedAt: Date;
  expenseById: Map<string, ReplayExpense>;
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
  updatedBy: number | null;
  settlementAllocationVersion: number | null;
};

/**
 * Reads everything the repair needs in one REPEATABLE READ transaction, so the plan is built
 * from a consistent snapshot even while users keep writing.
 */
export const loadSnapshot = async (db: PrismaClient): Promise<Snapshot> =>
  db.$transaction(
    async (tx) => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const expenseRows = await tx.$queryRaw<ExpenseRow[]>`
        SELECT id, "paidBy", currency, "groupId", "splitType"::text AS "splitType", amount,
               "createdAt", "updatedAt", "deletedAt", "updatedBy", "settlementAllocationVersion"
        FROM "Expense"`;
      const participantRows = await tx.$queryRaw<
        { expenseId: string; userId: number; amount: number }[]
      >`SELECT "expenseId", "userId", amount FROM "ExpenseParticipant"`;
      const balanceRows = await tx.$queryRaw<
        (Omit<StoredBalance, 'createdAt'> & { createdAt: Date })[]
      >`
        SELECT "userId", "friendId", currency, amount, "createdAt", "importedFromSplitwise"
        FROM "Balance"`;
      const groupBalances = await tx.$queryRaw<StoredGroupBalance[]>`
        SELECT "groupId", currency, "userId", "firendId" AS "friendId", amount FROM "GroupBalance"`;
      const groupUsers = await tx.$queryRaw<{ groupId: number; userId: number }[]>`
        SELECT "groupId", "userId" FROM "GroupUser"`;
      const groups = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Group"`;
      const allocations = await tx.$queryRaw<StoredAllocation[]>`
        SELECT "settlementExpenseId", "groupId", currency, "userId", "friendId", amount
        FROM "SettlementAllocation"`;
      const migrations = await tx.$queryRaw<{ finishedAt: Date | null }[]>`
        SELECT finished_at AS "finishedAt" FROM _prisma_migrations
        WHERE migration_name = ${SETTLEMENT_ALLOCATION_MIGRATION} AND rolled_back_at IS NULL`;

      const participantsByExpense = new Map<string, { userId: number; amount: number }[]>();
      participantRows.forEach(({ expenseId, userId, amount }) => {
        const participants = participantsByExpense.get(expenseId);
        if (participants) {
          participants.push({ userId, amount });
        } else {
          participantsByExpense.set(expenseId, [{ userId, amount }]);
        }
      });

      const expenseAmounts = new Map<string, number>();
      const expenses = expenseRows.map((row): ReplayExpense => {
        expenseAmounts.set(row.id, row.amount);
        return {
          id: row.id,
          paidBy: row.paidBy,
          currency: row.currency,
          groupId: row.groupId,
          isSettlement: 'SETTLEMENT' === row.splitType,
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
          deletedAt: row.deletedAt?.getTime() ?? null,
          edited: null !== row.updatedBy,
          allocationVersion: row.settlementAllocationVersion,
          participants: participantsByExpense.get(row.id) ?? [],
        };
      });

      const finishedAt = migrations[0]?.finishedAt;

      return {
        loadedAt: clock?.now ?? new Date(),
        expenses,
        expenseById: new Map(expenses.map((expense) => [expense.id, expense])),
        expenseAmounts,
        balances: balanceRows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() })),
        groupBalances,
        memberships: new Set(groupUsers.map(({ groupId, userId }) => `${groupId}:${userId}`)),
        existingGroupIds: new Set(groups.map(({ id }) => id)),
        cutoff: finishedAt ? finishedAt.getTime() : Number.POSITIVE_INFINITY,
        allocations,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 60_000,
      timeout: 15 * 60_000,
    },
  );
