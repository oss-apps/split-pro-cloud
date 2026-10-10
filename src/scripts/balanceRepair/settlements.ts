import { type ReplayExpense, pairKey } from './replay';

export type SettlementFix = {
  expenseId: string;
  paidBy: number;
  otherId: number;
  currency: string;
  groupId: number | null;
  amount: number;
  payerAmount: number | null;
  otherAmount: number;
  updatedAt: number;
  /**
   * Correction to `Balance(otherId, paidBy)` (and the group row if any). `Balance(paidBy,
   * otherId)` moves by the negation.
   */
  delta: number;
  status: 'auto' | 'manual';
  reason: string;
};

/**
 * Settlements whose participants are not the canonical payer = +amount, other = -amount
 * (`Settleup.tsx` and PR #2's `toBalancedParticipants`). The old expense editor flipped the
 * signs a second time when a settlement was saved through it.
 */
export const planSettlementFixes = (
  expenses: ReplayExpense[],
  expenseAmounts: Map<string, number>,
): SettlementFix[] => {
  const settlementsByPair = new Map<string, ReplayExpense[]>();
  expenses
    .filter((expense) => expense.isSettlement && null === expense.deletedAt)
    .forEach((expense) =>
      expense.participants
        .filter((participant) => participant.userId !== expense.paidBy)
        .forEach((participant) => {
          const key = pairKey(expense.currency, expense.paidBy, participant.userId);
          settlementsByPair.set(key, [...(settlementsByPair.get(key) ?? []), expense]);
        }),
    );

  return expenses
    .filter((expense) => expense.isSettlement && null === expense.deletedAt)
    .flatMap((expense): SettlementFix[] => {
      const amount = expenseAmounts.get(expense.id) ?? 0;
      const payer = expense.participants.find((p) => p.userId === expense.paidBy);
      const others = expense.participants.filter((p) => p.userId !== expense.paidBy);
      const isCanonical =
        payer?.amount === amount && others.every((participant) => participant.amount === -amount);

      if (isCanonical) {
        return [];
      }

      return others.map((other) => {
        const key = pairKey(expense.currency, expense.paidBy, other.userId);
        const laterSettlement = (settlementsByPair.get(key) ?? []).some(
          (candidate) => candidate.id !== expense.id && candidate.createdAt > expense.updatedAt,
        );
        const reason =
          1 !== others.length
            ? 'not-two-people'
            : 0 >= amount
              ? 'non-positive-amount'
              : !expense.edited
                ? 'not-edited'
                : laterSettlement
                  ? 'later-settlement-between-pair'
                  : 'edited-settlement-sign-flip';

        return {
          expenseId: expense.id,
          paidBy: expense.paidBy,
          otherId: other.userId,
          currency: expense.currency,
          groupId: expense.groupId,
          amount,
          payerAmount: payer?.amount ?? null,
          otherAmount: other.amount,
          updatedAt: expense.updatedAt,
          delta: -amount - other.amount,
          status: 'edited-settlement-sign-flip' === reason ? 'auto' : 'manual',
          reason,
        };
      });
    });
};
