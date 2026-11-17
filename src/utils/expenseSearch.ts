import { SplitType } from '@prisma/client';
import { getCategoryLabel } from '~/lib/categories';

/** The category filter that keeps only settlements. No stored category has this key. */
export const SETTLEMENTS_FILTER = 'settlements';

export type ExpenseFilter = {
  query: string;
  /** A category key, `SETTLEMENTS_FILTER`, or null for everything. */
  category: string | null;
};

export type SearchableExpense = {
  name: string;
  category: string;
  amount: number;
  splitType: SplitType;
};

/** Lowercase without accents, so "cafe" finds "Café". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The filter key of an expense: its category, or `SETTLEMENTS_FILTER` for a settlement. */
export const getFilterKey = (expense: SearchableExpense) =>
  expense.splitType === SplitType.SETTLEMENT ? SETTLEMENTS_FILTER : expense.category;

export const getFilterLabel = (key: string) =>
  SETTLEMENTS_FILTER === key ? 'Settlements' : getCategoryLabel(key);

/**
 * Whether a number typed in the search matches an amount in cents. "45" matches 45.00 to 45.99,
 * "45.5" matches 45.50 to 45.59 and "45,50" matches 45.50, whatever the sign of the amount.
 */
const matchesAmount = (term: string, amount: number) => {
  const match = /^(\d+)(?:[.,](\d{0,2}))?$/.exec(term);
  if (!match) {
    return false;
  }

  const [units, cents] = (Math.abs(amount) / 100).toFixed(2).split('.');
  return units === String(Number(match[1])) && (cents ?? '').startsWith(match[2] ?? '');
};

/**
 * Whether every word of the query is found in the expense name, its category, one of `otherText`
 * (payer, group…) or its amount.
 */
export const matchesExpenseQuery = (
  expense: SearchableExpense,
  query: string,
  otherText: (string | null | undefined)[] = [],
) => {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (0 === terms.length) {
    return true;
  }

  const text = normalize(
    [expense.name, getFilterLabel(getFilterKey(expense)), ...otherText].filter(Boolean).join('\n'),
  );

  return terms.every((term) => text.includes(term) || matchesAmount(term, expense.amount));
};

export const filterExpenses = <T extends SearchableExpense>(
  expenses: T[],
  filter: ExpenseFilter,
  getOtherText?: (expense: T) => (string | null | undefined)[],
) =>
  expenses.filter(
    (expense) =>
      (null === filter.category || getFilterKey(expense) === filter.category) &&
      matchesExpenseQuery(expense, filter.query, getOtherText?.(expense)),
  );

/** The filter keys found in a list, most used first, for the category chips. */
export const getFilterOptions = (expenses: SearchableExpense[]) => {
  const counts = new Map<string, number>();
  for (const expense of expenses) {
    const key = getFilterKey(expense);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([keyA, countA], [keyB, countB]) => countB - countA || keyA.localeCompare(keyB))
    .map(([key]) => ({ key, label: getFilterLabel(key) }));
};
