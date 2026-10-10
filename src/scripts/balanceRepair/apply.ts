import { Prisma, type PrismaClient } from '@prisma/client';

import { type GroupRowChange, type ReplayState, pairKey, pairSign, parsePairKey } from './replay';
import { type SettlementFix } from './settlements';

type Tx = Prisma.TransactionClient;

export type LogRow = {
  scope: string;
  table: 'Balance' | 'GroupBalance' | 'ExpenseParticipant';
  groupId: number | null;
  currency: string | null;
  expenseId: string | null;
  userId: number;
  friendId: number | null;
  before: number | null;
  delta: number;
  after: number | null;
  reason: string;
};

export type ApplyOutcome = {
  scope: string;
  status: 'applied' | 'skipped-changed' | 'skipped-already-undone' | 'failed';
  rows: number;
  detail: string;
};

class LiveWriteError extends Error {}

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
      if (error instanceof LiveWriteError) {
        return { scope, status: 'skipped-changed', rows: 0, detail: error.message };
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

const writeLog = async (tx: Tx, runId: string, rows: LogRow[]) => {
  if (!rows.length) {
    return;
  }
  await tx.balanceRepairLog.createMany({ data: rows.map((row) => ({ ...row, runId })) });
};

/** Adds deltas to mirrored rows (upsert) and returns the rows after the change. */
const incrementBalances = async (
  tx: Tx,
  rows: { currency: string; userId: number; friendId: number; delta: number }[],
) => {
  if (!rows.length) {
    return [];
  }
  return tx.$queryRaw<{ currency: string; userId: number; friendId: number; amount: number }[]>`
    INSERT INTO "Balance" ("userId", currency, "friendId", amount, "createdAt", "updatedAt")
    SELECT u, c, f, d, now(), now()
    FROM unnest(${rows.map((r) => r.userId)}::int[], ${rows.map((r) => r.currency)}::text[],
                ${rows.map((r) => r.friendId)}::int[], ${rows.map((r) => r.delta)}::int[]) AS v(u, c, f, d)
    ON CONFLICT ("userId", currency, "friendId")
    DO UPDATE SET amount = "Balance".amount + EXCLUDED.amount, "updatedAt" = now()
    RETURNING currency, "userId", "friendId", amount`;
};

const incrementGroupBalances = async (
  tx: Tx,
  rows: { groupId: number; currency: string; userId: number; friendId: number; delta: number }[],
) => {
  if (!rows.length) {
    return [];
  }
  return tx.$queryRaw<
    { groupId: number; currency: string; userId: number; friendId: number; amount: number }[]
  >`
    INSERT INTO "GroupBalance" ("groupId", currency, "userId", "firendId", amount, "updatedAt")
    SELECT g, c, u, f, d, now()
    FROM unnest(${rows.map((r) => r.groupId)}::int[], ${rows.map((r) => r.currency)}::text[],
                ${rows.map((r) => r.userId)}::int[], ${rows.map((r) => r.friendId)}::int[],
                ${rows.map((r) => r.delta)}::int[]) AS v(g, c, u, f, d)
    ON CONFLICT ("groupId", currency, "firendId", "userId")
    DO UPDATE SET amount = "GroupBalance".amount + EXCLUDED.amount, "updatedAt" = now()
    RETURNING "groupId", currency, "userId", "firendId" AS "friendId", amount`;
};

/** Both mirrored rows of each change, with the delta for that side. */
const mirrored = <T extends { userId: number; friendId: number; delta: number }>(rows: T[]) =>
  rows.flatMap((row) => [
    row,
    { ...row, userId: row.friendId, friendId: row.userId, delta: -row.delta },
  ]);

/**
 * Phase 1: rewrites one sign-flipped settlement to payer +amount / other -amount and moves the
 * pair's Balance (and GroupBalance, if it was a group settlement) by the same correction.
 */
const applySettlementFix = async (
  db: PrismaClient,
  runId: string,
  fix: SettlementFix,
  plannedPairAmount: number,
) => {
  const scope = `settlement:${fix.expenseId}`;
  return runScope(db, scope, async (tx) => {
    const [expense] = await tx.$queryRaw<
      { updatedAt: Date; deletedAt: Date | null; amount: number }[]
    >`
      SELECT "updatedAt", "deletedAt", amount FROM "Expense" WHERE id = ${fix.expenseId} FOR UPDATE`;
    const participants = await tx.$queryRaw<{ userId: number; amount: number }[]>`
      SELECT "userId", amount FROM "ExpenseParticipant" WHERE "expenseId" = ${fix.expenseId}`;
    const [balance] = await tx.$queryRaw<{ amount: number }[]>`
      SELECT amount FROM "Balance"
      WHERE currency = ${fix.currency} AND "userId" = ${Math.min(fix.paidBy, fix.otherId)}
        AND "friendId" = ${Math.max(fix.paidBy, fix.otherId)}`;

    const payer = participants.find((p) => p.userId === fix.paidBy);
    const other = participants.find((p) => p.userId === fix.otherId);
    if (
      !expense ||
      null !== expense.deletedAt ||
      expense.updatedAt.getTime() !== fix.updatedAt ||
      expense.amount !== fix.amount ||
      (payer?.amount ?? null) !== fix.payerAmount ||
      other?.amount !== fix.otherAmount ||
      (balance?.amount ?? 0) !== plannedPairAmount
    ) {
      throw new LiveWriteError('settlement or pair balance changed since the plan');
    }

    const reason = `phase1:${fix.reason}`;
    const logs: LogRow[] = [];
    // `delta` is the correction to Balance(other, payer).
    const balanceRows =
      0 === fix.delta
        ? []
        : mirrored([
            { currency: fix.currency, userId: fix.otherId, friendId: fix.paidBy, delta: fix.delta },
          ]);
    const updatedBalances = await incrementBalances(tx, balanceRows);
    balanceRows.forEach((row) => {
      const after = updatedBalances.find(
        (b) =>
          b.userId === row.userId && b.friendId === row.friendId && b.currency === row.currency,
      )?.amount;
      logs.push({
        scope,
        table: 'Balance',
        groupId: null,
        currency: row.currency,
        expenseId: fix.expenseId,
        userId: row.userId,
        friendId: row.friendId,
        before: undefined === after ? null : after - row.delta,
        delta: row.delta,
        after: after ?? null,
        reason,
      });
    });

    if (null !== fix.groupId && 0 !== fix.delta) {
      const groupRows = balanceRows.map((row) => ({ ...row, groupId: fix.groupId! }));
      const updatedGroups = await incrementGroupBalances(tx, groupRows);
      groupRows.forEach((row) => {
        const after = updatedGroups.find(
          (b) => b.userId === row.userId && b.friendId === row.friendId,
        )?.amount;
        logs.push({
          scope,
          table: 'GroupBalance',
          groupId: row.groupId,
          currency: row.currency,
          expenseId: fix.expenseId,
          userId: row.userId,
          friendId: row.friendId,
          before: undefined === after ? null : after - row.delta,
          delta: row.delta,
          after: after ?? null,
          reason,
        });
      });
    }

    const canonical = [
      { userId: fix.paidBy, amount: fix.amount, before: payer?.amount ?? null },
      { userId: fix.otherId, amount: -fix.amount, before: other.amount },
    ].filter((row) => row.before !== row.amount);
    await Promise.all(
      canonical.map(
        (row) => tx.$executeRaw`
          INSERT INTO "ExpenseParticipant" ("expenseId", "userId", amount)
          VALUES (${fix.expenseId}, ${row.userId}, ${row.amount})
          ON CONFLICT ("expenseId", "userId") DO UPDATE SET amount = EXCLUDED.amount`,
      ),
    );
    canonical.forEach((row) =>
      logs.push({
        scope,
        table: 'ExpenseParticipant',
        groupId: null,
        currency: fix.currency,
        expenseId: fix.expenseId,
        userId: row.userId,
        friendId: null,
        before: row.before,
        delta: row.amount - (row.before ?? 0),
        after: row.amount,
        reason,
      }),
    );

    await writeLog(tx, runId, logs);
    return logs.length;
  });
};

type SetRows = { key: string; amount: number; exists: boolean; groups: [number, number][] }[];

const readSetState = async (tx: Tx, keys: string[]) => {
  const parsed = keys.map(parsePairKey);
  const currencies = parsed.map((p) => p.currency);
  const los = parsed.map((p) => p.lo);
  const his = parsed.map((p) => p.hi);
  const balances = await tx.$queryRaw<
    { currency: string; userId: number; friendId: number; amount: number }[]
  >`
    SELECT b.currency, b."userId", b."friendId", b.amount
    FROM "Balance" b
    JOIN unnest(${currencies}::text[], ${los}::int[], ${his}::int[]) AS k(c, lo, hi)
      ON b.currency = k.c AND ((b."userId" = k.lo AND b."friendId" = k.hi)
        OR (b."userId" = k.hi AND b."friendId" = k.lo))`;
  const groupBalances = await tx.$queryRaw<
    { groupId: number; currency: string; userId: number; friendId: number; amount: number }[]
  >`
    SELECT gb."groupId", gb.currency, gb."userId", gb."firendId" AS "friendId", gb.amount
    FROM "GroupBalance" gb
    JOIN unnest(${currencies}::text[], ${los}::int[], ${his}::int[]) AS k(c, lo, hi)
      ON gb.currency = k.c AND ((gb."userId" = k.lo AND gb."firendId" = k.hi)
        OR (gb."userId" = k.hi AND gb."firendId" = k.lo))`;
  return { balances, groupBalances };
};

/** Fingerprint of every row of a set, both sides, so any live write is noticed. */
const fingerprint = (rows: string[]) => rows.sort().join(';');

const plannedFingerprint = (planned: SetRows) =>
  fingerprint(
    planned.flatMap(({ key, amount, exists, groups }) => {
      const { currency, lo, hi } = parsePairKey(key);
      return [
        ...(exists
          ? [`B|${currency}|${lo}|${hi}|${amount}`, `B|${currency}|${hi}|${lo}|${-amount}`]
          : []),
        ...groups.flatMap(([groupId, groupAmount]) => [
          `G|${groupId}|${currency}|${lo}|${hi}|${groupAmount}`,
          `G|${groupId}|${currency}|${hi}|${lo}|${-groupAmount}`,
        ]),
      ];
    }),
  );

/** Phase 2: moves one trusted set's GroupBalance rows to the corrected replay, by delta. */
export const applySetRepair = async (
  db: PrismaClient,
  runId: string,
  setId: string,
  keys: string[],
  planned: SetRows,
  changes: GroupRowChange[],
) => {
  const scope = `set:${setId}`;
  return runScope(db, scope, async (tx) => {
    const current = await readSetState(tx, keys);
    const currentFingerprint = fingerprint([
      ...current.balances.map((b) => `B|${b.currency}|${b.userId}|${b.friendId}|${b.amount}`),
      ...current.groupBalances.map(
        (b) => `G|${b.groupId}|${b.currency}|${b.userId}|${b.friendId}|${b.amount}`,
      ),
    ]);
    if (currentFingerprint !== plannedFingerprint(planned)) {
      throw new LiveWriteError('balances in this set changed since the plan');
    }

    const rows = mirrored(
      changes.map((change) => {
        const { currency, lo, hi } = parsePairKey(change.key);
        return {
          groupId: change.groupId,
          currency,
          userId: lo,
          friendId: hi,
          delta: change.corrected - change.stored,
        };
      }),
    );
    const updated = await incrementGroupBalances(tx, rows);
    const logs = rows.map((row): LogRow => {
      const after = updated.find(
        (b) => b.groupId === row.groupId && b.userId === row.userId && b.friendId === row.friendId,
      )?.amount;
      return {
        scope,
        table: 'GroupBalance',
        groupId: row.groupId,
        currency: row.currency,
        expenseId: null,
        userId: row.userId,
        friendId: row.friendId,
        before: undefined === after ? null : after - row.delta,
        delta: row.delta,
        after: after ?? null,
        reason: 'phase2:legacy-group-zeroing',
      };
    });
    await writeLog(tx, runId, logs);
    return logs.length;
  });
};

/**
 * Reverts every scope of a run, one transaction each. A scope is skipped if any of its rows no
 * longer holds the value the run left there, so later user writes are never overwritten.
 */
export const undoRun = async (db: PrismaClient, undoRunId: string, runId: string) => {
  const logs = await db.balanceRepairLog.findMany({
    where: { runId },
    orderBy: { id: 'asc' },
  });
  const undone = new Set(
    (
      await db.balanceRepairLog.findMany({
        where: { reason: `undo:${runId}` },
        select: { scope: true },
        distinct: ['scope'],
      })
    ).map((row) => row.scope),
  );
  // Last applied first: two settlement fixes on one pair must unwind in reverse order.
  const scopes = [...new Set(logs.map((log) => log.scope))].reverse();

  const outcomes: ApplyOutcome[] = [];
  for (const scope of scopes) {
    if (undone.has(scope)) {
      outcomes.push({ scope, status: 'skipped-already-undone', rows: 0, detail: '' });
      continue;
    }
    const scopeLogs = logs.filter((log) => log.scope === scope);
    outcomes.push(
      await runScope(db, scope, async (tx) => {
        const currentValues = await Promise.all(
          scopeLogs.map(async (log) => {
            if ('Balance' === log.table) {
              const [row] = await tx.$queryRaw<{ amount: number }[]>`
                SELECT amount FROM "Balance" WHERE "userId" = ${log.userId}
                  AND "friendId" = ${log.friendId} AND currency = ${log.currency}`;
              return row?.amount ?? null;
            }
            if ('GroupBalance' === log.table) {
              const [row] = await tx.$queryRaw<{ amount: number }[]>`
                SELECT amount FROM "GroupBalance" WHERE "groupId" = ${log.groupId}
                  AND "userId" = ${log.userId} AND "firendId" = ${log.friendId} AND currency = ${log.currency}`;
              return row?.amount ?? null;
            }
            const [row] = await tx.$queryRaw<{ amount: number }[]>`
              SELECT amount FROM "ExpenseParticipant"
              WHERE "expenseId" = ${log.expenseId} AND "userId" = ${log.userId}`;
            return row?.amount ?? null;
          }),
        );
        if (scopeLogs.some((log, index) => currentValues[index] !== log.after)) {
          throw new LiveWriteError('a row changed after the run');
        }

        const balanceRows = scopeLogs
          .filter((log) => 'Balance' === log.table)
          .map((log) => ({
            currency: log.currency!,
            userId: log.userId,
            friendId: log.friendId!,
            delta: -log.delta,
          }));
        const groupRows = scopeLogs
          .filter((log) => 'GroupBalance' === log.table)
          .map((log) => ({
            groupId: log.groupId!,
            currency: log.currency!,
            userId: log.userId,
            friendId: log.friendId!,
            delta: -log.delta,
          }));
        await incrementBalances(tx, balanceRows);
        await incrementGroupBalances(tx, groupRows);
        await Promise.all(
          scopeLogs
            .filter((log) => 'ExpenseParticipant' === log.table)
            .map((log) =>
              null === log.before
                ? tx.$executeRaw`DELETE FROM "ExpenseParticipant"
                    WHERE "expenseId" = ${log.expenseId} AND "userId" = ${log.userId}`
                : tx.$executeRaw`UPDATE "ExpenseParticipant" SET amount = ${log.before}
                    WHERE "expenseId" = ${log.expenseId} AND "userId" = ${log.userId}`,
            ),
        );

        await writeLog(
          tx,
          undoRunId,
          scopeLogs.map((log) => ({
            scope,
            table: log.table as LogRow['table'],
            groupId: log.groupId,
            currency: log.currency,
            expenseId: log.expenseId,
            userId: log.userId,
            friendId: log.friendId,
            before: log.after,
            delta: -log.delta,
            after: log.before,
            reason: `undo:${runId}`,
          })),
        );
        return scopeLogs.length;
      }),
    );
  }
  return outcomes;
};

/**
 * Applies the settlement fixes in order. A pair can have several fixes, so each one expects the
 * planned balance plus the corrections already applied to that pair in this run.
 */
export const applySettlementFixes = async (
  db: PrismaClient,
  runId: string,
  fixes: SettlementFix[],
  stored: ReplayState,
) => {
  const applied = new Map<string, number>();
  const outcomes: ApplyOutcome[] = [];
  for (const fix of fixes) {
    const key = pairKey(fix.currency, fix.paidBy, fix.otherId);
    const expected = (stored.get(key)?.amount ?? 0) + (applied.get(key) ?? 0);
    const outcome = await applySettlementFix(db, runId, fix, expected);
    if ('applied' === outcome.status) {
      // `delta` is applied to Balance(other, payer).
      applied.set(key, (applied.get(key) ?? 0) + pairSign(fix.otherId, fix.paidBy) * fix.delta);
    }
    outcomes.push(outcome);
  }
  return outcomes;
};
