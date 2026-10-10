import { SplitType } from '@prisma/client';

import { toFixedNumber, toInteger } from './numbers';

const MAX_STORED_AMOUNT = 2_147_483_647;

// These split types can only give each person a share between zero and the full amount.
const PROPORTIONAL_SPLIT_TYPES: SplitType[] = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.SHARE,
];

export class InvalidExpenseError extends Error {}

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
    MAX_STORED_AMOUNT < Math.abs(storedAmount) ||
    storedParticipants.some(
      (participant) =>
        !Number.isFinite(participant.amount) || MAX_STORED_AMOUNT < Math.abs(participant.amount),
    )
  ) {
    throw new InvalidExpenseError('Expense amount is not valid');
  }

  if (
    new Set(storedParticipants.map((participant) => participant.userId)).size !==
    storedParticipants.length
  ) {
    throw new InvalidExpenseError('Expense participants must be unique');
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

  let payer = storedParticipants.find((participant) => participant.userId === paidBy);

  // Some clients dropped the payer from the list. Their row is implied by everyone else's.
  if (!payer) {
    payer = {
      userId: paidBy,
      amount: -storedParticipants.reduce((sum, participant) => sum + participant.amount, 0),
    };
    storedParticipants.push(payer);
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
