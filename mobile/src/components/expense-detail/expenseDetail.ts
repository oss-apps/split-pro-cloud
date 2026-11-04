import { SplitType } from '@prisma/client';

type DetailUser = { id: number; name: string | null; email: string | null; image: string | null };

type DetailExpense = {
  amount: number;
  paidBy: number;
  splitType: SplitType;
  deletedBy: number | null;
  expenseParticipants: { userId: number; amount: number; user: DetailUser }[];
};

/**
 * A line under "X paid": who received a settlement, or what each person owes (`share` in cents,
 * negative for a refund they get back). Like the web's ExpensePage.
 */
export type ParticipantLine =
  | { kind: 'received'; user: DetailUser; isYou: boolean; amount: number }
  | { kind: 'share'; user: DetailUser; isYou: boolean; share: number };

export const getParticipantLines = (expense: DetailExpense, userId: number): ParticipantLine[] => {
  if (SplitType.SETTLEMENT === expense.splitType) {
    return expense.expenseParticipants
      .filter((participant) => participant.userId !== expense.paidBy)
      .map((participant) => ({
        kind: 'received',
        user: participant.user,
        isYou: userId === participant.userId,
        amount: expense.amount,
      }));
  }

  return expense.expenseParticipants.map((participant) => ({
    kind: 'share',
    user: participant.user,
    isYou: userId === participant.userId,
    share: (expense.paidBy === participant.userId ? expense.amount : 0) - participant.amount,
  }));
};

/**
 * How a share looks from the current user's side: `lent` when that person owes them, `owe` when
 * the current user owes the payer, `none` for everything between other people.
 */
export const getShareTone = (
  line: ParticipantLine,
  paidBy: number,
  userId: number,
): 'lent' | 'owe' | 'none' => {
  const amount = 'share' === line.kind ? line.share : line.amount;

  if (0 === amount || 'received' === line.kind) {
    return 'none';
  }

  if (userId === paidBy && !line.isYou) {
    return 0 < amount ? 'lent' : 'owe';
  }

  if (line.isYou && userId !== paidBy) {
    return 0 < amount ? 'owe' : 'lent';
  }

  return 'none';
};

/** A deleted expense can't be changed. */
export const canEditExpense = (expense: Pick<DetailExpense, 'deletedBy'>) =>
  null === expense.deletedBy;

/** The server only lets people in the expense delete it. */
export const canDeleteExpense = (
  expense: Pick<DetailExpense, 'deletedBy' | 'expenseParticipants'>,
  userId: number,
) =>
  canEditExpense(expense) &&
  expense.expenseParticipants.some((participant) => userId === participant.userId);

/** The public URL of a receipt, or `undefined` when the app doesn't know where receipts live. */
export const getReceiptUrl = (publicUrl: string | null, fileKey: string | null) =>
  publicUrl && fileKey ? `${publicUrl.replace(/\/+$/, '')}/${fileKey}` : undefined;
