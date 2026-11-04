import { SplitType, type User } from '@prisma/client';

import { toFixedNumber, toInteger } from '~/utils/numbers';

import {
  type Participant,
  formatSplitShare,
  getRemainingPercentage,
} from '@/store/addExpenseStore';

/**
 * What the split editor shows above the people, like the web's split sections: the amount per
 * person, what is left to assign, or the total shares. Amounts are in major units.
 */
export type SplitStatus =
  | { kind: 'perPerson'; amount: number }
  | { kind: 'remainingPercentage'; percentage: number }
  | { kind: 'remainingAmount'; amount: number }
  | { kind: 'totalShares'; shares: string }
  | { kind: 'remainingToSplit'; amount: number };

const sumSplitShares = (participants: Participant[]) =>
  participants.reduce((total, participant) => total + (participant.splitShare ?? 0), 0);

/** Shares are entered as positive amounts, also for a refund. */
const getRemainingAmount = (amount: number, participants: Participant[]) =>
  toFixedNumber(toInteger(Math.abs(amount)) - toInteger(sumSplitShares(participants)));

export const getSplitStatus = (
  splitType: SplitType,
  participants: Participant[],
  amount: number,
): SplitStatus => {
  switch (splitType) {
    case SplitType.PERCENTAGE:
      return { kind: 'remainingPercentage', percentage: getRemainingPercentage(participants) };
    case SplitType.EXACT:
      return { kind: 'remainingAmount', amount: getRemainingAmount(amount, participants) };
    case SplitType.SHARE:
      return { kind: 'totalShares', shares: formatSplitShare(sumSplitShares(participants)) ?? '0' };
    case SplitType.ADJUSTMENT:
      return { kind: 'remainingToSplit', amount: getRemainingAmount(amount, participants) };
    default: {
      const included = participants.filter((participant) => 0 !== participant.splitShare).length;
      return { kind: 'perPerson', amount: 0 === included ? 0 : amount / included };
    }
  }
};

/**
 * A typed split value as the form stores it: empty or invalid text counts as 0, and exact amounts
 * are rounded to cents, like the web's inputs.
 */
export const parseSplitValue = (text: string, splitType: SplitType) => {
  const value = parseFloat(text.replace(',', '.'));
  if (Number.isNaN(value)) {
    return 0;
  }

  return SplitType.EXACT === splitType ? parseFloat(value.toFixed(2)) : value;
};

/** The text a split input starts with. Exact amounts show as stored, the others rounded. */
export const getSplitInputText = (participant: Participant, splitType: SplitType) =>
  SplitType.EXACT === splitType
    ? (participant.splitShare?.toString() ?? '')
    : (formatSplitShare(participant.splitShare) ?? '');

/** What this person owes towards the expense, negative for a refund they get back. */
export const getParticipantShare = (
  participant: Participant,
  paidBy: Pick<User, 'id'> | undefined,
  amount: number,
) => (paidBy?.id === participant.id ? amount : 0) - (participant.amount ?? 0);

/** Whether everyone is in an equal split. */
export const isEveryoneIncluded = (participants: Participant[]) =>
  participants.every((participant) => 0 !== participant.splitShare);
