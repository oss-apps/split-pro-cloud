import { Prisma } from '@prisma/client';

import { type db } from '~/server/db';

/*
 * Clean slate: history from Splitwise is only added between people whose SplitPro history together
 * is nothing but expenses imported from Splitwise history. Between any pair whose balance an import
 * changes, `checkBalances` refuses:
 * - any other expense where one paid and the other takes part, deleted or not, settle ups included;
 * - any settlement allocation between them;
 * - any `Balance` or `GroupBalance` row between them, in any currency or group, that their
 *   non-deleted expenses don't add up to exactly (settlement allocations subtracted in groups).
 * Balance-only imports are refused per person as well (`splitwiseImportLocks`).
 *
 * Why that is sound: what's left between such a pair is explained entirely by Splitwise data, and
 * each scope of it was reconciled against Splitwise's balances when it was imported. Deleted
 * SplitPro data can't be mistaken for Splitwise data: either it never existed between the pair in
 * a non-imported form, or a trace of it remains (a deleted expense keeps its row, a settle up its
 * expense, a balance-only import its rows or its mark). The residual: if people erased every trace
 * themselves (hard deletes, e.g. a whole group), the pair looks new, and so does what they erased.
 *
 * Checked once, then compared per batch:
 * 1. Before saving anything, `checkBalances` runs the checks above in one read-only REPEATABLE
 *    READ snapshot (no serializable read locks on `Expense`), and records every `Balance` row of
 *    each pair (any currency) and every `GroupBalance` row of each pair in the import's group: its
 *    amount and its version (`xmin`), or absent.
 * 2. Each batch locks the same rows (`FOR UPDATE`, in the order the app writes them) and requires
 *    them exactly as recorded before writing. After writing, it reads them back for the next batch.
 *
 * Why step 2 is enough: every write in the app that adds, edits or deletes an expense between two
 * people writes both of their `Balance` rows in that currency in the same transaction, even for a
 * zero share, which gives them a new version. So a non-imported expense, or any other write to the
 * pair, after step 1 stops the import. The one assumption: no write adds an expense between two
 * people without writing their rows, which would be a bug in the app anyway. Removing rows
 * (removing a friend, deleting a settled group) only removes history, and is seen as a change.
 */

/** A pair's balance in one currency, and its balance in one group when `groupId` is set. */
export type BalanceKey = {
  userId: number;
  friendId: number;
  currency: string;
  groupId: number | null;
  /** Whether the import changes this balance; a zero share only touches it. Defaults to true. */
  moves?: boolean;
};

/** Stored rows by row key: `amount@version`. Rows not listed don't exist. */
export type BalanceSnapshot = Map<string, string>;

/** A balance this import writes to changed since it was checked. */
export class BalancesChangedError extends Error {
  constructor() {
    super('Balances changed during the import. Please run it again.');
  }
}

export const NOT_A_CLEAN_SLATE =
  "History can only be imported for people you haven't recorded expenses or payments with in SplitPro yet. Import your Splitwise history before you start adding expenses together here.";

type Pair = { lo: number; hi: number };

const key = (...parts: (number | string | null)[]) => parts.join('|');
const balanceRowKey = (userId: number, friendId: number, currency: string) =>
  key('B', userId, friendId, currency);
const groupRowKey = (groupId: number, userId: number, friendId: number, currency: string) =>
  key('G', groupId, userId, friendId, currency);

const pairsOf = (keys: BalanceKey[], filter: (k: BalanceKey) => boolean = () => true) => {
  const pairs = new Map<string, Pair>();
  keys
    .filter((k) => k.userId !== k.friendId && filter(k))
    .forEach(({ userId, friendId }) => {
      const [lo, hi] = userId < friendId ? [userId, friendId] : [friendId, userId];
      pairs.set(key(lo, hi), { lo, hi });
    });
  return [...pairs.values()].sort((x, y) => x.lo - y.lo || x.hi - y.hi);
};

const groupPairsOf = (keys: BalanceKey[]) => {
  const pairs = new Map<string, Pair & { groupId: number }>();
  keys
    .filter((k) => k.userId !== k.friendId && null !== k.groupId)
    .forEach(({ userId, friendId, groupId }) => {
      const [lo, hi] = userId < friendId ? [userId, friendId] : [friendId, userId];
      pairs.set(key(groupId, lo, hi), { lo, hi, groupId: groupId! });
    });
  return [...pairs.values()];
};

/**
 * Every `Balance` row of the pairs, in any currency, and every `GroupBalance` row of the pairs in
 * the groups of `keys`, with their versions. Locks them when `lock` is set, in the app's order:
 * `Balance` rows by currency, user and friend, then `GroupBalance` rows.
 */
const readRows = async (
  client: Prisma.TransactionClient,
  keys: BalanceKey[],
  lock: boolean,
): Promise<BalanceSnapshot> => {
  const pairs = pairsOf(keys);
  const groupPairs = groupPairsOf(keys);
  const snapshot: BalanceSnapshot = new Map();
  if (!pairs.length) {
    return snapshot;
  }

  const forUpdate = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
  const both = (list: Pair[]) => ({
    users: list.flatMap(({ lo, hi }) => [lo, hi]),
    friends: list.flatMap(({ lo, hi }) => [hi, lo]),
  });
  const { users, friends } = both(pairs);
  const balanceRows = await client.$queryRaw<
    { userId: number; friendId: number; currency: string; amount: number; version: string }[]
  >`
    SELECT b."userId", b."friendId", b.currency, b.amount, b.xmin::text AS version
    FROM "Balance" b
    JOIN unnest(${users}::int[], ${friends}::int[]) AS k(u, f)
      ON b."userId" = k.u AND b."friendId" = k.f
    ORDER BY b.currency, b."userId", b."friendId"
    ${forUpdate}`;
  balanceRows.forEach((r) =>
    snapshot.set(balanceRowKey(r.userId, r.friendId, r.currency), `${r.amount}@${r.version}`),
  );

  if (groupPairs.length) {
    const g = both(groupPairs);
    const groupRows = await client.$queryRaw<
      {
        groupId: number;
        userId: number;
        friendId: number;
        currency: string;
        amount: number;
        version: string;
      }[]
    >`
      SELECT gb."groupId", gb."userId", gb."firendId" AS "friendId", gb.currency, gb.amount,
             gb.xmin::text AS version
      FROM "GroupBalance" gb
      JOIN unnest(
        ${groupPairs.flatMap((p) => [p.groupId, p.groupId])}::int[], ${g.users}::int[],
        ${g.friends}::int[]
      ) AS k(g, u, f)
        ON gb."groupId" = k.g AND gb."userId" = k.u AND gb."firendId" = k.f
      ORDER BY gb."groupId", gb.currency, gb."userId", gb."firendId"
      ${forUpdate}`;
    groupRows.forEach((r) =>
      snapshot.set(
        groupRowKey(r.groupId, r.userId, r.friendId, r.currency),
        `${r.amount}@${r.version}`,
      ),
    );
  }
  return snapshot;
};

/** Pairs with SplitPro history other than imported expenses: other expenses, or allocations. */
const findHistory = async (client: Prisma.TransactionClient, pairs: Pair[]) => {
  if (!pairs.length) {
    return [];
  }
  const { users, friends } = {
    users: pairs.flatMap(({ lo, hi }) => [lo, hi]),
    friends: pairs.flatMap(({ lo, hi }) => [hi, lo]),
  };
  // Each direction on its own: who paid (`Expense.paidBy` index), then the other person in it
  // (`ExpenseParticipant` primary key). Deleted expenses count.
  const rows = await client.$queryRaw<{ payer: number; other: number }[]>`
    SELECT k.payer, k.other
    FROM unnest(${users}::int[], ${friends}::int[]) AS k(payer, other)
    WHERE EXISTS (
        SELECT 1 FROM "Expense" e
        JOIN "ExpenseParticipant" p ON p."expenseId" = e.id AND p."userId" = k.other
        WHERE e."paidBy" = k.payer AND e."splitwiseExpenseId" IS NULL)
      OR EXISTS (
        SELECT 1 FROM "SettlementAllocation" a
        WHERE a."userId" = k.payer AND a."friendId" = k.other)`;
  return pairsOf(
    rows.map((r) => ({ userId: r.payer, friendId: r.other, currency: '', groupId: null })),
  );
};

/**
 * Pairs whose stored rows, in any currency and any group, aren't what their non-deleted expenses
 * add up to, the way `splitService` keeps them:
 * - `Balance(a, b)` is the sum over their expenses in that currency (in any group or none) of what
 *   b owes a in it (`toBalanceRows`), and `Balance(b, a)` is its negation;
 * - `GroupBalance(g, a, b)` is the same over the group's expenses, minus the settlement
 *   allocations of the row (`captureSettlementAllocations`, `restoreSettlementAllocations`).
 * A missing row counts as 0.
 */
const findUnexplained = async (client: Prisma.TransactionClient, pairs: Pair[]) => {
  if (!pairs.length) {
    return [];
  }
  const los = pairs.map((p) => p.lo);
  const his = pairs.map((p) => p.hi);
  const [sums, balances, groupBalances, allocations] = await Promise.all([
    // What hi owes lo, per currency and group, from the expenses.
    client.$queryRaw<
      { lo: number; hi: number; currency: string; groupId: number | null; amount: bigint }[]
    >`
      SELECT k.lo, k.hi, e.currency, e."groupId",
             SUM(CASE WHEN e."paidBy" = k.lo THEN -p.amount ELSE p.amount END)::bigint AS amount
      FROM unnest(${los}::int[], ${his}::int[]) AS k(lo, hi)
      JOIN "Expense" e ON e."paidBy" IN (k.lo, k.hi) AND e."deletedAt" IS NULL
      JOIN "ExpenseParticipant" p
        ON p."expenseId" = e.id AND p."userId" = CASE WHEN e."paidBy" = k.lo THEN k.hi ELSE k.lo END
      GROUP BY k.lo, k.hi, e.currency, e."groupId"`,
    client.$queryRaw<{ userId: number; friendId: number; currency: string; amount: number }[]>`
      SELECT b."userId", b."friendId", b.currency, b.amount
      FROM "Balance" b
      JOIN unnest(${[...los, ...his]}::int[], ${[...his, ...los]}::int[]) AS k(u, f)
        ON b."userId" = k.u AND b."friendId" = k.f`,
    client.$queryRaw<
      { groupId: number; userId: number; friendId: number; currency: string; amount: number }[]
    >`
      SELECT gb."groupId", gb."userId", gb."firendId" AS "friendId", gb.currency, gb.amount
      FROM "GroupBalance" gb
      JOIN unnest(${[...los, ...his]}::int[], ${[...his, ...los]}::int[]) AS k(u, f)
        ON gb."userId" = k.u AND gb."firendId" = k.f`,
    client.$queryRaw<
      { groupId: number; userId: number; friendId: number; currency: string; amount: number }[]
    >`
      SELECT a."groupId", a."userId", a."friendId", a.currency, a.amount
      FROM "SettlementAllocation" a
      JOIN unnest(${[...los, ...his]}::int[], ${[...his, ...los]}::int[]) AS k(u, f)
        ON a."userId" = k.u AND a."friendId" = k.f`,
  ]);

  // Everything per directed row: what the expenses say, and what is stored.
  const expected = new Map<string, number>();
  const stored = new Map<string, number>();
  const add = (map: Map<string, number>, rowKey: string, amount: number) =>
    map.set(rowKey, (map.get(rowKey) ?? 0) + amount);
  sums.forEach(({ lo, hi, currency, groupId, amount }) => {
    const value = Number(amount);
    add(expected, balanceRowKey(lo, hi, currency), value);
    add(expected, balanceRowKey(hi, lo, currency), -value);
    if (null !== groupId) {
      add(expected, groupRowKey(groupId, lo, hi, currency), value);
      add(expected, groupRowKey(groupId, hi, lo, currency), -value);
    }
  });
  allocations.forEach((a) =>
    add(expected, groupRowKey(a.groupId, a.userId, a.friendId, a.currency), -a.amount),
  );
  balances.forEach((b) => stored.set(balanceRowKey(b.userId, b.friendId, b.currency), b.amount));
  groupBalances.forEach((b) =>
    stored.set(groupRowKey(b.groupId, b.userId, b.friendId, b.currency), b.amount),
  );

  const unexplained = new Map<string, BalanceKey>();
  new Set([...expected.keys(), ...stored.keys()]).forEach((rowKey) => {
    if ((expected.get(rowKey) ?? 0) === (stored.get(rowKey) ?? 0)) {
      return;
    }
    const parts = rowKey.split('|');
    const [groupId, a, b, currency] =
      'G' === parts[0]
        ? [Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4]!]
        : [null, Number(parts[1]), Number(parts[2]), parts[3]!];
    const [lo, hi] = a < b ? [a, b] : [b, a];
    unexplained.set(key(groupId, lo, hi, currency), {
      userId: lo,
      friendId: hi,
      currency,
      groupId,
    });
  });
  return [...unexplained.values()];
};

/**
 * Step 1: in one read-only REPEATABLE READ snapshot, finds the pairs of `keys` that aren't a clean
 * slate (history other than imported expenses between pairs whose balance changes, or rows their
 * expenses don't explain), and records their rows for `assertBalancesUnchanged`.
 */
export const checkBalances = (client: typeof db, keys: BalanceKey[]) =>
  client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const snapshot = await readRows(tx, keys, false);
      const pairs = pairsOf(keys);
      const [withHistory, unexplained] = await Promise.all([
        findHistory(
          tx,
          pairsOf(keys, (k) => false !== k.moves),
        ),
        findUnexplained(tx, pairs),
      ]);
      return { withHistory, unexplained, snapshot };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

/**
 * Step 2, in a balance transaction before it writes: locks the rows of `keys` (when `lock` is
 * set) and throws `BalancesChangedError` unless they are exactly as `expected`: the same rows, with
 * the same amounts and versions.
 */
export const assertBalancesUnchanged = async (
  tx: Prisma.TransactionClient,
  keys: BalanceKey[],
  expected: BalanceSnapshot,
  { lock = true }: { lock?: boolean } = {},
) => {
  const actual = await readRows(tx, keys, lock);
  // `expected` can hold rows of other pairs, written by earlier batches: compare the ones read here.
  const pairs = new Set(pairsOf(keys).map(({ lo, hi }) => key(lo, hi)));
  const groupPairs = new Set(groupPairsOf(keys).map(({ groupId, lo, hi }) => key(groupId, lo, hi)));
  const isRead = (rowKey: string) => {
    const [table, ...rest] = rowKey.split('|');
    const [groupId, a, b] = 'G' === table ? rest.map(Number) : [null, ...rest.map(Number)];
    const pair = key(Math.min(a!, b!), Math.max(a!, b!));
    return 'G' === table ? groupPairs.has(key(groupId, pair)) : pairs.has(pair);
  };
  const changed = [...new Set([...actual.keys(), ...expected.keys()])]
    .filter(isRead)
    .some((rowKey) => expected.get(rowKey) !== actual.get(rowKey));
  if (changed) {
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
        moves: 0 !== participant.amount,
      })),
  );

/** The pairs of `keys` whose rows their expenses don't explain, for tests and scripts. */
export const findUnexplainedBalances = async (client: typeof db, keys: BalanceKey[]) =>
  (await checkBalances(client, keys)).unexplained;
