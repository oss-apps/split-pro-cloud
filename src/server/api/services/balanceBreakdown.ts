import { db } from '~/server/db';

export type GroupBalanceBucket = {
  groupId: number;
  /** Null when the caller is no longer in the group. */
  name: string | null;
  amount: number;
  /** Both people are still in the group, so a payment can be recorded there. */
  canSettle: boolean;
};

export type FriendBalanceBreakdown = {
  currency: string;
  total: number;
  nonGroup: number;
  groups: GroupBalanceBucket[];
};

/**
 * Splits the caller's overall balance with a friend into each shared group and the rest
 * (expenses and payments outside any group). Amounts are from the caller's side: positive means
 * the friend owes the caller.
 */
export const getBalanceBreakdownWithFriend = async (
  userId: number,
  friendId: number,
): Promise<FriendBalanceBreakdown[]> => {
  const [balances, groupBalances] = await Promise.all([
    db.balance.findMany({ where: { userId, friendId } }),
    db.groupBalance.findMany({
      where: { userId, firendId: friendId, amount: { not: 0 } },
      include: {
        group: {
          select: {
            name: true,
            groupUsers: {
              where: { userId: { in: [userId, friendId] } },
              select: { userId: true },
            },
          },
        },
      },
      orderBy: { groupId: 'asc' },
    }),
  ]);

  const currencies = [
    ...new Set([
      ...balances.filter((balance) => 0 !== balance.amount).map((balance) => balance.currency),
      ...groupBalances.map((balance) => balance.currency),
    ]),
  ];

  return currencies
    .map((currency) => {
      const total = balances.find((balance) => balance.currency === currency)?.amount ?? 0;
      const groups = groupBalances
        .filter((balance) => balance.currency === currency)
        .map((balance) => {
          const memberIds = balance.group.groupUsers.map((groupUser) => groupUser.userId);
          const isMember = memberIds.includes(userId);

          return {
            groupId: balance.groupId,
            name: isMember ? balance.group.name : null,
            amount: balance.amount,
            canSettle: isMember && memberIds.includes(friendId),
          };
        });
      const groupTotal = groups.reduce((sum, group) => sum + group.amount, 0);

      return { currency, total, nonGroup: total - groupTotal, groups };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
};
