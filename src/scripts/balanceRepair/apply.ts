import { Prisma, type PrismaClient } from '@prisma/client';

import { loadPairSlice } from './load';
import { type SetRow, analyseSets } from './plan';
import { type GroupRowChange, type ReplayExpense, expensePairKeys, parsePairKey } from './replay';

type Tx = Prisma.TransactionClient;

/**
 * Expense timestamps come from the app servers' clocks, the plan and apply times from the
 * database's. Anything this close to the plan or apply time counts as later.
 */
export const CLOCK_SLACK_MS = 60_000;

export type ApplyOutcome = {
  scope: string;
  status: 'applied' | 'changed-since-plan' | 'changed-since-apply' | 'already-undone' | 'failed';
  rows: number;
  detail: string;
};

class RefusedError extends Error {
  constructor(
    readonly status: 'changed-since-plan' | 'changed-since-apply',
    message: string,
  ) {
    super(message);
  }
}

const isSerializationFailure = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError && 'P2034' === error.code) ||
  (error instanceof Error &&
    /could not serialize access|deadlock detected|40001|40P01/.test(error.message));

/** One serializable transaction per scope, retried on serialization conflicts. */
const runScope = async (
  db: PrismaClient,
  scope: string,
  operation: (tx: Tx) => Promise<number>,
): Promise<ApplyOutcome> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const rows = await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 120_000,
      });
      return { scope, status: 'applied', rows, detail: '' };
    } catch (error) {
      if (error instanceof RefusedError) {
        return { scope, status: error.status, rows: 0, detail: error.message };
      }
      if (isSerializationFailure(error) && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        continue;
      }
      return {
        scope,
        status: 'failed',
        rows: 0,
        detail: error instanceof Error ? error.message.split('\n').slice(-1)[0] ?? '' : 'unknown',
      };
    }
  }
};

const lastWrite = (expense: ReplayExpense) =>
  Math.max(expense.createdAt, expense.updatedAt, expense.deletedAt ?? 0);

const touchesAny = (expense: ReplayExpense, keys: Set<string>) =>
  expensePairKeys(expense).some((key) => keys.has(key));

const groupRowKey = (groupId: number, currency: string, userId: number, friendId: number) =>
  `${groupId}|${currency}|${userId}|${friendId}`;

/** Both sides of every Balance and GroupBalance row of the pairs, as comparable strings. */
const fingerprint = (rows: SetRow[]) =>
  rows
    .flatMap(({ key, amount, exists, groups }) => {
      const { currency, lo, hi } = parsePairKey(key);
      return [
        ...(exists
          ? [`B|${currency}|${lo}|${hi}|${amount}`, `B|${currency}|${hi}|${lo}|${-amount}`]
          : []),
        ...groups.flatMap(([groupId, groupAmount]) => [
          `G|${groupRowKey(groupId, currency, lo, hi)}|${groupAmount}`,
          `G|${groupRowKey(groupId, currency, hi, lo)}|${-groupAmount}`,
        ]),
      ];
    })
    .sort()
    .join(';');

const sortedChanges = (changes: GroupRowChange[]) =>
  JSON.stringify(
    [...changes].sort((a, b) => (a.key === b.key ? a.groupId - b.groupId : a.key < b.key ? -1 : 1)),
  );

export type PlannedSet = {
  setId: string;
  keys: string[];
  rows: SetRow[];
  changes: GroupRowChange[];
  expenseIds: string[];
};

/**
 * Moves one set's GroupBalance rows to the corrected replay, by delta. Inside the serializable
 * transaction it re-reads the set, refuses if anything about it was written since the plan, and
 * re-plans the set from the fresh rows, which must give exactly the planned changes.
 */
export const applySetRepair = async (
  db: PrismaClient,
  runId: string,
  snapshotAt: Date,
  planned: PlannedSet,
) => {
  const scope = `set:${planned.setId}`;
  return runScope(db, scope, async (tx) => {
    const keys = new Set(planned.keys);
    const plannedIds = new Set(planned.expenseIds);
    const slice = await loadPairSlice(tx, planned.keys, planned.expenseIds);
    const refuse = (message: string) => {
      throw new RefusedError('changed-since-plan', message);
    };

    const relevant = slice.expenses.filter(
      (expense) => plannedIds.has(expense.id) || touchesAny(expense, keys),
    );
    if (relevant.some((expense) => lastWrite(expense) >= snapshotAt.getTime() - CLOCK_SLACK_MS)) {
      refuse('an expense of this set was written after the plan');
    }
    if (relevant.length !== plannedIds.size || relevant.some((e) => !plannedIds.has(e.id))) {
      refuse('the expenses of this set differ from the plan');
    }
    if (
      slice.allocations.some((a) =>
        keys.has(
          `${a.currency}|${Math.min(a.userId, a.friendId)}|${Math.max(a.userId, a.friendId)}`,
        ),
      )
    ) {
      refuse('a settlement allocation exists for this set');
    }

    const fresh = analyseSets(slice, []);
    const setId = fresh.setOf.get(planned.keys[0] ?? '');
    const analysis = fresh.analyses.find((candidate) => candidate.setId === setId);
    const freshKeys = setId ? fresh.sets.get(setId) ?? [] : [];
    const freshRows = freshKeys.map((key) => {
      const pair = fresh.stored.get(key);
      return {
        key,
        amount: pair?.amount ?? 0,
        exists: !!pair?.exists,
        groups: [...(pair?.groups.entries() ?? [])].sort((a, b) => a[0] - b[0]),
      };
    });
    if (fingerprint(freshRows) !== fingerprint(planned.rows)) {
      refuse('balances of this set differ from the plan');
    }
    if (
      JSON.stringify(freshKeys) !== JSON.stringify(planned.keys) ||
      'repair' !== analysis?.verdict ||
      sortedChanges(analysis.changes) !== sortedChanges(planned.changes)
    ) {
      refuse('re-planning the set from fresh rows gives a different result');
    }

    const existing = new Map(
      slice.groupBalances.map((row) => [
        groupRowKey(row.groupId, row.currency, row.userId, row.friendId),
        row.amount,
      ]),
    );
    const rows = planned.changes.flatMap((change) => {
      const { currency, lo, hi } = parsePairKey(change.key);
      const delta = change.corrected - change.stored;
      return [
        { groupId: change.groupId, currency, userId: lo, friendId: hi, delta },
        { groupId: change.groupId, currency, userId: hi, friendId: lo, delta: -delta },
      ];
    });
    // "updatedAt" is left alone on existing rows (nothing reads it) so undo restores them byte
    // for byte. BalanceRepairLog records the write.
    await tx.$executeRaw`
      INSERT INTO "GroupBalance" ("groupId", currency, "userId", "firendId", amount, "updatedAt")
      SELECT g, c, u, f, d, now()
      FROM unnest(${rows.map((r) => r.groupId)}::int[], ${rows.map((r) => r.currency)}::text[],
                  ${rows.map((r) => r.userId)}::int[], ${rows.map((r) => r.friendId)}::int[],
                  ${rows.map((r) => r.delta)}::int[]) AS v(g, c, u, f, d)
      ON CONFLICT ("groupId", currency, "firendId", "userId")
      DO UPDATE SET amount = "GroupBalance".amount + EXCLUDED.amount`;

    await tx.balanceRepairLog.createMany({
      data: rows.map((row) => {
        const before = existing.get(
          groupRowKey(row.groupId, row.currency, row.userId, row.friendId),
        );
        return {
          runId,
          scope,
          table: 'GroupBalance',
          groupId: row.groupId,
          currency: row.currency,
          userId: row.userId,
          friendId: row.friendId,
          // null: the row did not exist before the repair.
          before: before ?? null,
          delta: row.delta,
          after: (before ?? 0) + row.delta,
          reason: 'legacy-group-zeroing',
          createdAt: slice.now,
        };
      }),
    });
    return rows.length;
  });
};

/**
 * Reverts every scope of a run, newest first, one transaction each. A scope is refused if any
 * expense of its pairs was written after the run, if a settlement allocation for them appeared
 * since, or if any row no longer holds exactly the value the run left. Rows the run created are
 * deleted again.
 */
export const undoRun = async (db: PrismaClient, undoRunId: string, runId: string) => {
  const logs = await db.balanceRepairLog.findMany({ where: { runId }, orderBy: { id: 'asc' } });
  const undone = new Set(
    (
      await db.balanceRepairLog.findMany({
        where: { reason: `undo:${runId}` },
        select: { scope: true },
        distinct: ['scope'],
      })
    ).map((row) => row.scope),
  );
  const scopes = [...new Set(logs.map((log) => log.scope))].reverse();

  const outcomes: ApplyOutcome[] = [];
  for (const scope of scopes) {
    if (undone.has(scope)) {
      outcomes.push({ scope, status: 'already-undone', rows: 0, detail: '' });
      continue;
    }
    const scopeLogs = logs.filter((log) => log.scope === scope);
    outcomes.push(
      await runScope(db, scope, async (tx) => {
        const refuse = (message: string) => {
          throw new RefusedError('changed-since-apply', message);
        };
        if (scopeLogs.some((log) => 'GroupBalance' !== log.table || null === log.groupId)) {
          refuse('only GroupBalance rows can be undone');
        }
        const appliedAt = Math.min(...scopeLogs.map((log) => log.createdAt.getTime()));
        const keys = [
          ...new Set(
            scopeLogs.map(
              (log) =>
                `${log.currency}|${Math.min(log.userId, log.friendId!)}|${Math.max(log.userId, log.friendId!)}`,
            ),
          ),
        ];
        const keySet = new Set(keys);
        const slice = await loadPairSlice(tx, keys, []);

        if (
          slice.expenses.some(
            (expense) =>
              touchesAny(expense, keySet) && lastWrite(expense) >= appliedAt - CLOCK_SLACK_MS,
          )
        ) {
          refuse('an expense of these pairs was written after the run');
        }
        const pairs = keys.map(parsePairKey);
        const newAllocations = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM "SettlementAllocation" a
          JOIN unnest(${pairs.map((p) => p.currency)}::text[], ${pairs.map((p) => p.lo)}::int[],
                      ${pairs.map((p) => p.hi)}::int[]) AS k(c, lo, hi)
            ON a.currency = k.c AND ((a."userId" = k.lo AND a."friendId" = k.hi)
              OR (a."userId" = k.hi AND a."friendId" = k.lo))
          WHERE a."createdAt" >= ${new Date(appliedAt - CLOCK_SLACK_MS)}`;
        if (newAllocations[0]?.count) {
          refuse('a settlement allocation for these pairs was created after the run');
        }

        const current = new Map(
          slice.groupBalances.map((row) => [
            groupRowKey(row.groupId, row.currency, row.userId, row.friendId),
            row.amount,
          ]),
        );
        const rowKeyOf = (log: (typeof scopeLogs)[number]) =>
          groupRowKey(log.groupId!, log.currency!, log.userId, log.friendId!);
        if (scopeLogs.some((log) => current.get(rowKeyOf(log)) !== log.after)) {
          refuse('a row no longer holds the value the run left');
        }

        for (const log of scopeLogs) {
          if (null === log.before) {
            await tx.$executeRaw`
              DELETE FROM "GroupBalance" WHERE "groupId" = ${log.groupId} AND currency = ${log.currency}
                AND "userId" = ${log.userId} AND "firendId" = ${log.friendId} AND amount = ${log.after}`;
          } else {
            await tx.$executeRaw`
              UPDATE "GroupBalance" SET amount = amount - ${log.delta}
              WHERE "groupId" = ${log.groupId} AND currency = ${log.currency}
                AND "userId" = ${log.userId} AND "firendId" = ${log.friendId}`;
          }
        }

        await tx.balanceRepairLog.createMany({
          data: scopeLogs.map((log) => ({
            runId: undoRunId,
            scope,
            table: log.table,
            groupId: log.groupId,
            currency: log.currency,
            userId: log.userId,
            friendId: log.friendId,
            before: log.after,
            delta: -log.delta,
            after: log.before,
            reason: `undo:${runId}`,
            createdAt: slice.now,
          })),
        });
        return scopeLogs.length;
      }),
    );
  }
  return outcomes;
};
