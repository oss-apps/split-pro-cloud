import {
  type Group,
  type RecurringFrequency,
  RecurringStatus,
  SplitType,
  type User,
} from '@prisma/client';
import { create } from 'zustand';
import {
  type DefaultSplit,
  getGroupDefaultSplit,
  isDefaultSplitType,
  resolveDefaultSplit,
} from '~/utils/defaultSplit';
import { sumHundredths, toFixedNumber, toInteger } from '~/utils/numbers';

export type Participant = User & { amount?: number; splitShare?: number };

/**
 * An expense as it was opened for editing. While its amount, currency, payer, participants and
 * split type are the same as loaded (also after changing one and back) and no split value was
 * edited, it is shown and saved with its stored cents, even if today's rounding would distribute
 * them differently.
 */
type EditSnapshot = {
  amountCents: number;
  currency: string;
  paidById: number;
  splitType: SplitType;
  participants: Array<Participant>;
};

/** How the selected group's default split fit its members, shown under the split. */
export type DefaultSplitHint = {
  splitType: DefaultSplit['splitType'];
  addedIds: number[];
  outdated: boolean;
};

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
  /**
   * Whether this form's currency was picked by hand or loaded from the expense being edited. Only
   * an untouched currency follows the selected group.
   */
  currencyTouched: boolean;
  /**
   * Whether this form's split was changed by hand or loaded from the expense being edited. Only an
   * untouched split takes the selected group's default.
   */
  splitTouched: boolean;
  /** The split changed by hand, put back when the group is selected again. */
  manualSplit: DefaultSplit | undefined;
  /**
   * Values of the manual split given to pending invites that left the form because a group was
   * selected, by placeholder id. Each goes to the invitee if they are in the form once the invite
   * returns, else it is dropped. Until then the split can't be changed or saved.
   */
  pendingInviteSplit: Record<number, number>;
  defaultSplitHint: DefaultSplitHint | undefined;
  category: string;
  nameOrEmail: string;
  paidBy: User | undefined;
  showFriends: boolean;
  isFileUploading: boolean;
  fileKey?: string;
  canSplitScreenClosed: boolean;
  splitScreenOpen: boolean;
  expenseDate: Date | undefined;
  /** How the expense repeats, or null if it doesn't. */
  recurrence: RecurringFrequency | null;
  /**
   * How the expense being edited repeated when it was opened. An edit only changes how it repeats
   * when this was changed.
   */
  loadedRecurrence: RecurringFrequency | null | undefined;
  /** Bumped on every reset. Async work started for an older form must not write to a newer one. */
  formGeneration: number;
  /**
   * The allocation that split type switches rebuild from, kept until a value changes. Switching to a
   * type that can't express it (e.g. equal) and back then restores the same cents.
   */
  splitTypeSource: Array<Participant> | undefined;
  /** Dropped as soon as a split value or the participants change. */
  editSnapshot: EditSnapshot | undefined;
  actions: {
    setAmount: (amount: number) => void;
    setAmountStr: (amountStr: string) => void;
    setSplitType: (splitType: SplitType) => void;
    setGroup: (group: Group | undefined) => void;
    /** Splits with everyone in the group, using its default split unless the split was touched. */
    selectGroup: (group: Group, members: Array<User>) => void;
    addOrUpdateParticipant: (user: Participant) => void;
    setParticipants: (participants: Array<Participant>) => void;
    removeParticipant: (userId: number) => void;
    replaceParticipant: (fromId: number, user: User) => void;
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
    setRecurrence: (recurrence: RecurringFrequency | null) => void;
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

const isSameParticipantSet = (a: Array<{ id: number }>, b: Array<{ id: number }>) =>
  a.length === b.length && a.every((participant) => b.some((other) => other.id === participant.id));

/** Whether the form still holds the financial inputs of the expense as it was opened. */
export const matchesEditSnapshot = (
  state: Pick<
    AddExpenseState,
    'editSnapshot' | 'amount' | 'currency' | 'paidBy' | 'splitType' | 'participants'
  >,
): state is typeof state & { editSnapshot: EditSnapshot } => {
  const snapshot = state.editSnapshot;
  return (
    !!snapshot &&
    toInteger(state.amount) === snapshot.amountCents &&
    state.currency === snapshot.currency &&
    state.paidBy?.id === snapshot.paidById &&
    state.splitType === snapshot.splitType &&
    isSameParticipantSet(state.participants, snapshot.participants)
  );
};

/** The participants to save: the stored ones while the expense is unchanged, else the form's. */
export const getParticipantsToSave = (
  state: Pick<
    AddExpenseState,
    'editSnapshot' | 'amount' | 'currency' | 'paidBy' | 'splitType' | 'participants'
  >,
) => (matchesEditSnapshot(state) ? state.editSnapshot.participants : state.participants);

/** Shows the stored cents again when a change returns the form to the expense as it was opened. */
const withEditSnapshot = <T extends Partial<AddExpenseState>>(state: AddExpenseState, next: T) => {
  const merged = { ...state, ...next };
  if (!matchesEditSnapshot(merged)) {
    return next;
  }

  return {
    ...next,
    participants: merged.editSnapshot.participants,
    canSplitScreenClosed: true,
  };
};

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
    editSnapshot: undefined,
    defaultSplitHint: undefined,
    ...calculateParticipantSplit(state.amount, participants, splitType, paidBy),
  };
};

/** The split as changed by hand, kept while it is one a group could also use as its default. */
const touchSplit = (participants: Array<Participant>, splitType: SplitType) => ({
  splitTouched: true,
  manualSplit: isDefaultSplitType(splitType)
    ? {
        splitType,
        shares: Object.fromEntries(
          participants.map((p) => [
            p.id,
            // Without a value, someone is in an equal split but has no percentage or share.
            SplitType.EQUAL === splitType ? (0 === p.splitShare ? 0 : 1) : p.splitShare ?? 0,
          ]),
        ),
      }
    : undefined,
  defaultSplitHint: undefined,
});

/**
 * The split changed by hand, with a participant's value moved to who replaced them (an invite that
 * returned their account) or dropped when they left the form, so selecting a group later never
 * applies a value to the wrong person.
 */
const moveInManualSplit = (
  manualSplit: DefaultSplit | undefined,
  fromId: number,
  toId?: number,
): DefaultSplit | undefined => {
  if (undefined === manualSplit?.shares[fromId]) {
    return manualSplit;
  }

  const { [fromId]: value, ...shares } = manualSplit.shares;
  return {
    ...manualSplit,
    shares: undefined === toId || undefined === value ? shares : { ...shares, [toId]: value },
  };
};

/** Moves the values of pending invites out of a manual split, e.g. when a group replaces them. */
const takePendingInvites = (
  manualSplit: DefaultSplit | undefined,
  pendingInviteSplit: Record<number, number>,
) => {
  if (!manualSplit) {
    return { manualSplit, pendingInviteSplit };
  }

  const entries = Object.entries(manualSplit.shares);
  const isInvite = ([id]: [string, number]) => isPendingInvite({ id: Number(id) });
  return {
    manualSplit: {
      ...manualSplit,
      shares: Object.fromEntries(entries.filter((entry) => !isInvite(entry))),
    },
    pendingInviteSplit: {
      ...pendingInviteSplit,
      ...Object.fromEntries(entries.filter(isInvite)),
    },
  };
};

const withoutPendingInvite = (pendingInviteSplit: Record<number, number>, placeholderId: number) =>
  Object.fromEntries(
    Object.entries(pendingInviteSplit).filter(([id]) => Number(id) !== placeholderId),
  );

/** The manual split applied to these participants, as when its group is selected. */
const applyManualSplit = (
  state: AddExpenseState,
  manualSplit: DefaultSplit,
  participants: Array<Participant>,
) => {
  const resolved = resolveDefaultSplit(
    manualSplit,
    participants.map((p) => p.id),
  );
  return splitWithParticipants(
    state,
    participants.map((p, index) => ({ ...p, splitShare: resolved.shares[index] ?? 0 })),
    resolved.splitType,
  );
};

/** Whether an invite in the form or in its split hasn't returned yet, so it can't be saved. */
export const hasUnresolvedInvite = (
  state: Pick<AddExpenseState, 'participants' | 'manualSplit' | 'pendingInviteSplit'>,
) =>
  state.participants.some(isPendingInvite) ||
  Object.keys(state.manualSplit?.shares ?? {}).some((id) => isPendingInvite({ id: Number(id) })) ||
  0 < Object.keys(state.pendingInviteSplit).length;

/** Whether the split waits for an invite that left the form, so it can't be changed yet. */
export const isSplitWaitingForInvite = (state: Pick<AddExpenseState, 'pendingInviteSplit'>) =>
  0 < Object.keys(state.pendingInviteSplit).length;

/**
 * An invite whose placeholder left the form when a group was selected has returned. Its value goes
 * to the invitee if they are in the form (e.g. a group member) and have no value of their own,
 * else it is dropped. Nobody is added to the form.
 */
const resolvePendingInvite = (
  state: AddExpenseState,
  placeholderId: number,
  user: User,
): Partial<AddExpenseState> => {
  const value = state.pendingInviteSplit[placeholderId];
  if (undefined === value) {
    return {};
  }

  const pendingInviteSplit = withoutPendingInvite(state.pendingInviteSplit, placeholderId);
  const { manualSplit } = state;
  const isParticipant = state.participants.some((p) => p.id === user.id);
  if (!manualSplit || !isParticipant || undefined !== manualSplit.shares[user.id]) {
    return { pendingInviteSplit };
  }

  const withInvitee = { ...manualSplit, shares: { ...manualSplit.shares, [user.id]: value } };
  return {
    ...applyManualSplit(state, withInvitee, state.participants),
    manualSplit: withInvitee,
    pendingInviteSplit,
  };
};

/** An untouched currency follows the group, and goes back to the user's without one. */
const getGroupCurrency = (state: AddExpenseState, group: Group | undefined) => {
  if (state.currencyTouched) {
    return state.currency;
  }

  const currency = group
    ? group.defaultCurrency
    : state.preferredCurrency ?? state.currentUser?.currency ?? state.currency;
  return currency ?? state.currency;
};

export const useAddExpenseStore = create<AddExpenseState>()((set) => ({
  amount: 0,
  amountStr: '',
  splitType: SplitType.EQUAL,
  group: undefined,
  participants: [],
  currency: 'USD',
  preferredCurrency: undefined,
  currencyTouched: false,
  splitTouched: false,
  manualSplit: undefined,
  pendingInviteSplit: {},
  defaultSplitHint: undefined,
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
  recurrence: null,
  loadedRecurrence: undefined,
  formGeneration: 0,
  splitTypeSource: undefined,
  editSnapshot: undefined,
  actions: {
    setAmount: (amount) =>
      set((s) => {
        const { participants, canSplitScreenClosed } = calculateParticipantSplit(
          amount,
          s.participants,
          s.splitType,
          s.paidBy,
        );

        return withEditSnapshot(s, {
          amount,
          participants,
          canSplitScreenClosed,
          splitTypeSource: undefined,
        });
      }),
    setAmountStr: (amountStr) => set({ amountStr }),
    setSplitType: (splitType) =>
      set((state) => {
        if (isSplitWaitingForInvite(state)) {
          return {};
        }

        // Without an amount there is nothing to rebuild shares from, so keep the current ones
        if (0 === state.amount) {
          return {
            splitType,
            ...touchSplit(state.participants, splitType),
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

        return withEditSnapshot(state, {
          splitType,
          splitTypeSource: source,
          ...touchSplit(participants, splitType),
          ...calculateParticipantSplit(state.amount, participants, splitType, state.paidBy),
        });
      }),
    setGroup: (group) =>
      set((s) => {
        if (s.currencyTouched) {
          return { group, defaultSplitHint: undefined };
        }

        return withEditSnapshot(s, {
          group,
          currency: getGroupCurrency(s, group),
          defaultSplitHint: undefined,
        });
      }),
    selectGroup: (group, members) =>
      set((s) => {
        const { currentUser } = s;
        if (!currentUser) {
          return {};
        }

        const participants: Array<Participant> = [
          currentUser,
          ...members.filter((member) => member.id !== currentUser.id),
        ];
        const state = { ...s, group, currency: getGroupCurrency(s, group) };
        // Pending invites aren't group members. Their values wait for the invite to return.
        const { manualSplit, pendingInviteSplit } = takePendingInvites(
          s.manualSplit,
          s.pendingInviteSplit,
        );
        const split = s.splitTouched ? manualSplit : getGroupDefaultSplit(group);
        if (!split) {
          return {
            group,
            currency: state.currency,
            manualSplit,
            pendingInviteSplit,
            ...splitWithParticipants(
              state,
              participants.map((p) => ({ ...p, splitShare: 1 })),
              SplitType.EQUAL,
            ),
          };
        }

        const resolved = resolveDefaultSplit(
          split,
          participants.map((p) => p.id),
        );
        return {
          group,
          currency: state.currency,
          manualSplit,
          pendingInviteSplit,
          ...splitWithParticipants(
            state,
            participants.map((p, index) => ({ ...p, splitShare: resolved.shares[index] ?? 0 })),
            resolved.splitType,
          ),
          defaultSplitHint: s.splitTouched
            ? undefined
            : {
                splitType: split.splitType,
                addedIds: resolved.addedIds,
                outdated: resolved.outdated,
              },
        };
      }),
    addOrUpdateParticipant: (user) =>
      set((state) => {
        const participants = [...state.participants];
        const userIndex = participants.findIndex((p) => p.id === user.id);
        if (userIndex === -1) {
          participants.push({ ...user, splitShare: state.splitType === SplitType.EQUAL ? 1 : 0 });
          return splitWithParticipants(state, participants);
        }

        if (isSplitWaitingForInvite(state)) {
          return {};
        }

        // Updating someone already in the split is a change to their split value.
        participants[userIndex] = user;
        return {
          ...splitWithParticipants(state, participants),
          ...touchSplit(participants, state.splitType),
        };
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
        const removed = newParticipants.pop();
        return {
          ...splitWithParticipants(state, newParticipants),
          manualSplit: removed
            ? moveInManualSplit(state.manualSplit, removed.id)
            : state.manualSplit,
        };
      });
    },
    removeParticipant: (userId) => {
      set((state) => {
        const manualSplit = moveInManualSplit(state.manualSplit, userId);
        const pendingInviteSplit = withoutPendingInvite(state.pendingInviteSplit, userId);
        if (!state.participants.some((p) => p.id === userId)) {
          return { manualSplit, pendingInviteSplit };
        }

        return {
          ...splitWithParticipants(
            state,
            state.participants.filter((p) => p.id !== userId),
          ),
          manualSplit,
          pendingInviteSplit,
        };
      });
    },
    replaceParticipant: (fromId, user) =>
      set((state) => {
        if (!state.participants.some((p) => p.id === fromId)) {
          return resolvePendingInvite(state, fromId, user);
        }

        // Keeps the position, split value and payer choice. If they were already added, the
        // placeholder just goes away.
        const isAlreadyParticipant = state.participants.some((p) => p.id === user.id);
        const participants = state.participants.flatMap((p) => {
          if (p.id !== fromId) {
            return [p];
          }

          return isAlreadyParticipant
            ? []
            : [{ ...user, splitShare: p.splitShare, amount: p.amount }];
        });
        const paidBy = state.paidBy?.id === fromId ? user : state.paidBy;

        return {
          ...splitWithParticipants({ ...state, paidBy }, participants),
          // Someone already in the form keeps their own value, as they do in the split.
          manualSplit: moveInManualSplit(
            state.manualSplit,
            fromId,
            isAlreadyParticipant ? undefined : user.id,
          ),
        };
      }),
    setCurrency: (currency) => set((s) => withEditSnapshot(s, { currency, currencyTouched: true })),
    setPreferredCurrency: (preferredCurrency) => set({ preferredCurrency }),
    setCategory: (category) => set({ category }),
    setNameOrEmail: (nameOrEmail) => set({ nameOrEmail, showFriends: nameOrEmail.length > 0 }),
    setPaidBy: (paidBy) =>
      set((s) => {
        // Picking the current payer again must not recalculate, e.g. an imported uneven split.
        if (paidBy.id === s.paidBy?.id || !s.participants.some((p) => p.id === paidBy.id)) {
          return {};
        }

        return withEditSnapshot(s, {
          paidBy,
          splitTypeSource: undefined,
          ...calculateParticipantSplit(s.amount, s.participants, s.splitType, paidBy),
        });
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
        currencyTouched: false,
        splitTouched: false,
        manualSplit: undefined,
        pendingInviteSplit: {},
        defaultSplitHint: undefined,
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
        recurrence: null,
        loadedRecurrence: undefined,
        formGeneration: s.formGeneration + 1,
        splitTypeSource: undefined,
        editSnapshot: undefined,
      }));
    },
    setSplitScreenOpen: (splitScreenOpen) => set({ splitScreenOpen }),
    setExpenseDate: (expenseDate) => set({ expenseDate }),
    setRecurrence: (recurrence) => set({ recurrence }),
  },
}));

const sumSplitShares = (participants: Array<Participant>) =>
  participants.reduce((acc, p) => acc + (p.splitShare ?? 0), 0);

/** Remaining percentage to assign, compared in hundredths so float noise never blocks a split. */
export function getRemainingPercentage(participants: Array<Participant>) {
  return (10_000 - sumHundredths(participants.map((p) => p.splitShare ?? 0))) / 100;
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
  recurring?: { frequency: RecurringFrequency; status: RecurringStatus } | null;
};

/** The form state for editing a stored expense. Its participant cents are kept as stored. */
export const getEditFormState = (expense: ExpenseToEdit) => {
  const amount = toFixedNumber(expense.amount);
  // A stopped rule only records where the expense came from.
  const recurrence =
    expense.recurring && RecurringStatus.STOPPED !== expense.recurring.status
      ? expense.recurring.frequency
      : null;
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

  const participants = calculateSplitShareBasedOnAmount(
    amount,
    withPayer,
    expense.splitType,
    expense.paidByUser,
  );

  return {
    amount,
    amountStr: amount.toString(),
    canSplitScreenClosed: true,
    category: expense.category,
    currency: expense.currency,
    // An edit keeps its stored currency, whatever the group's default.
    currencyTouched: true,
    // And its stored split, whatever the group's default.
    splitTouched: true,
    manualSplit: undefined,
    pendingInviteSplit: {},
    defaultSplitHint: undefined,
    description: expense.name,
    expenseDate: expense.expenseDate,
    recurrence,
    loadedRecurrence: recurrence,
    fileKey: expense.fileKey ?? undefined,
    group: expense.group ?? undefined,
    paidBy: expense.paidByUser,
    participants,
    showFriends: false,
    splitType: expense.splitType,
    splitTypeSource: undefined,
    editSnapshot: {
      amountCents: expense.amount,
      currency: expense.currency,
      paidById: expense.paidByUser.id,
      splitType: expense.splitType,
      participants,
    },
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

/** An invited friend is a placeholder with a negative id until the invite returns their account. */
export const isPendingInvite = (participant: { id: number }) => 0 > participant.id;

let lastPlaceholderId = 0;

/**
 * Adds an invited email as a placeholder participant until the invite returns their account. Every
 * invite has its own placeholder, so overlapping invites only replace or remove their own. A result
 * for a form that was reset in the meantime is dropped.
 */
export const inviteParticipant = async (
  email: string,
  invite: (email: string) => Promise<User>,
) => {
  const { formGeneration, actions } = useAddExpenseStore.getState();
  lastPlaceholderId -= 1;
  const placeholderId = lastPlaceholderId;
  actions.addOrUpdateParticipant({
    id: placeholderId,
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

    actions.replaceParticipant(placeholderId, user);
    // Keep anything typed since, e.g. the next email to invite.
    if (email === useAddExpenseStore.getState().nameOrEmail) {
      actions.setNameOrEmail('');
    }
  } catch (error) {
    if (!isCurrentForm(formGeneration)) {
      return;
    }

    actions.removeParticipant(placeholderId);
    throw error;
  }
};

type UploadUrlInput = { fileName: string; fileType: string; fileSize: number };

/**
 * Uploads a receipt for the current form. The form is captured before anything async, including
 * `prepare` (e.g. checking the image), so resetting the form at any point aborts the upload and
 * drops its result.
 */
export const uploadReceipt = async (
  file: { name: string; type: string; size: number } & BodyInit,
  getUploadUrl: (input: UploadUrlInput) => Promise<{ fileUrl: string; key: string }>,
  prepare?: () => Promise<unknown>,
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
    await prepare?.();
    if (!isCurrent()) {
      return 'stale';
    }

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

/**
 * How the form's expense should repeat, as saved: for a new expense only when it repeats, for an
 * edit only when that was changed (`null` stops it).
 */
export const getRecurrenceToSave = (
  state: Pick<AddExpenseState, 'recurrence' | 'loadedRecurrence' | 'splitType'>,
  timezone: string,
) => {
  const recurrence = SplitType.SETTLEMENT === state.splitType ? null : state.recurrence;
  if (recurrence === (state.loadedRecurrence ?? null)) {
    return undefined;
  }
  return recurrence ? { frequency: recurrence, timezone } : null;
};
