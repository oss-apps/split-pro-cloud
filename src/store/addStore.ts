import { type Group, SplitType, type User } from '@prisma/client';
import { create } from 'zustand';
import { toFixedNumber, toInteger } from '~/utils/numbers';

export type Participant = User & { amount?: number; splitShare?: number };

interface AddExpenseState {
  amount: number;
  amountStr: string;
  currentUser: User | undefined;
  splitType: SplitType;
  group: Group | undefined;
  participants: Array<Participant>;
  description: string;
  currency: string;
  /** The user's default currency, restored for every new expense. */
  preferredCurrency: string | undefined;
  category: string;
  nameOrEmail: string;
  paidBy: User | undefined;
  showFriends: boolean;
  isFileUploading: boolean;
  fileKey?: string;
  canSplitScreenClosed: boolean;
  splitScreenOpen: boolean;
  expenseDate: Date | undefined;
  actions: {
    setAmount: (amount: number) => void;
    setAmountStr: (amountStr: string) => void;
    setSplitType: (splitType: SplitType) => void;
    setGroup: (group: Group | undefined) => void;
    addOrUpdateParticipant: (user: Participant) => void;
    setParticipants: (participants: Array<Participant>) => void;
    removeParticipant: (userId: number) => void;
    removeLastParticipant: () => void;
    setCurrency: (currency: string) => void;
    setPreferredCurrency: (currency: string) => void;
    setCategory: (category: string) => void;
    setNameOrEmail: (nameOrEmail: string) => void;
    setPaidBy: (user: User) => void;
    setCurrentUser: (user: User) => void;
    setDescription: (description: string) => void;
    setFileUploading: (isFileUploading: boolean) => void;
    setFileKey: (fileKey: string) => void;
    resetState: () => void;
    setSplitScreenOpen: (splitScreenOpen: boolean) => void;
    setExpenseDate: (expenseDate: Date | undefined) => void;
  };
}

// A removed payer can't stay selected as the payer, so the current user pays instead.
const splitWithoutRemoved = (state: AddExpenseState, participants: Array<Participant>) => {
  const paidBy = participants.some((p) => p.id === state.paidBy?.id)
    ? state.paidBy
    : state.currentUser;

  return {
    paidBy,
    ...calculateParticipantSplit(state.amount, participants, state.splitType, paidBy),
  };
};

export const useAddExpenseStore = create<AddExpenseState>()((set) => ({
  amount: 0,
  amountStr: '',
  splitType: SplitType.EQUAL,
  group: undefined,
  participants: [],
  currency: 'USD',
  preferredCurrency: undefined,
  category: 'general',
  nameOrEmail: '',
  paidBy: undefined,
  currentUser: undefined,
  description: '',
  showFriends: true,
  isFileUploading: false,
  fileKey: undefined,
  canSplitScreenClosed: true,
  splitScreenOpen: false,
  expenseDate: undefined,
  actions: {
    setAmount: (amount) =>
      set((s) => {
        const { participants, canSplitScreenClosed } = calculateParticipantSplit(
          amount,
          s.participants,
          s.splitType,
          s.paidBy,
        );

        return { amount, participants, canSplitScreenClosed };
      }),
    setAmountStr: (amountStr) => set({ amountStr }),
    setSplitType: (splitType) =>
      set((state) => {
        // Without an amount there is nothing to rebuild shares from, so keep the current ones
        const participants =
          0 === state.amount
            ? state.participants
            : calculateSplitShareBasedOnAmount(
                state.amount,
                state.participants,
                splitType,
                state.paidBy,
              );

        return {
          splitType,
          ...calculateParticipantSplit(state.amount, participants, splitType, state.paidBy),
        };
      }),
    setGroup: (group) => {
      set({ group });
    },
    addOrUpdateParticipant: (user) =>
      set((state) => {
        const participants = [...state.participants];
        const userIndex = participants.findIndex((p) => p.id === user.id);
        if (userIndex !== -1) {
          participants[userIndex] = user;
        } else {
          participants.push({ ...user, splitShare: state.splitType === SplitType.EQUAL ? 1 : 0 });
        }
        return {
          ...calculateParticipantSplit(state.amount, participants, state.splitType, state.paidBy),
        };
      }),
    setParticipants: (_participants) =>
      set((state) => {
        const participants = _participants.map((p) => ({
          splitShare: state.splitType === SplitType.EQUAL ? 1 : 0,
          ...p,
        }));
        return {
          splitType: SplitType.EQUAL,
          ...calculateParticipantSplit(state.amount, participants, SplitType.EQUAL, state.paidBy),
        };
      }),
    removeLastParticipant: () => {
      set((state) => {
        if (state.participants.length === 1) return {};
        const newParticipants = [...state.participants];
        newParticipants.pop();
        return splitWithoutRemoved(state, newParticipants);
      });
    },
    removeParticipant: (userId) => {
      set((state) => {
        const newParticipants = state.participants.filter((p) => p.id !== userId);
        return splitWithoutRemoved(state, newParticipants);
      });
    },
    setCurrency: (currency) => set({ currency }),
    setPreferredCurrency: (preferredCurrency) => set({ preferredCurrency }),
    setCategory: (category) => set({ category }),
    setNameOrEmail: (nameOrEmail) => set({ nameOrEmail, showFriends: nameOrEmail.length > 0 }),
    setPaidBy: (paidBy) =>
      set((s) => ({
        paidBy,
        ...calculateParticipantSplit(s.amount, s.participants, s.splitType, paidBy),
      })),
    setCurrentUser: (currentUser) =>
      set((s) => {
        const cUser = s.participants.find((p) => p.id === currentUser.id);
        const participants = [...s.participants];

        if (!cUser) {
          participants.push(currentUser);
        }
        return { currentUser, paidBy: currentUser, participants };
      }),
    setDescription: (description) => set({ description }),
    setFileUploading: (isFileUploading) => set({ isFileUploading }),
    setFileKey: (fileKey) => set({ fileKey }),
    resetState: () => {
      set((s) => ({
        amount: 0,
        amountStr: '',
        participants: s.currentUser ? [s.currentUser] : [],
        paidBy: s.currentUser,
        description: '',
        currency: s.preferredCurrency ?? s.currentUser?.currency ?? s.currency,
        fileKey: undefined,
        isFileUploading: false,
        category: 'general',
        splitType: SplitType.EQUAL,
        group: undefined,
        nameOrEmail: '',
        showFriends: true,
        canSplitScreenClosed: true,
        splitScreenOpen: false,
        expenseDate: undefined,
      }));
    },
    setSplitScreenOpen: (splitScreenOpen) => set({ splitScreenOpen }),
    setExpenseDate: (expenseDate) => set({ expenseDate }),
  },
}));

const sumSplitShares = (participants: Array<Participant>) =>
  participants.reduce((acc, p) => acc + (p.splitShare ?? 0), 0);

/** Remaining percentage to assign, compared in hundredths so float noise never blocks a split. */
export function getRemainingPercentage(participants: Array<Participant>) {
  return (10_000 - Math.round(sumSplitShares(participants) * 100)) / 100;
}

export function calculateParticipantSplit(
  amount: number,
  participants: Array<Participant>,
  splitType: SplitType,
  paidBy?: User,
) {
  let canSplitScreenClosed = true;
  if (amount === 0) return { participants, canSplitScreenClosed };

  // Shares are worked out on the absolute amount. A refund (negative amount) gets its sign back
  // once, when the shares become participant amounts below.
  const sign = 0 > amount ? -1 : 1;
  const absAmount = Math.abs(amount);
  let updatedParticipants = participants;

  switch (splitType) {
    case SplitType.EQUAL:
      const totalParticipants = participants.filter((p) => p.splitShare !== 0).length;
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: p.splitShare === 0 ? 0 : absAmount / totalParticipants,
      }));
      canSplitScreenClosed = !!updatedParticipants.find((p) => p.splitShare);
      break;
    case SplitType.PERCENTAGE:
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: ((p.splitShare ?? 0) / 100) * absAmount,
      }));

      canSplitScreenClosed = 0 === getRemainingPercentage(participants);
      break;
    case SplitType.SHARE:
      const totalShare = sumSplitShares(participants);
      canSplitScreenClosed = Number.isFinite(totalShare) && 0 < totalShare;
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: canSplitScreenClosed ? ((p.splitShare ?? 0) * absAmount) / totalShare : 0,
      }));
      break;
    case SplitType.EXACT:
      canSplitScreenClosed = toInteger(absAmount) === toInteger(sumSplitShares(participants));
      updatedParticipants = participants.map((p) => ({ ...p, amount: p.splitShare ?? 0 }));
      break;
    case SplitType.ADJUSTMENT:
      const totalAdjustment = sumSplitShares(participants);
      if (toInteger(totalAdjustment) > toInteger(absAmount)) {
        canSplitScreenClosed = false;
      }
      const remainingAmountShare = (absAmount - totalAdjustment) / participants.length;
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: remainingAmountShare + (p.splitShare ?? 0),
      }));
      break;
    case SplitType.SETTLEMENT:
      // The payer gets the whole amount back from the other person.
      const receivers = participants.filter((p) => p.id !== paidBy?.id).length;
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: p.id === paidBy?.id || 0 === receivers ? 0 : absAmount / receivers,
      }));
      break;
  }

  const participantsToAdjust = updatedParticipants
    .filter((participant) => 0 !== participant.amount)
    .map((participant) => participant.id)
    .sort((a, b) => a - b);

  updatedParticipants = updatedParticipants.map((p) => {
    const share = sign * (p.amount ?? 0);
    if (p.id === paidBy?.id) {
      return { ...p, amount: amount - share };
    }
    return { ...p, amount: 0 - share };
  });

  if (updatedParticipants.some((participant) => !Number.isFinite(participant.amount))) {
    return {
      participants: updatedParticipants.map((participant) => ({ ...participant, amount: 0 })),
      canSplitScreenClosed: false,
    };
  }

  if (canSplitScreenClosed && participantsToAdjust.length) {
    const amounts = new Map(
      updatedParticipants.map((participant) => [
        participant.id,
        toInteger(participant.amount ?? 0),
      ]),
    );
    let imbalance = [...amounts.values()].reduce((total, participantAmount) => {
      return total + participantAmount;
    }, 0);
    let index = 0;

    if (!Number.isFinite(imbalance)) {
      return { participants: updatedParticipants, canSplitScreenClosed: false };
    }

    while (0 !== imbalance) {
      const participantId = participantsToAdjust[index % participantsToAdjust.length];
      if (undefined === participantId) {
        break;
      }

      const correction = 0 < imbalance ? -1 : 1;
      amounts.set(participantId, (amounts.get(participantId) ?? 0) + correction);
      imbalance += correction;
      index += 1;
    }

    updatedParticipants = updatedParticipants.map((participant) => ({
      ...participant,
      amount: toFixedNumber(amounts.get(participant.id) ?? 0),
    }));
  }

  return { participants: updatedParticipants, canSplitScreenClosed };
}

/**
 * Rebuilds the split inputs from participant amounts, e.g. when editing an expense or switching
 * split type. Works on what each person owes of the absolute amount, so a refund rebuilds the same
 * inputs as the matching expense; `calculateParticipantSplit` re-applies the sign.
 */
export function calculateSplitShareBasedOnAmount(
  amount: number,
  participants: Array<Participant>,
  splitType: SplitType,
  paidBy?: User,
) {
  const sign = 0 > amount ? -1 : 1;
  const absAmount = Math.abs(amount);
  // What each person owes towards the expense, in cents of the absolute amount.
  const owed = participants.map((p) =>
    toInteger(sign * ((paidBy?.id === p.id ? amount : 0) - (p.amount ?? 0))),
  );
  const withShares = (getShare: (owedCents: number, index: number) => number) =>
    participants.map((p, index) => ({ ...p, splitShare: getShare(owed[index] ?? 0, index) }));

  switch (splitType) {
    case SplitType.EQUAL:
      return withShares((owedCents) => (0 === owedCents ? 0 : 1));

    case SplitType.PERCENTAGE: {
      const totalCents = toInteger(absAmount);
      if (0 === totalCents) {
        return withShares(() => 0);
      }

      // Percentages in hundredths, with the rounding remainder on the largest share so they add
      // up to exactly 100%.
      const hundredths = owed.map((owedCents) => Math.round((owedCents / totalCents) * 10_000));
      const remainder = 10_000 - hundredths.reduce((total, value) => total + value, 0);
      const largest = hundredths.indexOf(Math.max(...hundredths));
      if (-1 !== largest && Math.abs(remainder) <= participants.length) {
        hundredths[largest] = (hundredths[largest] ?? 0) + remainder;
      }

      return withShares((_, index) => (hundredths[index] ?? 0) / 100);
    }

    case SplitType.SHARE: {
      // Scale so the smallest non-zero share is 1, rounded to drop leftover-cent noise.
      const positive = owed.filter((owedCents) => 0 < owedCents);
      const minOwed = positive.length ? Math.min(...positive) : 0;

      return withShares((owedCents) =>
        0 === minOwed ? 0 : Math.round((owedCents / minOwed) * 100) / 100,
      );
    }

    case SplitType.EXACT:
      return withShares((owedCents) => toFixedNumber(owedCents));

    case SplitType.ADJUSTMENT: {
      // Everyone gets the smallest share equally, plus their difference from it as adjustment.
      const minOwed = owed.length ? Math.min(...owed) : 0;

      return withShares((owedCents) => toFixedNumber(owedCents - minOwed));
    }

    default:
      return [...participants];
  }
}
