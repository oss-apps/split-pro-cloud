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
  edited: boolean;
  allocationVersion: number | null;
  participants: ReplayParticipant[];
};

export type StoredBalance = {
  userId: number;
  friendId: number;
  currency: string;
  amount: number;
  createdAt: number;
  importedFromSplitwise: boolean;
};

export type StoredGroupBalance = {
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
  /** `${groupId}:${userId}` for current members, used when restoring settlement allocations. */
  memberships: Set<string>;
  existingGroupIds: Set<number>;
  /** When PR #2 went live. Events from then on follow its rules. `Infinity` if not deployed. */
  cutoff: number;
  /** PR #2's `SettlementAllocation` rows. */
  allocations: StoredAllocation[];
};

export type StoredAllocation = {
  settlementExpenseId: string;
  groupId: number;
  currency: string;
  userId: number;
  friendId: number;
  amount: number;
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

const getPair = (state: ReplayState, key: string) => {
  const existing = state.get(key);
  if (existing) {
    return existing;
  }
  const created: PairState = { amount: 0, exists: false, groups: new Map() };
  state.set(key, created);
  return created;
};

const otherParticipants = (expense: ReplayExpense) =>
  expense.participants.filter((participant) => participant.userId !== expense.paidBy);

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

export type Allocation = { key: string; groupId: number; amount: number };

/**
 * PR #2's rule (`captureSettlementAllocations`): a personal settlement clears the group rows of
 * each settled pair whose overall balance is now exactly 0, and nothing else.
 */
const captureSettlement = (state: ReplayState, expense: ReplayExpense) => {
  const allocations: Allocation[] = [];
  const friendIds = [...new Set(otherParticipants(expense).map((p) => p.userId))];

  friendIds.forEach((friendId) => {
    const key = pairKey(expense.currency, expense.paidBy, friendId);
    const pair = state.get(key);
    if (!pair?.exists || 0 !== pair.amount) {
      return;
    }
    pair.groups.forEach((amount, groupId) => {
      if (0 === amount) {
        return;
      }
      allocations.push({ key, groupId, amount });
      pair.groups.set(groupId, 0);
    });
  });

  return allocations;
};

const isPersonalSettlement = (expense: ReplayExpense) =>
  expense.isSettlement && null === expense.groupId;

type ReplayEvent =
  | { time: number; order: 0; kind: 'import'; key: string; offset: number }
  | { time: number; order: 1; kind: 'create'; expense: ReplayExpense }
  | { time: number; order: 2; kind: 'edit'; expense: ReplayExpense }
  | { time: number; order: 3; kind: 'delete'; expense: ReplayExpense };

/** Pairs whose stored Balance came (partly) from a Splitwise import, with the import time. */
export type ImportOffsets = Map<string, { time: number; offset: number; timeKnown: boolean }>;

/** Rows created within this long of an expense may have been created by that expense. */
const ROW_CREATION_SLACK_MS = 5_000;

/**
 * The final `Balance` is linear in the live expenses, so a Splitwise offset is whatever the
 * stored balance has on top of them. Only rows flagged `importedFromSplitwise` get an offset.
 * The import time is the row's `createdAt` only if no expense on the pair came first; otherwise
 * the import updated an existing row and its time is unknown.
 */
export const getImportOffsets = (input: ReplayInput): ImportOffsets => {
  const liveSums = new Map<string, number>();
  const firstExpense = new Map<string, number>();
  input.expenses.forEach((expense) =>
    otherParticipants(expense).forEach((participant) => {
      const key = pairKey(expense.currency, expense.paidBy, participant.userId);
      firstExpense.set(key, Math.min(firstExpense.get(key) ?? Infinity, expense.createdAt));
      if (null === expense.deletedAt) {
        const delta = pairSign(expense.paidBy, participant.userId) * -participant.amount;
        liveSums.set(key, (liveSums.get(key) ?? 0) + delta);
      }
    }),
  );

  const offsets: ImportOffsets = new Map();
  input.balances
    .filter((balance) => balance.importedFromSplitwise && balance.userId < balance.friendId)
    .forEach((balance) => {
      const key = pairKey(balance.currency, balance.userId, balance.friendId);
      offsets.set(key, {
        time: balance.createdAt,
        offset: balance.amount - (liveSums.get(key) ?? 0),
        timeKnown: (firstExpense.get(key) ?? Infinity) > balance.createdAt + ROW_CREATION_SLACK_MS,
      });
    });
  return offsets;
};

export type ReplayResult = {
  state: ReplayState;
  /** Settlements whose allocations were captured after the cutoff, by expense id. */
  allocations: Map<string, Allocation[]>;
};

/**
 * Replays every expense in time order: create at `createdAt`, delete at `deletedAt`.
 * Edited expenses are replayed as if they always had their final amounts, with the old rule
 * re-run at `updatedAt` as the edit did. That assumption is unverifiable, so callers must not
 * trust sets that contain edits.
 */
export const replay = (
  input: ReplayInput,
  rule: ReplayRule,
  importOffsets: ImportOffsets = getImportOffsets(input),
): ReplayResult => {
  const events: ReplayEvent[] = [];
  importOffsets.forEach(({ time, offset }, key) =>
    events.push({ time, order: 0, kind: 'import', key, offset }),
  );
  input.expenses.forEach((expense) => {
    events.push({ time: expense.createdAt, order: 1, kind: 'create', expense });
    // Once deleted, `updatedAt` is the delete time, so an earlier edit has no known time.
    if (expense.edited && null === expense.deletedAt) {
      events.push({ time: expense.updatedAt, order: 2, kind: 'edit', expense });
    }
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
    const aId = 'import' === a.kind ? a.key : a.expense.id;
    const bId = 'import' === b.kind ? b.key : b.expense.id;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  const state: ReplayState = new Map();
  const allocations = new Map<string, Allocation[]>();

  events.forEach((event) => {
    if ('import' === event.kind) {
      const pair = getPair(state, event.key);
      pair.amount += event.offset;
      pair.exists = true;
      return;
    }

    const { expense } = event;
    const beforeCutoff = event.time < input.cutoff;

    if ('create' === event.kind) {
      applyExpense(state, expense, 1);
      if (beforeCutoff) {
        if ('legacy' === rule) {
          applyLegacyZeroing(state, expense);
        } else if (isPersonalSettlement(expense)) {
          captureSettlement(state, expense);
        }
      } else if (isPersonalSettlement(expense) && 1 === expense.allocationVersion) {
        const captured = captureSettlement(state, expense);
        if (captured.length) {
          allocations.set(expense.id, captured);
        }
      }
      return;
    }

    if ('edit' === event.kind) {
      // The old edit reverted and re-applied the expense, then ran the zero rule again. PR #2
      // edits that keep the amounts only change metadata.
      if (beforeCutoff) {
        if ('legacy' === rule) {
          applyLegacyZeroing(state, expense);
        } else if (isPersonalSettlement(expense)) {
          captureSettlement(state, expense);
        }
      }
      return;
    }

    if (!beforeCutoff) {
      // PR #2 puts captured group rows back when a settlement is deleted, for current members.
      allocations.get(expense.id)?.forEach((allocation) => {
        const { lo, hi } = parsePairKey(allocation.key);
        const restorable =
          input.existingGroupIds.has(allocation.groupId) &&
          input.memberships.has(`${allocation.groupId}:${lo}`) &&
          input.memberships.has(`${allocation.groupId}:${hi}`);
        if (!restorable) {
          return;
        }
        const pair = getPair(state, allocation.key);
        pair.groups.set(
          allocation.groupId,
          (pair.groups.get(allocation.groupId) ?? 0) + allocation.amount,
        );
      });
      allocations.delete(expense.id);
    }
    applyExpense(state, expense, -1);
  });

  return { state, allocations };
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
      if (!parent.has(root)) {
        parent.set(root, root);
      }
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
    const keys = otherParticipants(expense).map((participant) =>
      pairKey(expense.currency, expense.paidBy, participant.userId),
    );
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
  const setOf = new Map<string, SetId>();
  sets.forEach((keys, setId) => keys.forEach((key) => setOf.set(key, setId)));
  return { sets, setOf };
};

export type EditClassification = {
  expenseId: string;
  status: 'neutral' | 'edited-settlement' | 'settlement-in-window';
  /** Pairs whose sets cannot be trusted because of this edit. Empty when neutral. */
  taintedKeys: string[];
};

/**
 * Earlier versions of edited expenses are not stored. The corrected rule only reads balances
 * when a personal settlement is created (or a settlement is edited), so an edit cannot change
 * the corrected result unless such a settlement happened, between two people who could have
 * been on the earlier version, between the expense's creation and its last edit. Before that
 * window the expense did not exist; after it only the stored version did.
 *
 * People who could have been on a group expense: anyone with a GroupBalance row in the group
 * (every participant gets one, and rows are never removed) plus current members. For a
 * personal expense: the stored participants. Edited settlements are never neutral.
 */
export const classifyEdits = (input: ReplayInput): EditClassification[] => {
  const usersByGroup = new Map<number, Set<number>>();
  const addGroupUser = (groupId: number, userId: number) => {
    const users = usersByGroup.get(groupId) ?? new Set<number>();
    users.add(userId);
    usersByGroup.set(groupId, users);
  };
  input.groupBalances.forEach((balance) => {
    addGroupUser(balance.groupId, balance.userId);
    addGroupUser(balance.groupId, balance.friendId);
  });
  input.memberships.forEach((membership) => {
    const [groupId = '0', userId = '0'] = membership.split(':');
    addGroupUser(Number(groupId), Number(userId));
  });

  type SettlementEvent = { time: number; otherId: number; key: string };
  const settlementEvents = new Map<number, SettlementEvent[]>();
  input.expenses.filter(isPersonalSettlement).forEach((settlement) =>
    otherParticipants(settlement).forEach((participant) => {
      const key = pairKey(settlement.currency, settlement.paidBy, participant.userId);
      const times = [settlement.createdAt];
      if (settlement.edited && null === settlement.deletedAt) {
        times.push(settlement.updatedAt);
      }
      times.forEach((time) => {
        [
          [settlement.paidBy, participant.userId],
          [participant.userId, settlement.paidBy],
        ].forEach(([userId = 0, otherId = 0]) => {
          const events = settlementEvents.get(userId) ?? [];
          events.push({ time, otherId, key });
          settlementEvents.set(userId, events);
        });
      });
    }),
  );

  return input.expenses
    .filter((expense) => expense.edited)
    .map((expense): EditClassification => {
      const ownKeys = otherParticipants(expense).map((participant) =>
        pairKey(expense.currency, expense.paidBy, participant.userId),
      );
      if (expense.isSettlement) {
        return { expenseId: expense.id, status: 'edited-settlement', taintedKeys: ownKeys };
      }

      const candidates = new Set<number>([
        expense.paidBy,
        ...expense.participants.map((participant) => participant.userId),
        ...(null === expense.groupId ? [] : [...(usersByGroup.get(expense.groupId) ?? [])]),
      ]);
      // A deleted expense's last edit happened at some point before the delete.
      const windowEnd = expense.deletedAt ?? expense.updatedAt;
      const inWindow = [...candidates].flatMap((userId) =>
        (settlementEvents.get(userId) ?? []).filter(
          (event) =>
            candidates.has(event.otherId) &&
            event.time >= expense.createdAt &&
            event.time <= windowEnd,
        ),
      );

      if (!inWindow.length) {
        return { expenseId: expense.id, status: 'neutral', taintedKeys: [] };
      }
      return {
        expenseId: expense.id,
        status: 'settlement-in-window',
        taintedKeys: [...new Set([...ownKeys, ...inWindow.map((event) => event.key)])],
      };
    });
};

const allocationEntries = (allocations: Map<string, Allocation[]>) =>
  [...allocations.entries()].flatMap(([expenseId, rows]) =>
    rows.map((row) => ({
      id: `${expenseId}#${row.groupId}#${row.key}`,
      key: row.key,
      amount: row.amount,
    })),
  );

/**
 * Per set: stored allocations (lower-id side) that the legacy replay does not produce exactly,
 * and allocations that the corrected replay would capture differently.
 */
export const compareAllocations = (
  stored: StoredAllocation[],
  legacy: Map<string, Allocation[]>,
  corrected: Map<string, Allocation[]>,
  setOf: Map<string, SetId>,
) => {
  const result = new Map<SetId, { notReproduced: number; changed: number }>();
  const bump = (key: string, field: 'notReproduced' | 'changed') => {
    const setId = setOf.get(key);
    if (!setId) {
      return;
    }
    const entry = result.get(setId) ?? { notReproduced: 0, changed: 0 };
    entry[field] += 1;
    result.set(setId, entry);
  };
  const toMap = (rows: { id: string; key: string; amount: number }[]) =>
    new Map(rows.map((row) => [row.id, row]));

  const storedRows = toMap(
    stored
      .filter((row) => row.userId < row.friendId)
      .map((row) => {
        const key = pairKey(row.currency, row.userId, row.friendId);
        return { id: `${row.settlementExpenseId}#${row.groupId}#${key}`, key, amount: row.amount };
      }),
  );
  const legacyRows = toMap(allocationEntries(legacy));
  const correctedRows = toMap(allocationEntries(corrected));

  new Set([...storedRows.keys(), ...legacyRows.keys()]).forEach((id) => {
    const row = storedRows.get(id) ?? legacyRows.get(id);
    if (row && storedRows.get(id)?.amount !== legacyRows.get(id)?.amount) {
      bump(row.key, 'notReproduced');
    }
  });
  new Set([...legacyRows.keys(), ...correctedRows.keys()]).forEach((id) => {
    const row = legacyRows.get(id) ?? correctedRows.get(id);
    if (row && legacyRows.get(id)?.amount !== correctedRows.get(id)?.amount) {
      bump(row.key, 'changed');
    }
  });
  return result;
};

export type GroupRowChange = {
  key: string;
  groupId: number;
  stored: number;
  corrected: number;
};

const groupIdsOf = (...pairs: (PairState | undefined)[]) =>
  [...new Set(pairs.flatMap((pair) => [...(pair?.groups.keys() ?? [])]))].sort((a, b) => a - b);

export type SetVerdict = 'repair' | 'nothing-to-do' | 'edited' | 'not-reproduced';

export type SetAnalysis = {
  setId: SetId;
  currency: string;
  pairCount: number;
  groupIds: number[];
  verdict: SetVerdict;
  /** Why the set cannot be trusted. */
  reasons: string[];
  /** Facts that do not block a repair on their own. */
  notes: string[];
  editedExpenses: number;
  /** The legacy replay matches every stored row (for edited sets: if edits kept their amounts). */
  reproducesLegacy: boolean;
  changes: GroupRowChange[];
};

/**
 * Classifies one set. Only sets where the legacy replay reproduces every stored row exactly
 * are trusted, and only their GroupBalance rows are changed (to the corrected replay).
 */
export const analyseSet = ({
  setId,
  keys,
  stored,
  legacy,
  corrected,
  editedExpenses,
  importOffsets,
  allocations = { notReproduced: 0, changed: 0 },
}: {
  setId: SetId;
  keys: string[];
  stored: ReplayState;
  legacy: ReplayState;
  corrected: ReplayState;
  editedExpenses: number;
  importOffsets: ImportOffsets;
  /** Settlement allocations the legacy replay misses, and ones the corrected replay changes. */
  allocations?: { notReproduced: number; changed: number };
}): SetAnalysis => {
  const reasons: string[] = [];
  const notes: string[] = [];
  const groupIds = new Set<number>();
  let balanceDrift = 0;
  let groupMismatch = 0;
  let existenceMismatch = 0;
  const changes: GroupRowChange[] = [];

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
      balanceDrift += 1;
    } else if (!!storedPair?.exists !== !!legacyPair?.exists) {
      existenceMismatch += 1;
    }

    groupIdsOf(storedPair, legacyPair, correctedPair).forEach((groupId) => {
      groupIds.add(groupId);
      const storedAmount = storedPair?.groups.get(groupId) ?? 0;
      if (storedAmount !== (legacyPair?.groups.get(groupId) ?? 0)) {
        groupMismatch += 1;
      }
      const correctedAmount = correctedPair?.groups.get(groupId) ?? 0;
      if (storedAmount !== correctedAmount) {
        changes.push({ key, groupId, stored: storedAmount, corrected: correctedAmount });
      }
    });
  });

  const imported = keys.filter((key) => importOffsets.has(key)).length;
  const importTimeUnknown = keys.filter(
    (key) => false === importOffsets.get(key)?.timeKnown,
  ).length;
  // A Balance row that the replay expects but storage lacks (or vice versa) at amount 0 is a
  // `deleteFriend`, which only removes zero rows. The corrected rule never reads row existence
  // for anything but the settling pair, so this alone does not make a set untrustworthy.
  const reproduces =
    0 === balanceDrift &&
    0 === groupMismatch &&
    0 === allocations.notReproduced &&
    0 === importTimeUnknown;

  if (balanceDrift) {
    reasons.push(`balance-drift:${balanceDrift}`);
  }
  if (groupMismatch) {
    reasons.push(`group-rows-not-reproduced:${groupMismatch}`);
  }
  if (importTimeUnknown) {
    // The offset was added to an existing balance at an unknown time, which settle-ups may read.
    reasons.push(`splitwise-import-time-unknown:${importTimeUnknown}`);
  }
  if (allocations.notReproduced) {
    reasons.push(`allocations-not-reproduced:${allocations.notReproduced}`);
  }
  if (allocations.changed) {
    // Repairing would leave PR #2's records of what a settlement cleared out of date.
    reasons.push(`settlement-allocations-would-change:${allocations.changed}`);
  }
  if (existenceMismatch) {
    notes.push(`balance-row-deleted:${existenceMismatch}`);
  }
  if (imported) {
    notes.push(`splitwise-import:${imported}`);
  }
  if (editedExpenses) {
    reasons.push(`edited-expenses:${editedExpenses}`);
  }

  const base = {
    setId,
    currency: parsePairKey(keys[0] ?? setId).currency,
    pairCount: keys.length,
    groupIds: [...groupIds].sort((a, b) => a - b),
    reasons,
    notes,
    editedExpenses,
    reproducesLegacy: reproduces,
  };

  // Includes a second run after a repair, where stored already equals the corrected replay.
  if (0 === changes.length) {
    return { ...base, verdict: 'nothing-to-do', changes: [] };
  }
  if (editedExpenses) {
    return { ...base, verdict: 'edited', changes: [] };
  }
  if (!reproduces || allocations.changed) {
    return { ...base, verdict: 'not-reproduced', changes: [] };
  }
  return { ...base, verdict: 'repair', changes };
};
