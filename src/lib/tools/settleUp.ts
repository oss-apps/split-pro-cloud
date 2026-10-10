import { allocate } from './money';

export interface Person {
  id: string;
  name: string;
}

/**
 * An expense or a payment between two people. Amounts are integers in the currency's minor unit.
 * Without `exact`, the amount is split equally between `splitAmong`. With `exact`, each person in
 * `splitAmong` owes the amount at the same index. A payment is stored as `paidBy` paying for the
 * receiver's whole share, which moves both balances towards zero.
 */
export interface SharedExpense {
  id: string;
  title: string;
  amount: number;
  paidBy: string;
  splitAmong: string[];
  exact?: number[];
  payment?: boolean;
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

export const expenseShares = (expense: SharedExpense) =>
  expense.exact && expense.exact.length === expense.splitAmong.length
    ? expense.exact
    : allocate(
        expense.amount,
        expense.splitAmong.map(() => 1),
      );

export const isExpenseValid = (expense: SharedExpense) =>
  0 < expense.amount &&
  0 < expense.splitAmong.length &&
  (!expense.exact || expense.exact.reduce((acc, part) => acc + part, 0) === expense.amount);

/**
 * What each person paid and owes, and the net (positive means they get money back). Payments
 * count towards the net but not towards what someone spent.
 */
export const computeBalances = (
  people: readonly Person[],
  expenses: readonly SharedExpense[],
): PersonBalance[] => {
  const balances = new Map(people.map((p) => [p.id, { id: p.id, paid: 0, share: 0, net: 0 }]));

  expenses.filter(isExpenseValid).forEach((expense) => {
    const payer = balances.get(expense.paidBy);
    if (!payer) {
      return;
    }
    payer.net += expense.amount;
    if (!expense.payment) {
      payer.paid += expense.amount;
    }
    expenseShares(expense).forEach((part, index) => {
      const participant = balances.get(expense.splitAmong[index] ?? '');
      if (!participant) {
        return;
      }
      participant.net -= part;
      if (!expense.payment) {
        participant.share += part;
      }
    });
  });

  return [...balances.values()];
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
