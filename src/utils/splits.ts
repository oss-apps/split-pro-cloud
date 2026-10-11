import { SplitType } from '@prisma/client';

import { AMOUNT_TOO_LARGE_MESSAGE, MAX_AMOUNT_CENTS, toFixedNumber, toInteger } from './numbers';

// These split types can only give each person a share between zero and the full amount.
const PROPORTIONAL_SPLIT_TYPES: SplitType[] = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.SHARE,
];

export class InvalidExpenseError extends Error {}

/**
 * A group settlement is a payment from the payer to exactly one other member: the payer is owed
 * the full amount (+amount) and the other person owes it (-amount).
 */
export const assertGroupSettlement = (
  amount: number,
  paidBy: number,
  participants: { userId: number; amount: number }[],
) => {
  const storedAmount = toInteger(amount);
  const payer = participants.find((participant) => participant.userId === paidBy);
  const receivers = participants.filter((participant) => participant.userId !== paidBy);
  const [receiver] = receivers;

  if (2 !== participants.length || !payer || !receiver || 1 !== receivers.length) {
    throw new InvalidExpenseError(
      'A group settlement must be between the payer and one other member',
    );
  }

  if (!Number.isFinite(storedAmount) || 0 >= storedAmount) {
    throw new InvalidExpenseError('A settlement amount must be more than zero');
  }

  if (storedAmount !== toInteger(payer.amount) || -storedAmount !== toInteger(receiver.amount)) {
    throw new InvalidExpenseError(
      'A settlement must move the full amount from one person to the other',
    );
  }
};

/**
 * Validates and normalizes participant amounts before they change any balance.
 *
 * Stored participant amounts are what each person is owed (positive) or owes (negative), so they
 * add up to zero. A negative expense (a refund) mirrors the signs: the payer owes, others are owed.
 */
export const toBalancedParticipants = (
  amount: number,
  paidBy: number,
  participants: { userId: number; amount: number }[],
  splitType: SplitType,
) => {
  const storedAmount = toInteger(amount);
  const storedParticipants = participants.map((participant) => ({
    userId: participant.userId,
    amount: toInteger(participant.amount),
  }));

  if (
    !Number.isFinite(storedAmount) ||
    storedParticipants.some((participant) => !Number.isFinite(participant.amount))
  ) {
    throw new InvalidExpenseError('Expense amount is not valid');
  }

  if (
    MAX_AMOUNT_CENTS < Math.abs(storedAmount) ||
    storedParticipants.some((participant) => MAX_AMOUNT_CENTS < Math.abs(participant.amount))
  ) {
    throw new InvalidExpenseError(AMOUNT_TOO_LARGE_MESSAGE);
  }

  if (
    new Set(storedParticipants.map((participant) => participant.userId)).size !==
    storedParticipants.length
  ) {
    throw new InvalidExpenseError('Expense participants must be unique');
  }

  if (!storedParticipants.some((participant) => participant.userId === paidBy)) {
    throw new InvalidExpenseError('The payer must be one of the participants');
  }

  if (SplitType.SETTLEMENT === splitType) {
    const others = storedParticipants.filter((participant) => participant.userId !== paidBy);
    const [receiver] = others;

    if (!receiver || 1 !== others.length) {
      throw new InvalidExpenseError('A settlement must be between two people');
    }

    return [
      { userId: paidBy, amount: toFixedNumber(storedAmount) },
      { userId: receiver.userId, amount: toFixedNumber(-storedAmount) },
    ];
  }

  const payer = storedParticipants.find((participant) => participant.userId === paidBy);
  if (!payer) {
    throw new InvalidExpenseError('The payer must be one of the participants');
  }

  const imbalance = storedParticipants.reduce((sum, participant) => sum + participant.amount, 0);
  if (storedParticipants.length < Math.abs(imbalance)) {
    throw new InvalidExpenseError('Participant amounts must add up to the expense amount');
  }

  // Old clients rounded each participant independently. Correct only that bounded rounding drift.
  payer.amount -= imbalance;

  if (PROPORTIONAL_SPLIT_TYPES.includes(splitType)) {
    const sign = 0 > storedAmount ? -1 : 1;
    const tolerance = storedParticipants.length;
    const hasInvalidParticipant = storedParticipants.some((participant) => {
      const signedAmount = participant.amount * sign;

      if (participant.userId === paidBy) {
        return 0 > signedAmount || Math.abs(storedAmount) + tolerance < signedAmount;
      }

      return 0 < signedAmount;
    });

    if (hasInvalidParticipant) {
      throw new InvalidExpenseError('Participant amounts do not match the expense amount');
    }
  }

  return storedParticipants.map((participant) => ({
    userId: participant.userId,
    amount: toFixedNumber(participant.amount),
  }));
};
