import { type ReplayInput, pairKey, pairSign } from './replay';

const rowKey = (groupId: number, currency: string, userId: number, friendId: number) =>
  `${groupId}|${currency}|${userId}|${friendId}`;

/** Rows whose mirror (friend -> user) is missing or not the exact negation. */
export const countMirrorBreaks = (input: ReplayInput) => {
  const balances = new Map(
    input.balances.map((b) => [
      pairKey(b.currency, b.userId, b.friendId) + `|${b.userId}`,
      b.amount,
    ]),
  );
  const balanceBreaks = input.balances.filter(
    (b) =>
      b.amount +
        (balances.get(pairKey(b.currency, b.userId, b.friendId) + `|${b.friendId}`) ?? 0) !==
      0,
  ).length;

  const groupBalances = new Map(
    input.groupBalances.map((b) => [rowKey(b.groupId, b.currency, b.userId, b.friendId), b.amount]),
  );
  const groupBalanceBreaks = input.groupBalances.filter(
    (b) =>
      b.amount + (groupBalances.get(rowKey(b.groupId, b.currency, b.friendId, b.userId)) ?? 0) !==
      0,
  ).length;

  return { balanceBreaks, groupBalanceBreaks };
};

/** Live-expense effect per canonical pair (Balance) and per group row (GroupBalance). */
export const getRawSums = (input: ReplayInput) => {
  const balance = new Map<string, number>();
  const group = new Map<string, Map<number, number>>();

  input.expenses
    .filter((expense) => null === expense.deletedAt)
    .forEach((expense) =>
      expense.participants
        .filter((participant) => participant.userId !== expense.paidBy)
        .forEach((participant) => {
          const key = pairKey(expense.currency, expense.paidBy, participant.userId);
          const delta = pairSign(expense.paidBy, participant.userId) * -participant.amount;
          balance.set(key, (balance.get(key) ?? 0) + delta);
          if (null !== expense.groupId) {
            const groups = group.get(key) ?? new Map<number, number>();
            groups.set(expense.groupId, (groups.get(expense.groupId) ?? 0) + delta);
            group.set(key, groups);
          }
        }),
    );

  return { balance, group };
};

export type RawSums = ReturnType<typeof getRawSums>;

/** Report-only: stored Balance pairs that differ from the sum of their live expenses. */
export const getBalanceDrift = (input: ReplayInput, raw: RawSums) => {
  const stored = new Map<string, { amount: number; imported: boolean }>();
  input.balances
    .filter((b) => b.userId < b.friendId)
    .forEach((b) =>
      stored.set(pairKey(b.currency, b.userId, b.friendId), {
        amount: b.amount,
        imported: b.importedFromSplitwise,
      }),
    );
  input.balances
    .filter((b) => b.userId > b.friendId && b.importedFromSplitwise)
    .forEach((b) => {
      const entry = stored.get(pairKey(b.currency, b.userId, b.friendId));
      if (entry) {
        entry.imported = true;
      }
    });

  const keys = new Set([...stored.keys(), ...raw.balance.keys()]);
  const drifted = [...keys]
    .map((key) => ({
      key,
      stored: stored.get(key)?.amount ?? 0,
      expected: raw.balance.get(key) ?? 0,
      imported: !!stored.get(key)?.imported,
      missing: !stored.has(key),
    }))
    .filter((row) => row.stored !== row.expected);

  return drifted;
};

export type GroupMismatch = {
  key: string;
  groupId: number;
  stored: number;
  raw: number;
  kind: 'zeroed' | 'other';
};

/** GroupBalance rows (lower-id side) that differ from the raw sum of their group's expenses. */
export const getGroupMismatches = (input: ReplayInput, raw: RawSums): GroupMismatch[] => {
  const stored = new Map<string, number>();
  input.groupBalances
    .filter((b) => b.userId < b.friendId)
    .forEach((b) =>
      stored.set(`${pairKey(b.currency, b.userId, b.friendId)}#${b.groupId}`, b.amount),
    );
  raw.group.forEach((groups, key) =>
    groups.forEach((_amount, groupId) => {
      const rowId = `${key}#${groupId}`;
      if (!stored.has(rowId) && input.existingGroupIds.has(groupId)) {
        stored.set(rowId, 0);
      }
    }),
  );

  return [...stored.entries()]
    .map(([rowId, amount]) => {
      const [key = '', groupId = '0'] = rowId.split('#');
      const rawAmount = raw.group.get(key)?.get(Number(groupId)) ?? 0;
      return {
        key,
        groupId: Number(groupId),
        stored: amount,
        raw: rawAmount,
        kind: 0 === amount && 0 !== rawAmount ? ('zeroed' as const) : ('other' as const),
      };
    })
    .filter((row) => row.stored !== row.raw);
};
