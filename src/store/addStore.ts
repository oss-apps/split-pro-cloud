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
  /** Bumped on every reset. Async work started for an older form must not write to a newer one. */
  formGeneration: number;
  /**
   * The allocation that split type switches rebuild from, kept until a value changes. Switching to a
   * type that can't express it (e.g. equal) and back then restores the same cents.
   */
  splitTypeSource: Array<Participant> | undefined;
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

/** The payer must be a participant. Without them, the current user (or else anyone left) pays. */
const getPayerAmong = (
  participants: Array<Participant>,
  paidBy: User | undefined,
  currentUser: User | undefined,
) =>
  [paidBy, currentUser].find(
    (user) => user && participants.some((participant) => participant.id === user.id),
  ) ?? participants[0];

const splitWithParticipants = (
  state: AddExpenseState,
  participants: Array<Participant>,
  splitType = state.splitType,
) => {
  const paidBy = getPayerAmong(participants, state.paidBy, state.currentUser);

  return {
    paidBy,
    splitType,
    splitTypeSource: undefined,
    ...calculateParticipantSplit(state.amount, participants, splitType, paidBy),
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
  formGeneration: 0,
  splitTypeSource: undefined,
  actions: {
    setAmount: (amount) =>
      set((s) => {
        const { participants, canSplitScreenClosed } = calculateParticipantSplit(
          amount,
          s.participants,
          s.splitType,
          s.paidBy,
        );

        return { amount, participants, canSplitScreenClosed, splitTypeSource: undefined };
      }),
    setAmountStr: (amountStr) => set({ amountStr }),
    setSplitType: (splitType) =>
      set((state) => {
        // Without an amount there is nothing to rebuild shares from, so keep the current ones
        if (0 === state.amount) {
          return {
            splitType,
            ...calculateParticipantSplit(state.amount, state.participants, splitType, state.paidBy),
          };
        }

        const source = state.splitTypeSource ?? state.participants;
        const participants = calculateSplitShareBasedOnAmount(
          state.amount,
          source,
          splitType,
          state.paidBy,
        );

        return {
          splitType,
          splitTypeSource: source,
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
        return splitWithParticipants(state, participants);
      }),
    setParticipants: (_participants) =>
      set((state) => {
        const participants = _participants.map((p) => ({
          splitShare: state.splitType === SplitType.EQUAL ? 1 : 0,
          ...p,
        }));
        return splitWithParticipants(state, participants, SplitType.EQUAL);
      }),
    removeLastParticipant: () => {
      set((state) => {
        if (state.participants.length === 1) return {};
        const newParticipants = [...state.participants];
        newParticipants.pop();
        return splitWithParticipants(state, newParticipants);
      });
    },
    removeParticipant: (userId) => {
      set((state) =>
        splitWithParticipants(
          state,
          state.participants.filter((p) => p.id !== userId),
        ),
      );
    },
    setCurrency: (currency) => set({ currency }),
    setPreferredCurrency: (preferredCurrency) => set({ preferredCurrency }),
    setCategory: (category) => set({ category }),
    setNameOrEmail: (nameOrEmail) => set({ nameOrEmail, showFriends: nameOrEmail.length > 0 }),
    setPaidBy: (paidBy) =>
      set((s) => {
        // Picking the current payer again must not recalculate, e.g. an imported uneven split.
        if (paidBy.id === s.paidBy?.id || !s.participants.some((p) => p.id === paidBy.id)) {
          return {};
        }

        return {
          paidBy,
          splitTypeSource: undefined,
          ...calculateParticipantSplit(s.amount, s.participants, s.splitType, paidBy),
        };
      }),
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
        formGeneration: s.formGeneration + 1,
        splitTypeSource: undefined,
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

type ExpenseToEdit = {
  amount: number;
  splitType: SplitType;
  category: string;
  currency: string;
  name: string;
  expenseDate: Date;
  fileKey: string | null;
  group: Group | null;
  paidByUser: User;
  expenseParticipants: Array<{ amount: number; user: User }>;
};

/** The form state for editing a stored expense. Its participant cents are kept as stored. */
export const getEditFormState = (expense: ExpenseToEdit) => {
  const amount = toFixedNumber(expense.amount);
  const stored = expense.expenseParticipants.map((participant) => ({
    ...participant.user,
    amount: toFixedNumber(participant.amount),
  }));
  // Very old expenses may lack the payer's row. It is implied by everyone else's.
  const withPayer = stored.some((participant) => participant.id === expense.paidByUser.id)
    ? stored
    : [
        ...stored,
        {
          ...expense.paidByUser,
          amount: toFixedNumber(
            -expense.expenseParticipants.reduce(
              (total, participant) => total + participant.amount,
              0,
            ),
          ),
        },
      ];

  return {
    amount,
    amountStr: amount.toString(),
    canSplitScreenClosed: true,
    category: expense.category,
    currency: expense.currency,
    description: expense.name,
    expenseDate: expense.expenseDate,
    fileKey: expense.fileKey ?? undefined,
    group: expense.group ?? undefined,
    paidBy: expense.paidByUser,
    participants: calculateSplitShareBasedOnAmount(
      amount,
      withPayer,
      expense.splitType,
      expense.paidByUser,
    ),
    showFriends: false,
    splitType: expense.splitType,
    splitTypeSource: undefined,
  } satisfies Partial<AddExpenseState>;
};

/** Whether async work started for form `generation` may still write to the form. */
export const isCurrentForm = (generation: number) =>
  generation === useAddExpenseStore.getState().formGeneration;

const gcd = (a: number, b: number): number => (0 === b ? a : gcd(b, a % b));

/**
 * Rebuilds the split inputs from participant amounts, e.g. when editing an expense or switching
 * split type. Works on what each person owes of the absolute amount, so a refund rebuilds the same
 * inputs as the matching expense; `calculateParticipantSplit` re-applies the sign.
 *
 * Readable inputs (whole percentages, 1:2 shares) are only used when they give back exactly the
 * same cents. Otherwise the inputs keep the exact ratios, and the split screen rounds them for
 * display only, so opening and saving an expense never moves a cent.
 */
export function calculateSplitShareBasedOnAmount(
  amount: number,
  participants: Array<Participant>,
  splitType: SplitType,
  paidBy?: User,
) {
  const sign = 0 > amount ? -1 : 1;
  const totalCents = toInteger(Math.abs(amount));
  const cents = participants.map((p) => toInteger(p.amount ?? 0));
  // What each person owes towards the expense, in cents of the absolute amount.
  const owed = participants.map((p, index) =>
    toInteger(sign * ((paidBy?.id === p.id ? amount : 0) - toFixedNumber(cents[index] ?? 0))),
  );
  const withShares = (shares: number[]) =>
    participants.map((p, index) => ({ ...p, splitShare: shares[index] ?? 0 }));
  const keepsCents = (candidate: Array<Participant>) =>
    calculateParticipantSplit(amount, candidate, splitType, paidBy).participants.every(
      (p, index) => toInteger(p.amount ?? 0) === cents[index],
    );
  // The first candidate that keeps every cent, else the last one, which is exact.
  const pick = (...candidates: number[][]) => {
    const rebuilt = candidates.map(withShares);
    return rebuilt.find(keepsCents) ?? rebuilt[rebuilt.length - 1] ?? [...participants];
  };

  switch (splitType) {
    case SplitType.EQUAL:
      return pick(owed.map((owedCents) => (0 === owedCents ? 0 : 1)));

    case SplitType.PERCENTAGE: {
      if (0 === totalCents) {
        return pick(owed.map(() => 0));
      }

      // Percentages in hundredths, with the rounding remainder on the largest share so they add
      // up to exactly 100%.
      const hundredths = owed.map((owedCents) => Math.round((owedCents / totalCents) * 10_000));
      const remainder = 10_000 - hundredths.reduce((total, value) => total + value, 0);
      const largest = hundredths.indexOf(Math.max(...hundredths));
      if (-1 !== largest && Math.abs(remainder) <= participants.length) {
        hundredths[largest] = (hundredths[largest] ?? 0) + remainder;
      }

      return pick(
        hundredths.map((value) => value / 100),
        owed.map((owedCents) => (owedCents / totalCents) * 100),
      );
    }

    case SplitType.SHARE: {
      // Relative to the smallest non-zero share, which becomes 1.
      const positive = owed.filter((owedCents) => 0 < owedCents);
      const minOwed = positive.length ? Math.min(...positive) : 0;
      if (0 === minOwed) {
        return pick(owed.map(() => 0));
      }

      // Whole numbers when the shares have a small common ratio, e.g. 30.00 and 70.00 give 3 and 7.
      const divisor = owed.reduce((result, owedCents) => gcd(result, Math.abs(owedCents)), 0);
      const wholeShares = owed.map((owedCents) => owedCents / divisor);

      return pick(
        owed.map((owedCents) => Math.round((owedCents / minOwed) * 100) / 100),
        ...(wholeShares.every((share) => 100 >= Math.abs(share)) ? [wholeShares] : []),
        owed.map((owedCents) => owedCents / minOwed),
      );
    }

    case SplitType.EXACT:
      return pick(owed.map((owedCents) => toFixedNumber(owedCents)));

    case SplitType.ADJUSTMENT: {
      // Everyone gets the smallest share equally, plus their difference from it as adjustment.
      const minOwed = owed.length ? Math.min(...owed) : 0;

      return pick(owed.map((owedCents) => toFixedNumber(owedCents - minOwed)));
    }

    default:
      return [...participants];
  }
}

/** Split inputs are kept exact, so the split screen rounds them for display. */
export const formatSplitShare = (splitShare: number | undefined) =>
  undefined === splitShare ? undefined : String(Math.round(splitShare * 100) / 100);

/**
 * Adds an invited email as a placeholder participant until the invite returns their account. A
 * result for a form that was reset in the meantime is dropped.
 */
export const inviteParticipant = async (
  email: string,
  invite: (email: string) => Promise<User>,
) => {
  const { formGeneration, actions } = useAddExpenseStore.getState();
  actions.addOrUpdateParticipant({
    id: -1,
    name: email,
    email,
    emailVerified: new Date(),
    image: null,
    currency: 'USD',
  });

  try {
    const user = await invite(email);
    if (!isCurrentForm(formGeneration)) {
      return;
    }

    actions.removeParticipant(-1);
    actions.addOrUpdateParticipant(user);
    actions.setNameOrEmail('');
  } catch (error) {
    if (!isCurrentForm(formGeneration)) {
      return;
    }

    actions.removeParticipant(-1);
    throw error;
  }
};

type UploadUrlInput = { fileName: string; fileType: string; fileSize: number };

/**
 * Uploads a receipt for the current form. Resetting the form aborts the upload, and a result for a
 * form that was reset in the meantime is dropped.
 */
export const uploadReceipt = async (
  file: { name: string; type: string; size: number } & BodyInit,
  getUploadUrl: (input: UploadUrlInput) => Promise<{ fileUrl: string; key: string }>,
): Promise<'uploaded' | 'failed' | 'stale'> => {
  const { formGeneration, actions } = useAddExpenseStore.getState();
  const controller = new AbortController();
  const unsubscribe = useAddExpenseStore.subscribe((state) => {
    if (state.formGeneration !== formGeneration) {
      controller.abort();
    }
  });
  const isCurrent = () => !controller.signal.aborted && isCurrentForm(formGeneration);

  actions.setFileUploading(true);
  try {
    const { fileUrl, key } = await getUploadUrl({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    if (!isCurrent()) {
      return 'stale';
    }

    const response = await fetch(fileUrl, { method: 'PUT', body: file, signal: controller.signal });
    if (!isCurrent()) {
      return 'stale';
    }

    if (!response.ok) {
      return 'failed';
    }

    actions.setFileKey(key);
    return 'uploaded';
  } catch (error) {
    if (!isCurrent()) {
      return 'stale';
    }

    throw error;
  } finally {
    unsubscribe();
    if (isCurrentForm(formGeneration)) {
      actions.setFileUploading(false);
    }
  }
};
