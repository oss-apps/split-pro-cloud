import { allocate, parseAmount } from './money';

export interface Person {
  id: string;
  name: string;
}

export interface SharedExpense {
  id: string;
  title: string;
  amount: string;
  paidBy: string;
  splitAmong: string[];
}

export interface PersonBalance {
  id: string;
  paid: number;
  share: number;
  net: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** What each person paid, what their share was, and the net (positive means they get money). */
export const computeBalances = (
  people: readonly Person[],
  expenses: readonly SharedExpense[],
  currency: string,
): PersonBalance[] => {
  const balances = new Map(people.map((p) => [p.id, { id: p.id, paid: 0, share: 0, net: 0 }]));

  expenses.forEach((expense) => {
    const amount = parseAmount(expense.amount, currency);
    const payer = balances.get(expense.paidBy);
    const participants = expense.splitAmong.filter((id) => balances.has(id));
    if (!amount || !payer || 0 === participants.length) {
      return;
    }
    payer.paid += amount;
    allocate(
      amount,
      participants.map(() => 1),
    ).forEach((part, index) => {
      const participant = balances.get(participants[index] ?? '');
      if (participant) {
        participant.share += part;
      }
    });
  });

  return [...balances.values()].map((b) => ({ ...b, net: b.paid - b.share }));
};

/**
 * Turns net balances into payments. Each step pays the biggest debt to the biggest creditor, so
 * at least one person is settled per payment and the group needs at most (people - 1) transfers.
 */
export const computeTransfers = (balances: readonly PersonBalance[]): Transfer[] => {
  const creditors = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ id: b.id, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ id: b.id, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!;
    const debtor = debtors[d]!;
    const amount = Math.min(creditor.amount, debtor.amount);
    if (amount > 0) {
      transfers.push({ from: debtor.id, to: creditor.id, amount });
    }
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (0 === creditor.amount) {
      c += 1;
    }
    if (0 === debtor.amount) {
      d += 1;
    }
  }
  return transfers;
};

/** How many payments it would take if everyone paid back each expense directly. */
export const countDirectPayments = (expenses: readonly SharedExpense[], currency: string) => {
  const pairs = new Set<string>();
  expenses.forEach((expense) => {
    if (!parseAmount(expense.amount, currency)) {
      return;
    }
    expense.splitAmong
      .filter((id) => id !== expense.paidBy)
      .forEach((id) => pairs.add(`${id}->${expense.paidBy}`));
  });
  return pairs.size;
};
