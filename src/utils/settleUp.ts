import { SplitType } from '@prisma/client';

type GroupBucket = {
  groupId: number;
  name: string | null;
  amount: number;
  canSettle: boolean;
};

type CurrencyBreakdown = {
  currency: string;
  total: number;
  nonGroup: number;
  groups: GroupBucket[];
};

/** Where a friend payment goes: all balances with the friend, or one shared group. */
export type SettleUpDestinationId = 'all' | number;

export type SettleUpDestination = {
  id: SettleUpDestinationId;
  label: string;
  hint?: string;
  /** From the current user's side: positive means the friend owes the current user. */
  amount: number;
  disabled: boolean;
};

/** What the user picked, and which way the money was going when they picked it. */
export type SettleUpSelection = {
  id: SettleUpDestinationId;
  amount: number;
};

export type ResolvedSelection =
  | { status: 'none' }
  | { status: 'stale' }
  | { status: 'ok'; destination: SettleUpDestination };

const canSettleGroup = (group: GroupBucket) => group.canSettle && 0 !== group.amount;

/**
 * Currencies with something to settle: a non-zero overall total, or a group that can be settled
 * even when the groups cancel out overall.
 */
export const getSettleableCurrencies = <T extends CurrencyBreakdown>(breakdown: T[]) =>
  breakdown.filter((b) => 0 !== b.total || b.groups.some(canSettleGroup));

/**
 * "All balances" is a personal payment of the overall total, so it is only offered when that total
 * is not zero. Each shared group is offered as a group payment.
 */
export const getSettleUpDestinations = (breakdown: CurrencyBreakdown): SettleUpDestination[] => [
  ...(0 === breakdown.total
    ? []
    : [
        {
          id: 'all' as const,
          label: 'All balances',
          hint: breakdown.groups.length ? 'Paying it all settles every group too' : undefined,
          amount: breakdown.total,
          disabled: false,
        },
      ]),
  ...breakdown.groups
    .filter((group) => 0 !== group.amount)
    .map((group) => ({
      id: group.groupId,
      label: group.name ?? 'A group you left',
      hint: group.canSettle ? undefined : 'Not in this group anymore',
      amount: group.amount,
      disabled: !group.canSettle,
    })),
];

/** The destination to pick for the user when there is only one choice. */
export const getDefaultSelection = (
  destinations: SettleUpDestination[],
): SettleUpSelection | undefined => {
  const enabled = destinations.filter((d) => !d.disabled);
  const [only] = enabled;
  const all = enabled.find((d) => 'all' === d.id);
  const destination = all ?? (1 === enabled.length ? only : undefined);

  return destination ? { id: destination.id, amount: destination.amount } : undefined;
};

/**
 * Finds the selected destination in the latest balances. A destination that is gone, can no
 * longer be settled, or now goes the other way is stale: it is never swapped for another one.
 */
export const resolveSelection = (
  destinations: SettleUpDestination[],
  selection: SettleUpSelection | undefined,
): ResolvedSelection => {
  if (!selection) {
    return { status: 'none' };
  }

  const destination = destinations.find((d) => d.id === selection.id);
  if (
    !destination ||
    destination.disabled ||
    Math.sign(destination.amount) !== Math.sign(selection.amount)
  ) {
    return { status: 'stale' };
  }

  return { status: 'ok', destination };
};

/** The mutation input for a payment to the selected destination. */
export const buildSettleUpPayment = ({
  destination,
  currency,
  value,
  currentUserId,
  friendId,
  expenseDate,
}: {
  destination: SettleUpDestination;
  currency: string;
  value: number;
  currentUserId: number;
  friendId: number;
  /** Undefined records the payment now. */
  expenseDate?: Date;
}) => {
  const isCurrentUserPaying = 0 > destination.amount;
  const payment = {
    name: 'Settle up',
    currency,
    amount: value,
    splitType: SplitType.SETTLEMENT,
    participants: [
      { userId: currentUserId, amount: isCurrentUserPaying ? value : -value },
      { userId: friendId, amount: isCurrentUserPaying ? -value : value },
    ],
    paidBy: isCurrentUserPaying ? currentUserId : friendId,
    category: 'general',
    ...(expenseDate ? { expenseDate } : {}),
  };

  return 'all' === destination.id
    ? { kind: 'personal' as const, payment }
    : { kind: 'group' as const, payment: { ...payment, groupId: destination.id } };
};
