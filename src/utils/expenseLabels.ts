export type ShareTone = 'lent' | 'owe' | 'none';

export const SHARE_TONE_CLASS: Record<ShareTone, string> = {
  lent: 'text-emerald-500',
  owe: 'text-orange-600',
  none: 'text-gray-500',
};

/**
 * Labels the current user's net amount on an expense: positive means others owe them, negative
 * means they owe. Refunds (negative expenses) flip the sign, so the label must follow the sign
 * rather than who paid. `amount` is always the absolute value. `undefined` means the user is not
 * part of the expense.
 */
export const getNetShareLabel = (net: number | undefined) => {
  if (undefined === net) {
    return { label: 'Not involved', tone: 'none' as ShareTone, amount: 0 };
  }

  if (0 < net) {
    return { label: 'You lent', tone: 'lent' as ShareTone, amount: net };
  }

  if (0 > net) {
    return { label: 'You owe', tone: 'owe' as ShareTone, amount: -net };
  }

  return { label: 'No balance', tone: 'none' as ShareTone, amount: 0 };
};

/**
 * Labels one participant's share of an expense. `share` is what they owe towards the expense,
 * negative for a refund they get back. `amount` is always the absolute value.
 */
export const getParticipantShareLabel = (share: number, isYou: boolean, name: string) => {
  const verb = 0 > share ? (isYou ? 'get back' : 'gets back') : isYou ? 'owe' : 'owes';

  return { label: `${isYou ? 'You' : name} ${verb}`, amount: Math.abs(share) };
};

type ExpenseWithParticipants = {
  paidBy: number;
  expenseParticipants: { userId: number; amount: number }[];
};

const getParticipantAmount = (expense: ExpenseWithParticipants, userId: number) =>
  expense.expenseParticipants.find((participant) => participant.userId === userId)?.amount ?? 0;

/** The current user's net amount on an expense, or `undefined` when they are not part of it. */
export const getNetForUser = (expense: ExpenseWithParticipants, userId: number) =>
  expense.paidBy === userId ||
  expense.expenseParticipants.some((participant) => participant.userId === userId)
    ? getParticipantAmount(expense, userId)
    : undefined;

/** The current user's net amount with one friend: when you paid, it is what the friend owes you. */
export const getNetWithFriend = (
  expense: ExpenseWithParticipants,
  userId: number,
  friendId: number,
) =>
  expense.paidBy === userId
    ? 0 - getParticipantAmount(expense, friendId)
    : getParticipantAmount(expense, userId);
