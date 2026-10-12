import { Prisma } from '@prisma/client';

import { type db } from '~/server/db';

/*
 * History may only be added to balances that are exactly what their expenses add up to. Otherwise
 * something outside SplitPro's expenses already moved that money (a balance-only import whose rows
 * were removed after settling, or older drift), and adding the history would count it twice.
 *
 * Verify once, then compare snapshots:
 * 1. Before saving anything, `checkBalances` adds up the expenses of every pair the import writes
 *    and compares them with the stored rows, in one read-only REPEATABLE READ snapshot (no
 *    serializable read locks on `Expense`). It returns those rows as they were: an amount, or
 *    absent.
 * 2. Each batch transaction locks the same rows (`FOR UPDATE`, in the order the app writes them)
 *    and requires them to be exactly as expected, before writing. After writing, it reads them
 *    back as what the next batch expects.
 *
 * Why that is enough: step 1 proves each pair consistent at that moment. Every write in the app
 * that changes a pair's expenses changes its `Balance` row (and its `GroupBalance` row, for a
 * group) in the same transaction. So a row that is unchanged means nothing changed the pair since,
 * and any change, including removing a friend (which deletes the rows), makes the import stop.
 * The one assumption: no write changes expenses without changing these rows, which would be a bug
 * in the app anyway.
 */

/** A pair's balance in one currency, and its balance in one group when `groupId` is set. */
export type BalanceKey = {
  userId: number;
  friendId: number;
  currency: string;
  groupId: number | null;
};

/** Stored rows by row key: the amount, or null when the row doesn't exist. */
export type BalanceSnapshot = Map<string, number | null>;

/** A balance this import writes to changed since it was checked. */
export class BalancesChangedError extends Error {
  constructor() {
    super('Balances changed during the import. Please run it again.');
  }
}

const key = (...parts: (number | string | null)[]) => parts.join('|');
const balanceRowKey = (userId: number, friendId: number, currency: string) =>
  key('B', userId, friendId, currency);
const groupRowKey = (groupId: number, userId: number, friendId: number, currency: string) =>
  key('G', groupId, userId, friendId, currency);

type BalanceRowId = { userId: number; friendId: number; currency: string };
type GroupRowId = BalanceRowId & { groupId: number };

/** Both rows of every pair, and of every group pair, in the order the app locks them. */
const getRows = (keys: BalanceKey[]) => {
  const balances = new Map<string, BalanceRowId>();
  const groups = new Map<string, GroupRowId>();
  keys
    .filter(({ userId, friendId }) => userId !== friendId)
    .forEach(({ userId, friendId, currency, groupId }) =>
      [
        [userId, friendId],
        [friendId, userId],
      ].forEach(([a, b]) => {
        balances.set(balanceRowKey(a!, b!, currency), { userId: a!, friendId: b!, currency });
        if (null !== groupId) {
          groups.set(groupRowKey(groupId, a!, b!, currency), {
            groupId,
            userId: a!,
            friendId: b!,
            currency,
          });
        }
      }),
    );
  const order = (x: BalanceRowId, y: BalanceRowId) =>
    x.currency.localeCompare(y.currency) || x.userId - y.userId || x.friendId - y.friendId;
  return {
    balances: [...balances.values()].sort(order),
    groups: [...groups.values()].sort((x, y) => x.groupId - y.groupId || order(x, y)),
  };
};

/** Reads the rows of `keys`, locking the ones that exist when `lock` is set. */
const readRows = async (
  client: Prisma.TransactionClient,
  keys: BalanceKey[],
  lock: boolean,
): Promise<BalanceSnapshot> => {
  const { balances, groups } = getRows(keys);
  const snapshot: BalanceSnapshot = new Map();
  balances.forEach((r) => snapshot.set(balanceRowKey(r.userId, r.friendId, r.currency), null));
  groups.forEach((r) =>
    snapshot.set(groupRowKey(r.groupId, r.userId, r.friendId, r.currency), null),
  );
  if (!balances.length) {
    return snapshot;
  }

  const forUpdate = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
  const balanceRows = await client.$queryRaw<
    { userId: number; friendId: number; currency: string; amount: number }[]
  >`
    SELECT b."userId", b."friendId", b.currency, b.amount
    FROM "Balance" b
    JOIN unnest(
      ${balances.map((r) => r.userId)}::int[], ${balances.map((r) => r.friendId)}::int[],
      ${balances.map((r) => r.currency)}::text[]
    ) AS k(u, f, c) ON b."userId" = k.u AND b."friendId" = k.f AND b.currency = k.c
    ORDER BY b.currency, b."userId", b."friendId"
    ${forUpdate}`;
  balanceRows.forEach((r) =>
    snapshot.set(balanceRowKey(r.userId, r.friendId, r.currency), r.amount),
  );

  if (groups.length) {
    const groupRows = await client.$queryRaw<
      { groupId: number; userId: number; friendId: number; currency: string; amount: number }[]
    >`
      SELECT g."groupId", g."userId", g."firendId" AS "friendId", g.currency, g.amount
      FROM "GroupBalance" g
      JOIN unnest(
        ${groups.map((r) => r.groupId)}::int[], ${groups.map((r) => r.userId)}::int[],
        ${groups.map((r) => r.friendId)}::int[], ${groups.map((r) => r.currency)}::text[]
      ) AS k(g, u, f, c)
        ON g."groupId" = k.g AND g."userId" = k.u AND g."firendId" = k.f AND g.currency = k.c
      ORDER BY g."groupId", g.currency, g."userId", g."firendId"
      ${forUpdate}`;
    groupRows.forEach((r) =>
      snapshot.set(groupRowKey(r.groupId, r.userId, r.friendId, r.currency), r.amount),
    );
  }
  return snapshot;
};

/**
 * The pairs among `keys` whose stored rows aren't what their expenses add up to, the way
 * `splitService` keeps them:
 * - `Balance(a, b)` is the sum, over every non-deleted expense in that currency (in any group or
 *   none), of what b owes a in it (`toBalanceRows`), and `Balance(b, a)` is its negation;
 * - `GroupBalance(g, a, b)` is the same sum over the group's expenses, minus the settlement
 *   allocations of the row: a personal settle up that clears a group row records what it cleared
 *   (`captureSettlementAllocations`) and gives it back if undone (`restoreSettlementAllocations`).
 * A missing row counts as 0. Group rows zeroed some other way (before allocations existed, or by
 * hand) are reported too.
 */
const findUnexplained = async (
  client: Prisma.TransactionClient,
  keys: BalanceKey[],
  stored: BalanceSnapshot,
): Promise<BalanceKey[]> => {
  const pairs = new Map<string, { lo: number; hi: number; currency: string }>();
  const groups = new Map<string, { lo: number; hi: number; currency: string; groupId: number }>();
  keys
    .filter(({ userId, friendId }) => userId !== friendId)
    .forEach(({ userId, friendId, currency, groupId }) => {
      const [lo, hi] = userId < friendId ? [userId, friendId] : [friendId, userId];
      pairs.set(key(lo, hi, currency), { lo, hi, currency });
      if (null !== groupId) {
        groups.set(key(groupId, lo, hi, currency), { lo, hi, currency, groupId });
      }
    });
  if (!pairs.size) {
    return [];
  }
  const list = [...pairs.values()];
  const groupList = [...groups.values()];

  const [sums, allocations] = await Promise.all([
    // What hi owes lo, per currency and group, from the expenses.
    client.$queryRaw<
      { lo: number; hi: number; currency: string; groupId: number | null; amount: bigint }[]
    >`
      SELECT k.lo, k.hi, k.currency, e."groupId",
             SUM(CASE WHEN e."paidBy" = k.lo THEN -p.amount ELSE p.amount END)::bigint AS amount
      FROM unnest(
        ${list.map((p) => p.lo)}::int[], ${list.map((p) => p.hi)}::int[],
        ${list.map((p) => p.currency)}::text[]
      ) AS k(lo, hi, currency)
      JOIN "Expense" e
        ON e."paidBy" IN (k.lo, k.hi) AND e.currency = k.currency AND e."deletedAt" IS NULL
      JOIN "ExpenseParticipant" p
        ON p."expenseId" = e.id AND p."userId" = CASE WHEN e."paidBy" = k.lo THEN k.hi ELSE k.lo END
      GROUP BY k.lo, k.hi, k.currency, e."groupId"`,
    groupList.length
      ? client.settlementAllocation.findMany({
          where: {
            OR: groupList.flatMap(({ lo, hi, currency, groupId }) => [
              { groupId, currency, userId: lo, friendId: hi },
              { groupId, currency, userId: hi, friendId: lo },
            ]),
          },
          select: { groupId: true, currency: true, userId: true, friendId: true, amount: true },
        })
      : [],
  ]);

  const owed = new Map<string, number>();
  const owedInGroup = new Map<string, number>();
  sums.forEach(({ lo, hi, currency, groupId, amount }) => {
    const pairKey = key(lo, hi, currency);
    owed.set(pairKey, (owed.get(pairKey) ?? 0) + Number(amount));
    if (null !== groupId) {
      owedInGroup.set(key(groupId, lo, hi, currency), Number(amount));
    }
  });
  const allocated = new Map<string, number>();
  allocations.forEach((a) => {
    const rowKey = groupRowKey(a.groupId, a.userId, a.friendId, a.currency);
    allocated.set(rowKey, (allocated.get(rowKey) ?? 0) + a.amount);
  });

  const unexplained: BalanceKey[] = [];
  list.forEach(({ lo, hi, currency }) => {
    const amount = owed.get(key(lo, hi, currency)) ?? 0;
    if (
      (stored.get(balanceRowKey(lo, hi, currency)) ?? 0) !== amount ||
      (stored.get(balanceRowKey(hi, lo, currency)) ?? 0) !== -amount
    ) {
      unexplained.push({ userId: lo, friendId: hi, currency, groupId: null });
    }
  });
  groupList.forEach(({ lo, hi, currency, groupId }) => {
    const amount = owedInGroup.get(key(groupId, lo, hi, currency)) ?? 0;
    const expected = (a: number, b: number, value: number) =>
      value - (allocated.get(groupRowKey(groupId, a, b, currency)) ?? 0);
    if (
      (stored.get(groupRowKey(groupId, lo, hi, currency)) ?? 0) !== expected(lo, hi, amount) ||
      (stored.get(groupRowKey(groupId, hi, lo, currency)) ?? 0) !== expected(hi, lo, -amount)
    ) {
      unexplained.push({ userId: lo, friendId: hi, currency, groupId });
    }
  });
  return unexplained;
};

/**
 * Step 1: adds up the expenses of every pair in `keys` and compares them with the stored rows, in
 * one read-only REPEATABLE READ snapshot. Returns the pairs that don't match, and the rows as
 * they were, for `assertBalancesUnchanged`.
 */
export const checkBalances = (client: typeof db, keys: BalanceKey[]) =>
  client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const snapshot = await readRows(tx, keys, false);
      return { unexplained: await findUnexplained(tx, keys, snapshot), snapshot };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

/**
 * Step 2, in a balance transaction before it writes: locks the rows of `keys` (when `lock` is
 * set) and throws `BalancesChangedError` unless every one is exactly as `expected`, an amount or
 * absent. A row `expected` doesn't list must be absent: it belongs to an account or group this
 * import created.
 */
export const assertBalancesUnchanged = async (
  tx: Prisma.TransactionClient,
  keys: BalanceKey[],
  expected: BalanceSnapshot,
  { lock = true }: { lock?: boolean } = {},
) => {
  const actual = await readRows(tx, keys, lock);
  if ([...actual].some(([rowKey, amount]) => (expected.get(rowKey) ?? null) !== amount)) {
    throw new BalancesChangedError();
  }
};

/** After writing, in the same transaction: the rows of `keys`, for the next batch to expect. */
export const readBalances = (tx: Prisma.TransactionClient, keys: BalanceKey[]) =>
  readRows(tx, keys, false);

/** The pairs expenses move money between: each payer with everyone else in it. */
export const getBalanceKeys = (
  groupId: number | null,
  expenses: {
    paidBy: number;
    currency: string;
    participants: { userId: number; amount: number }[];
  }[],
): BalanceKey[] =>
  expenses.flatMap(({ paidBy, currency, participants }) =>
    participants
      .filter((participant) => participant.userId !== paidBy)
      .map((participant) => ({
        userId: paidBy,
        friendId: participant.userId,
        currency,
        groupId,
      })),
  );

/** Every pair in `keys` that `checkBalances` found consistent, for tests and scripts. */
export const findUnexplainedBalances = async (client: typeof db, keys: BalanceKey[]) =>
  (await checkBalances(client, keys)).unexplained;
