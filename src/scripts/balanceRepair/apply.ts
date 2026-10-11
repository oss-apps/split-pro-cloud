import { Prisma, type PrismaClient } from '@prisma/client';

import { loadPairSlice } from './load';
import { type DirectedRow, analyseSets, directedRowId } from './plan';
import {
  type GroupRowChange,
  type ReplayExpense,
  expensePairKeys,
  pairKey,
  parsePairKey,
} from './replay';

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

const sortedChanges = (changes: GroupRowChange[]) =>
  JSON.stringify(
    [...changes].sort((a, b) => (a.key === b.key ? a.groupId - b.groupId : a.key < b.key ? -1 : 1)),
  );

const reverseId = (row: DirectedRow) =>
  directedRowId({ ...row, userId: row.friendId, friendId: row.userId });

/** Rows whose reverse row is missing or not the exact negation. */
const mirrorBreaks = (rows: DirectedRow[]) => {
  const amounts = new Map(rows.map((row) => [directedRowId(row), row.amount]));
  return rows.filter((row) => amounts.get(reverseId(row)) !== -row.amount);
};

/** Current Balance and GroupBalance rows of the pairs, both directions, as stored. */
const readDirectedRows = async (tx: Tx, keys: string[]): Promise<DirectedRow[]> => {
  const pairs = keys.map(parsePairKey);
  const currencies = pairs.map((p) => p.currency);
  const los = pairs.map((p) => p.lo);
  const his = pairs.map((p) => p.hi);
  const balances = await tx.$queryRaw<Omit<DirectedRow, 'table' | 'groupId'>[]>`
    SELECT b.currency, b."userId", b."friendId", b.amount
    FROM "Balance" b JOIN unnest(${currencies}::text[], ${los}::int[], ${his}::int[]) AS k(c, lo, hi)
      ON b.currency = k.c AND ((b."userId" = k.lo AND b."friendId" = k.hi)
        OR (b."userId" = k.hi AND b."friendId" = k.lo))`;
  const groupBalances = await tx.$queryRaw<Omit<DirectedRow, 'table'>[]>`
    SELECT gb."groupId", gb.currency, gb."userId", gb."firendId" AS "friendId", gb.amount
    FROM "GroupBalance" gb
    JOIN unnest(${currencies}::text[], ${los}::int[], ${his}::int[]) AS k(c, lo, hi)
      ON gb.currency = k.c AND ((gb."userId" = k.lo AND gb."firendId" = k.hi)
        OR (gb."userId" = k.hi AND gb."firendId" = k.lo))`;
  return [
    ...balances.map((row) => ({ ...row, table: 'Balance' as const, groupId: null })),
    ...groupBalances.map((row) => ({ ...row, table: 'GroupBalance' as const })),
  ].sort((a, b) => (directedRowId(a) < directedRowId(b) ? -1 : 1));
};

type Target = {
  groupId: number;
  currency: string;
  userId: number;
  friendId: number;
  /** null: the row must not exist. */
  from: number | null;
  to: number | null;
};

/**
 * Moves each GroupBalance row from its expected value to an explicit target: update only if it
 * still holds `from`, insert only if it is absent, delete only if it still holds the logged
 * value. Anything else aborts the transaction.
 */
const writeTargets = async (tx: Tx, targets: Target[]) => {
  for (const t of targets) {
    const where = Prisma.sql`"groupId" = ${t.groupId} AND currency = ${t.currency}
      AND "userId" = ${t.userId} AND "firendId" = ${t.friendId}`;
    const count =
      null === t.from
        ? await tx.$executeRaw`
            INSERT INTO "GroupBalance" ("groupId", currency, "userId", "firendId", amount, "updatedAt")
            VALUES (${t.groupId}, ${t.currency}, ${t.userId}, ${t.friendId}, ${t.to}, now())
            ON CONFLICT DO NOTHING`
        : null === t.to
          ? await tx.$executeRaw`DELETE FROM "GroupBalance" WHERE ${where} AND amount = ${t.from}`
          : // "updatedAt" is left alone (nothing reads it) so undo restores rows byte for byte.
            await tx.$executeRaw`UPDATE "GroupBalance" SET amount = ${t.to} WHERE ${where} AND amount = ${t.from}`;
    if (1 !== count) {
      throw new Error(
        `GroupBalance row ${t.groupId}/${t.currency}/${t.userId}/${t.friendId} was not as expected`,
      );
    }
  }
};

/** After writing: every row of the pairs is mirrored and every target holds. */
const assertWritten = async (tx: Tx, keys: string[], targets: Target[]) => {
  const rows = await readDirectedRows(tx, keys);
  const broken = mirrorBreaks(rows);
  if (broken.length) {
    throw new Error(`Mirror broken after writing: ${broken.map(directedRowId).join(', ')}`);
  }
  const amounts = new Map(rows.map((row) => [directedRowId(row), row.amount]));
  const missed = targets.filter(
    (t) => (amounts.get(directedRowId({ ...t, table: 'GroupBalance' })) ?? null) !== t.to,
  );
  if (missed.length) {
    throw new Error(`Targets not reached for ${missed.length} rows`);
  }
};

export type PlannedSet = {
  setId: string;
  keys: string[];
  /** Every stored Balance and GroupBalance row of the set, both directions, at plan time. */
  rows: DirectedRow[];
  changes: GroupRowChange[];
  expenseIds: string[];
};

/**
 * Moves one set's GroupBalance rows to the corrected replay. Inside the serializable
 * transaction it re-reads the set, refuses if anything about it was written since the plan or
 * any row of it is not mirrored, and re-plans the set from the fresh rows, which must give
 * exactly the planned changes. Both directions are written as explicit targets.
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
    if (slice.allocations.some((a) => keys.has(pairKey(a.currency, a.userId, a.friendId)))) {
      refuse('a settlement allocation exists for this set');
    }

    const fresh = analyseSets(slice, []);
    const freshRows = fresh.directedRows(planned.keys);
    if (JSON.stringify(freshRows) !== JSON.stringify(planned.rows)) {
      refuse('stored rows of this set differ from the plan');
    }
    if (mirrorBreaks(freshRows).length) {
      refuse('a row of this set is not mirrored');
    }
    const setId = fresh.setOf.get(planned.keys[0] ?? '');
    const analysis = fresh.analyses.find((candidate) => candidate.setId === setId);
    if (
      JSON.stringify(setId ? fresh.sets.get(setId) : []) !== JSON.stringify(planned.keys) ||
      'repair' !== analysis?.verdict ||
      sortedChanges(analysis.changes) !== sortedChanges(planned.changes)
    ) {
      refuse('re-planning the set from fresh rows gives a different result');
    }

    const current = new Map(freshRows.map((row) => [directedRowId(row), row.amount]));
    const targets: Target[] = planned.changes.flatMap((change) => {
      const { currency, lo, hi } = parsePairKey(change.key);
      return [
        [lo, hi, change.corrected],
        [hi, lo, -change.corrected],
      ].map(([userId = 0, friendId = 0, to = 0]) => ({
        groupId: change.groupId,
        currency,
        userId,
        friendId,
        from:
          current.get(
            directedRowId({
              table: 'GroupBalance',
              groupId: change.groupId,
              currency,
              userId,
              friendId,
            }),
          ) ?? null,
        to,
      }));
    });
    await writeTargets(tx, targets);
    await assertWritten(tx, planned.keys, targets);

    await tx.balanceRepairLog.createMany({
      data: targets.map((t) => ({
        runId,
        scope,
        table: 'GroupBalance',
        groupId: t.groupId,
        currency: t.currency,
        userId: t.userId,
        friendId: t.friendId,
        // null: the row did not exist before the repair.
        before: t.from,
        delta: (t.to ?? 0) - (t.from ?? 0),
        after: t.to,
        reason: 'legacy-group-zeroing',
        createdAt: slice.now,
      })),
    });
    return targets.length;
  });
};

/**
 * Reverts every scope of a run, newest first, one transaction each. A scope is refused if any
 * expense of its pairs was written after the run, if a settlement allocation for them appeared
 * since, or if any row no longer holds exactly the value the run left. Rows the run created are
 * deleted again, and every pair must be mirrored afterwards.
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
        if (
          scopeLogs.some(
            (log) => 'GroupBalance' !== log.table || null === log.groupId || null === log.friendId,
          )
        ) {
          refuse('only GroupBalance rows can be undone');
        }
        const appliedAt = Math.min(...scopeLogs.map((log) => log.createdAt.getTime()));
        const keys = [
          ...new Set(
            scopeLogs.map((log) => pairKey(log.currency ?? '', log.userId, log.friendId!)),
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

        const rows = await readDirectedRows(tx, keys);
        const current = new Map(rows.map((row) => [directedRowId(row), row.amount]));
        const targets: Target[] = scopeLogs.map((log) => ({
          groupId: log.groupId!,
          currency: log.currency ?? '',
          userId: log.userId,
          friendId: log.friendId!,
          from: log.after,
          to: log.before,
        }));
        if (
          targets.some(
            (t) => (current.get(directedRowId({ ...t, table: 'GroupBalance' })) ?? null) !== t.from,
          )
        ) {
          refuse('a row no longer holds the value the run left');
        }
        await writeTargets(tx, targets);
        await assertWritten(tx, keys, targets);

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
