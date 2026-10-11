import {
  type ReplayExpense,
  type ReplayInput,
  isPersonalSettlement,
  otherParticipants,
  pairKey,
  pairSign,
} from './replay';

/** `updatedAt` this far past `createdAt` means the expense was written again after creation. */
export const EDIT_SLACK_MS = 5_000;

/** The expense may have had an earlier version that is not stored. */
export const hasHiddenVersion = (expense: ReplayExpense) =>
  expense.edited ||
  (null === expense.deletedAt && expense.updatedAt > expense.createdAt + EDIT_SLACK_MS);

/** The definition of an edited expense for the person-level rule, deleted ones included. */
export const isEditedAtAll = (expense: ReplayExpense) =>
  expense.edited ||
  null !== expense.updatedBy ||
  expense.updatedAt > expense.createdAt + EDIT_SLACK_MS;

export type PairIssue =
  | 'pair-settlement-ever'
  | 'edited-personal-expense-touching-pair-user'
  | 'edited-personal-expense-touching-neighbour'
  | 'deleted-expense'
  | 'edited-expense'
  | 'edited-expense-other-currency'
  | 'settlement-during-other-edit'
  | 'splitwise-import'
  | 'balance-not-explained'
  | 'settlement-allocation';

export type EditWindow = { start: number; end: number };

/** From creation until the last edit (or the delete, which came after it). */
export const getEditWindows = (expenses: ReplayExpense[]): EditWindow[] =>
  expenses
    .filter(hasHiddenVersion)
    .map((expense) => ({ start: expense.createdAt, end: expense.deletedAt ?? expense.updatedAt }));

/** Returns a test for "some edit window contains this time". */
const insideAnyWindow = (windows: EditWindow[]) => {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const maxEnd: number[] = [];
  sorted.forEach((window, index) => {
    maxEnd.push(Math.max(window.end, maxEnd[index - 1] ?? -Infinity));
  });
  return (time: number) => {
    let low = 0;
    let high = sorted.length - 1;
    let last = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]!.start <= time) {
        last = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return last >= 0 && maxEnd[last]! >= time;
  };
};

const userPair = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Why a (currency, pair) cannot be repaired. Under the corrected rule only a personal
 * settlement between A and B can legitimately clear a group between them, so the first two
 * rules make the correct value simply the sum of the live group expenses, whatever happened
 * elsewhere:
 * - no SETTLEMENT has ever had both A and B on it, in any currency, live or deleted;
 * - nobody in the pair's neighbourhood appears in any edited personal expense, in any currency
 *   and any role (participant, payer, added by, updated by), live or deleted. The neighbourhood
 *   is A, B, everyone with a Balance row with A or B (any currency, any amount, including 0)
 *   and everyone currently in a group with A or B. A settlement edited off the pair keeps
 *   someone from it: whoever stays on it, or a third participant, who got a Balance row with
 *   the payer when the settlement was created (the old code upserted one for every
 *   participant and never deleted it on edit). Settling A and B to exactly 0 needs someone who
 *   can see their balance, which is also a neighbour. `addedBy` covers edits from before
 *   `updatedBy` was recorded. A or B themselves are reported as
 *   `edited-personal-expense-touching-pair-user`, anyone else as `...-touching-neighbour`.
 *
 * On top of that, only pairs whose whole history is on record qualify:
 * - every expense between them, personal or group, is live and was never edited;
 * - no Splitwise import, and the stored Balance equals the sum of the live expenses exactly
 *   (so nothing unexplained, such as expenses of a deleted group);
 * - no PR #2 settlement allocation;
 * - an edit may have changed currency, so an edited expense between the two people also
 *   disqualifies their other currencies;
 * - an edit elsewhere may have moved an expense off this pair. That can only change the
 *   corrected result if a personal settlement between the two was created while the earlier
 *   version existed, so any settlement inside any edit window disqualifies the pair.
 */
export const getPairIssues = (
  input: ReplayInput,
  editWindows: EditWindow[] = getEditWindows(input.expenses),
) => {
  const issues = new Map<string, Set<PairIssue>>();
  const add = (key: string, issue: PairIssue) => {
    const set = issues.get(key) ?? new Set<PairIssue>();
    set.add(issue);
    issues.set(key, set);
  };

  const keysByUserPair = new Map<string, Set<string>>();
  const track = (key: string, a: number, b: number) => {
    const keys = keysByUserPair.get(userPair(a, b)) ?? new Set<string>();
    keys.add(key);
    keysByUserPair.set(userPair(a, b), keys);
  };
  const addForUsers = (a: number, b: number, issue: PairIssue) =>
    keysByUserPair.get(userPair(a, b))?.forEach((key) => add(key, issue));

  const rawSums = new Map<string, number>();
  const editedUserPairs: [number, number][] = [];
  input.expenses.forEach((expense) =>
    otherParticipants(expense).forEach((participant) => {
      const key = pairKey(expense.currency, expense.paidBy, participant.userId);
      track(key, expense.paidBy, participant.userId);
      if (null !== expense.deletedAt) {
        add(key, 'deleted-expense');
        return;
      }
      if (hasHiddenVersion(expense)) {
        add(key, 'edited-expense');
        editedUserPairs.push([expense.paidBy, participant.userId]);
      }
      const delta = pairSign(expense.paidBy, participant.userId) * -participant.amount;
      rawSums.set(key, (rawSums.get(key) ?? 0) + delta);
    }),
  );

  const storedBalances = new Map<string, number>();
  input.balances.forEach((balance) => {
    const key = pairKey(balance.currency, balance.userId, balance.friendId);
    track(key, balance.userId, balance.friendId);
    if (balance.importedFromSplitwise) {
      add(key, 'splitwise-import');
    }
    if (balance.userId < balance.friendId) {
      storedBalances.set(key, balance.amount);
    }
  });
  input.groupBalances.forEach((balance) =>
    track(
      pairKey(balance.currency, balance.userId, balance.friendId),
      balance.userId,
      balance.friendId,
    ),
  );

  new Set([...storedBalances.keys(), ...rawSums.keys()]).forEach((key) => {
    if ((storedBalances.get(key) ?? 0) !== (rawSums.get(key) ?? 0)) {
      add(key, 'balance-not-explained');
    }
  });

  input.allocations.forEach((allocation) =>
    add(
      pairKey(allocation.currency, allocation.userId, allocation.friendId),
      'settlement-allocation',
    ),
  );

  editedUserPairs.forEach(([a, b]) =>
    keysByUserPair.get(userPair(a, b))?.forEach((key) => {
      if (!issues.get(key)?.has('edited-expense')) {
        add(key, 'edited-expense-other-currency');
      }
    }),
  );

  const settledUserPairs = new Set<string>();
  const usersInEditedPersonalExpenses = new Set<number>();
  input.expenses.forEach((expense) => {
    const people = [...new Set([expense.paidBy, ...expense.participants.map((p) => p.userId)])];
    if (expense.isSettlement) {
      people.forEach((a) =>
        people.forEach((b) => {
          if (a < b) {
            settledUserPairs.add(userPair(a, b));
          }
        }),
      );
    }
    if (null === expense.groupId && isEditedAtAll(expense)) {
      [...people, expense.addedBy, expense.updatedBy].forEach((userId) => {
        if (null !== userId) {
          usersInEditedPersonalExpenses.add(userId);
        }
      });
    }
  });

  // Users with a neighbour in an edited personal expense: through a Balance row, or through a
  // group they are in.
  const hasEditedNeighbour = new Set<number>();
  input.balances.forEach((balance) => {
    if (usersInEditedPersonalExpenses.has(balance.friendId)) {
      hasEditedNeighbour.add(balance.userId);
    }
    if (usersInEditedPersonalExpenses.has(balance.userId)) {
      hasEditedNeighbour.add(balance.friendId);
    }
  });
  const membersByGroup = new Map<string, number[]>();
  input.memberships.forEach((membership) => {
    const [groupId = '', userId = '0'] = membership.split(':');
    const members = membersByGroup.get(groupId);
    if (members) {
      members.push(Number(userId));
    } else {
      membersByGroup.set(groupId, [Number(userId)]);
    }
  });
  membersByGroup.forEach((members) => {
    if (members.some((userId) => usersInEditedPersonalExpenses.has(userId))) {
      members.forEach((userId) => hasEditedNeighbour.add(userId));
    }
  });

  keysByUserPair.forEach((keys, users) => {
    const [a = 0, b = 0] = users.split('|').map(Number);
    keys.forEach((key) => {
      if (settledUserPairs.has(users)) {
        add(key, 'pair-settlement-ever');
      }
      if (usersInEditedPersonalExpenses.has(a) || usersInEditedPersonalExpenses.has(b)) {
        add(key, 'edited-personal-expense-touching-pair-user');
      } else if (hasEditedNeighbour.has(a) || hasEditedNeighbour.has(b)) {
        add(key, 'edited-personal-expense-touching-neighbour');
      }
    });
  });

  const inEditWindow = insideAnyWindow(editWindows);
  input.expenses
    .filter((expense) => isPersonalSettlement(expense) && inEditWindow(expense.createdAt))
    .forEach((settlement) =>
      otherParticipants(settlement).forEach((participant) =>
        addForUsers(settlement.paidBy, participant.userId, 'settlement-during-other-edit'),
      ),
    );

  return issues;
};
