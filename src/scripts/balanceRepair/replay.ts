/**
 * Replays balance history to tell legitimate settle-up clears apart from the old
 * "zero every group row when any overall balance is 0" heuristic (removed in PR #2).
 *
 * State is kept per unordered pair and currency. A pair's amount is always stored from the
 * perspective of the lower user id: `Balance(lo, hi)`, and `GroupBalance(lo, hi)` per group.
 * The mirrored rows are the negation, which the audit checks separately.
 */

export type ReplayParticipant = { userId: number; amount: number };

export type ReplayExpense = {
  id: string;
  paidBy: number;
  currency: string;
  groupId: number | null;
  isSettlement: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** `updatedBy` is set. */
  edited: boolean;
  allocationVersion: number | null;
  participants: ReplayParticipant[];
};

export type StoredBalance = {
  userId: number;
  friendId: number;
  currency: string;
  amount: number;
  importedFromSplitwise: boolean;
};

export type StoredGroupBalance = {
  groupId: number;
  currency: string;
  userId: number;
  friendId: number;
  amount: number;
};

export type StoredAllocation = {
  settlementExpenseId: string;
  groupId: number;
  currency: string;
  userId: number;
  friendId: number;
  amount: number;
};

export type ReplayInput = {
  expenses: ReplayExpense[];
  balances: StoredBalance[];
  groupBalances: StoredGroupBalance[];
  /** PR #2's `SettlementAllocation` rows. */
  allocations: StoredAllocation[];
  /** When PR #2 went live. Events from then on follow its rules. `Infinity` if not deployed. */
  cutoff: number;
};

/**
 * `legacy`: the pre-PR #2 rule, reproduced from `updateGroupExpenseForIfBalanceIsZero`.
 * `corrected`: group rows are only cleared when a personal settlement brings that pair to 0.
 */
export type ReplayRule = 'legacy' | 'corrected';

export type PairState = {
  amount: number;
  exists: boolean;
  groups: Map<number, number>;
};

export type ReplayState = Map<string, PairState>;

export type SetId = string;

export const pairKey = (currency: string, a: number, b: number) =>
  a < b ? `${currency}|${a}|${b}` : `${currency}|${b}|${a}`;

/** Multiplier that turns `Balance(a, b)` into the pair's canonical (lower id) amount. */
export const pairSign = (a: number, b: number) => (a < b ? 1 : -1);

export const parsePairKey = (key: string) => {
  const [currency = '', lo = '0', hi = '0'] = key.split('|');
  return { currency, lo: Number(lo), hi: Number(hi) };
};

export const otherParticipants = (expense: ReplayExpense) =>
  expense.participants.filter((participant) => participant.userId !== expense.paidBy);

/** Pairs an expense moves, as canonical keys. */
export const expensePairKeys = (expense: ReplayExpense) =>
  otherParticipants(expense).map((participant) =>
    pairKey(expense.currency, expense.paidBy, participant.userId),
  );

const getPair = (state: ReplayState, key: string) => {
  const existing = state.get(key);
  if (existing) {
    return existing;
  }
  const created: PairState = { amount: 0, exists: false, groups: new Map() };
  state.set(key, created);
  return created;
};

/** Applies (1) or reverts (-1) an expense, exactly like the upserts in splitService. */
const applyExpense = (state: ReplayState, expense: ReplayExpense, direction: 1 | -1) => {
  otherParticipants(expense).forEach((participant) => {
    const pair = getPair(state, pairKey(expense.currency, expense.paidBy, participant.userId));
    // Balance(payer, participant) moves by -participant.amount.
    const delta = pairSign(expense.paidBy, participant.userId) * -participant.amount * direction;
    pair.amount += delta;
    pair.exists = true;

    if (null !== expense.groupId) {
      pair.groups.set(expense.groupId, (pair.groups.get(expense.groupId) ?? 0) + delta);
    }
  });
};

/**
 * The old rule from `updateGroupExpenseForIfBalanceIsZero` (eaee309): if the payer's overall
 * balance with ANY participant is 0, zero the group balances between the payer and EVERY
 * participant, in every group, in this currency.
 */
const applyLegacyZeroing = (state: ReplayState, expense: ReplayExpense) => {
  const userIds = expense.participants.map((participant) => participant.userId);
  const triggered = userIds.some((userId) => {
    const pair = state.get(pairKey(expense.currency, expense.paidBy, userId));
    return userId !== expense.paidBy && !!pair?.exists && 0 === pair.amount;
  });

  if (!triggered) {
    return;
  }

  userIds
    .filter((userId) => userId !== expense.paidBy)
    .forEach((userId) => {
      const pair = state.get(pairKey(expense.currency, expense.paidBy, userId));
      pair?.groups.forEach((_amount, groupId) => pair.groups.set(groupId, 0));
    });
};

/**
 * PR #2's rule (`captureSettlementAllocations`): a personal settlement clears the group rows of
 * each settled pair whose overall balance is now exactly 0, and nothing else.
 */
const captureSettlement = (state: ReplayState, expense: ReplayExpense) => {
  const friendIds = [...new Set(otherParticipants(expense).map((p) => p.userId))];

  friendIds.forEach((friendId) => {
    const pair = state.get(pairKey(expense.currency, expense.paidBy, friendId));
    if (!pair?.exists || 0 !== pair.amount) {
      return;
    }
    pair.groups.forEach((_amount, groupId) => pair.groups.set(groupId, 0));
  });
};

export const isPersonalSettlement = (expense: ReplayExpense) =>
  expense.isSettlement && null === expense.groupId;

type ReplayEvent =
  | { time: number; order: 1; kind: 'create'; expense: ReplayExpense }
  | { time: number; order: 3; kind: 'delete'; expense: ReplayExpense };

/**
 * Replays every expense in time order: create at `createdAt`, delete at `deletedAt`, with the
 * stored participants. Only sets without deleted or edited expenses are ever trusted, so
 * deletes are replayed the simple way (revert, never restore settlement allocations).
 */
export const replay = (input: ReplayInput, rule: ReplayRule): ReplayState => {
  const events: ReplayEvent[] = [];
  input.expenses.forEach((expense) => {
    events.push({ time: expense.createdAt, order: 1, kind: 'create', expense });
    if (null !== expense.deletedAt) {
      events.push({ time: expense.deletedAt, order: 3, kind: 'delete', expense });
    }
  });
  events.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.expense.id < b.expense.id ? -1 : a.expense.id > b.expense.id ? 1 : 0;
  });

  const state: ReplayState = new Map();

  events.forEach(({ kind, expense, time }) => {
    if ('delete' === kind) {
      applyExpense(state, expense, -1);
      return;
    }

    applyExpense(state, expense, 1);
    if (time < input.cutoff && 'legacy' === rule) {
      applyLegacyZeroing(state, expense);
    } else if (isPersonalSettlement(expense)) {
      captureSettlement(state, expense);
    }
  });

  return state;
};

/** Stored balances in the same canonical shape as the replay state. */
export const toStoredState = (input: ReplayInput): ReplayState => {
  const state: ReplayState = new Map();
  input.balances
    .filter((balance) => balance.userId < balance.friendId)
    .forEach((balance) => {
      const pair = getPair(state, pairKey(balance.currency, balance.userId, balance.friendId));
      pair.amount = balance.amount;
      pair.exists = true;
    });
  input.groupBalances
    .filter((balance) => balance.userId < balance.friendId)
    .forEach((balance) => {
      const pair = getPair(state, pairKey(balance.currency, balance.userId, balance.friendId));
      pair.groups.set(balance.groupId, balance.amount);
    });
  return state;
};

/**
 * Independent sets: pairs (per currency) that can influence each other. The old rule couples
 * every payer-participant pair of one expense, since it reads all of their overall balances
 * and zeroes all of their group rows. Nothing else links two pairs.
 */
export const buildSets = (input: ReplayInput) => {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    let node = key;
    while (node !== root) {
      const next = parent.get(node) ?? root;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (key: string) => {
    if (!parent.has(key)) {
      parent.set(key, key);
    }
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      // The smaller key wins so set ids are stable between runs.
      if (rootA < rootB) {
        parent.set(rootB, rootA);
      } else {
        parent.set(rootA, rootB);
      }
    }
  };

  input.expenses.forEach((expense) => {
    const keys = expensePairKeys(expense);
    keys.forEach(add);
    keys.slice(1).forEach((key) => union(keys[0]!, key));
  });
  input.balances.forEach((balance) =>
    add(pairKey(balance.currency, balance.userId, balance.friendId)),
  );
  input.groupBalances.forEach((balance) =>
    add(pairKey(balance.currency, balance.userId, balance.friendId)),
  );

  const sets = new Map<SetId, string[]>();
  parent.forEach((_value, key) => {
    const root = find(key);
    const members = sets.get(root);
    if (members) {
      members.push(key);
    } else {
      sets.set(root, [key]);
    }
  });
  sets.forEach((keys) => keys.sort());
  const setOf = new Map<string, SetId>();
  sets.forEach((keys, setId) => keys.forEach((key) => setOf.set(key, setId)));
  return { sets, setOf };
};

export type GroupRowChange = {
  key: string;
  groupId: number;
  stored: number;
  corrected: number;
};

const groupIdsOf = (...pairs: (PairState | undefined)[]) =>
  [...new Set(pairs.flatMap((pair) => [...(pair?.groups.keys() ?? [])]))].sort((a, b) => a - b);

export type SetVerdict = 'repair' | 'nothing-to-do' | 'skipped' | 'not-reproduced';

export type SetAnalysis = {
  setId: SetId;
  currency: string;
  pairCount: number;
  groupIds: number[];
  verdict: SetVerdict;
  /** Why the set is skipped or not reproduced. */
  reasons: string[];
  /** The legacy replay matches every stored Balance and GroupBalance row of the set. */
  reproducesLegacy: boolean;
  /** Rows the corrected rule would change, whatever the verdict. */
  wouldChange: GroupRowChange[];
  /** Rows to write. Empty unless the verdict is `repair`. */
  changes: GroupRowChange[];
};

/**
 * Classifies one set. A set is repaired only if no pair in it has an eligibility issue and the
 * legacy replay reproduces every stored row exactly. Only GroupBalance rows are ever changed.
 */
export const analyseSet = ({
  setId,
  keys,
  stored,
  legacy,
  corrected,
  issues,
}: {
  setId: SetId;
  keys: string[];
  stored: ReplayState;
  legacy: ReplayState;
  corrected: ReplayState;
  /** Eligibility issues per pair key (see `getPairIssues`). */
  issues: Map<string, Set<string>>;
}): SetAnalysis => {
  const groupIds = new Set<number>();
  let balanceMismatch = 0;
  let groupMismatch = 0;
  const wouldChange: GroupRowChange[] = [];

  keys.forEach((key) => {
    const storedPair = stored.get(key);
    const legacyPair = legacy.get(key);
    const correctedPair = corrected.get(key);

    if ((legacyPair?.amount ?? 0) !== (correctedPair?.amount ?? 0)) {
      throw new Error(
        `Balance differs between replays for ${key}; rules may only differ on groups`,
      );
    }
    if ((storedPair?.amount ?? 0) !== (legacyPair?.amount ?? 0)) {
      balanceMismatch += 1;
    }

    groupIdsOf(storedPair, legacyPair, correctedPair).forEach((groupId) => {
      groupIds.add(groupId);
      const storedAmount = storedPair?.groups.get(groupId) ?? 0;
      if (storedAmount !== (legacyPair?.groups.get(groupId) ?? 0)) {
        groupMismatch += 1;
      }
      const correctedAmount = correctedPair?.groups.get(groupId) ?? 0;
      if (storedAmount !== correctedAmount) {
        wouldChange.push({ key, groupId, stored: storedAmount, corrected: correctedAmount });
      }
    });
  });

  const issueCounts = new Map<string, number>();
  keys.forEach((key) =>
    issues.get(key)?.forEach((issue) => issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1)),
  );
  const reproduces = 0 === balanceMismatch && 0 === groupMismatch;
  const reasons = [...issueCounts.entries()].map(([issue, count]) => `${issue}:${count}`).sort();
  if (!reproduces) {
    reasons.push(
      ...(balanceMismatch ? [`legacy-balance-mismatch:${balanceMismatch}`] : []),
      ...(groupMismatch ? [`legacy-group-mismatch:${groupMismatch}`] : []),
    );
  }

  const base = {
    setId,
    currency: parsePairKey(keys[0] ?? setId).currency,
    pairCount: keys.length,
    groupIds: [...groupIds].sort((a, b) => a - b),
    reasons,
    reproducesLegacy: reproduces,
    wouldChange,
  };

  if (0 === wouldChange.length) {
    return { ...base, verdict: 'nothing-to-do', changes: [] };
  }
  if (issueCounts.size) {
    return { ...base, verdict: 'skipped', changes: [] };
  }
  if (!reproduces) {
    return { ...base, verdict: 'not-reproduced', changes: [] };
  }
  return { ...base, verdict: 'repair', changes: wouldChange };
};
