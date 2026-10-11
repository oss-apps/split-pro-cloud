import { type ReplayExpense, otherParticipants, pairKey } from './replay';

export type SettlementFinding = {
  expenseId: string;
  paidBy: number;
  otherId: number;
  currency: string;
  groupId: number | null;
  amount: number;
  payerAmount: number | null;
  otherAmount: number;
  edited: boolean;
  /** Change to Balance(other, payer) that the canonical form would make. Never applied. */
  canonicalDelta: number;
  laterSettlements: number;
  laterExpenses: number;
  deletedSettlements: number;
  reason: string;
};

/**
 * Report only. Settlements whose participants are not the canonical payer = +amount,
 * other = -amount. The stored rows do not show what the user meant (most have the other
 * participant at 0, not a sign flip), and users have often settled or added expenses since, so
 * none of these is ever rewritten by the script.
 */
export const findSettlementAnomalies = (
  expenses: ReplayExpense[],
  expenseAmounts: Map<string, number>,
): SettlementFinding[] => {
  const byPair = new Map<string, ReplayExpense[]>();
  expenses.forEach((expense) =>
    new Set(
      otherParticipants(expense).map((p) => pairKey(expense.currency, expense.paidBy, p.userId)),
    ).forEach((key) => {
      const list = byPair.get(key);
      if (list) {
        list.push(expense);
      } else {
        byPair.set(key, [expense]);
      }
    }),
  );

  return expenses
    .filter((expense) => expense.isSettlement && null === expense.deletedAt)
    .flatMap((expense): SettlementFinding[] => {
      const amount = expenseAmounts.get(expense.id) ?? 0;
      const payer = expense.participants.find((p) => p.userId === expense.paidBy);
      const others = otherParticipants(expense);
      const isCanonical =
        payer?.amount === amount && others.every((participant) => participant.amount === -amount);

      if (isCanonical) {
        return [];
      }

      return others.map((other) => {
        const related = (
          byPair.get(pairKey(expense.currency, expense.paidBy, other.userId)) ?? []
        ).filter((candidate) => candidate.id !== expense.id);
        const later = related.filter(
          (candidate) => null === candidate.deletedAt && candidate.createdAt > expense.updatedAt,
        );
        const laterSettlements = later.filter((candidate) => candidate.isSettlement).length;
        const reason =
          1 !== others.length
            ? 'not-two-people'
            : 0 >= amount
              ? 'non-positive-amount'
              : !expense.edited
                ? 'not-edited'
                : 0 === other.amount
                  ? 'other-amount-zero'
                  : 'other-amount-wrong';

        return {
          expenseId: expense.id,
          paidBy: expense.paidBy,
          otherId: other.userId,
          currency: expense.currency,
          groupId: expense.groupId,
          amount,
          payerAmount: payer?.amount ?? null,
          otherAmount: other.amount,
          edited: expense.edited,
          canonicalDelta: -amount - other.amount,
          laterSettlements,
          laterExpenses: later.length - laterSettlements,
          deletedSettlements: related.filter((c) => c.isSettlement && null !== c.deletedAt).length,
          reason,
        };
      });
    });
};
