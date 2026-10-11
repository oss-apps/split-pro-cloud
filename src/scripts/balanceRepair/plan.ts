import { countMirrorBreaks, getBalanceDrift, getGroupMismatches, getRawSums } from './audit';
import { type EditWindow, getPairIssues } from './eligibility';
import {
  type ReplayInput,
  type SetAnalysis,
  analyseSet,
  buildSets,
  expensePairKeys,
  pairKey,
  parsePairKey,
  replay,
  toStoredState,
} from './replay';
import { findSettlementAnomalies } from './settlements';

/** One stored row as it is in the database, in its own direction. */
export type DirectedRow = {
  table: 'Balance' | 'GroupBalance';
  groupId: number | null;
  currency: string;
  userId: number;
  friendId: number;
  amount: number;
};

export const directedRowId = (row: Omit<DirectedRow, 'amount'>) =>
  `${row.table}|${row.groupId ?? ''}|${row.currency}|${row.userId}|${row.friendId}`;

/** Stored rows of both directions, grouped by the pair they belong to. */
const getRowsByKey = (input: ReplayInput) => {
  const rowsByKey = new Map<string, DirectedRow[]>();
  const add = (row: DirectedRow) => {
    const key = pairKey(row.currency, row.userId, row.friendId);
    const rows = rowsByKey.get(key);
    if (rows) {
      rows.push(row);
    } else {
      rowsByKey.set(key, [row]);
    }
  };
  input.balances.forEach((b) =>
    add({
      table: 'Balance',
      groupId: null,
      currency: b.currency,
      userId: b.userId,
      friendId: b.friendId,
      amount: b.amount,
    }),
  );
  input.groupBalances.forEach((b) =>
    add({
      table: 'GroupBalance',
      groupId: b.groupId,
      currency: b.currency,
      userId: b.userId,
      friendId: b.friendId,
      amount: b.amount,
    }),
  );
  return rowsByKey;
};

/** Classifies every set. Pure, so it runs the same on the full snapshot and on one set. */
export const analyseSets = (input: ReplayInput, editWindows?: EditWindow[]) => {
  const issues = getPairIssues(input, editWindows);
  const stored = toStoredState(input);
  const legacy = replay(input, 'legacy');
  const corrected = replay(input, 'corrected');
  const { sets, setOf } = buildSets(input);
  const rowsByKey = getRowsByKey(input);

  const analyses: SetAnalysis[] = [...sets.entries()].map(([setId, keys]) => {
    const analysis = analyseSet({ setId, keys, stored, legacy, corrected, issues });
    if ('repair' !== analysis.verdict) {
      return analysis;
    }
    // Never reopen a group debt with someone who is no longer in the group.
    const formerMembers = analysis.changes.filter((change) => {
      const { lo, hi } = parsePairKey(change.key);
      return (
        !input.memberships.has(`${change.groupId}:${lo}`) ||
        !input.memberships.has(`${change.groupId}:${hi}`)
      );
    }).length;
    if (!formerMembers) {
      return analysis;
    }
    return {
      ...analysis,
      verdict: 'skipped' as const,
      reasons: [...analysis.reasons, `former-member:${formerMembers}`],
      changes: [],
    };
  });

  /** Ids of every expense that moves a pair of the set, for the checks at apply time. */
  const expenseIdsBySet = new Map<string, string[]>();
  input.expenses.forEach((expense) => {
    const [key] = expensePairKeys(expense);
    const setId = key ? setOf.get(key) : undefined;
    if (!setId) {
      return;
    }
    const ids = expenseIdsBySet.get(setId);
    if (ids) {
      ids.push(expense.id);
    } else {
      expenseIdsBySet.set(setId, [expense.id]);
    }
  });

  /** Every stored Balance and GroupBalance row of the pairs, both directions, sorted. */
  const directedRows = (keys: string[]) =>
    keys
      .flatMap((key) => rowsByKey.get(key) ?? [])
      .sort((a, b) => (directedRowId(a) < directedRowId(b) ? -1 : 1));

  return { analyses, sets, setOf, stored, expenseIdsBySet, directedRows };
};

export type RepairPlan = ReturnType<typeof buildPlan>;

export const buildPlan = (input: ReplayInput, expenseAmounts: Map<string, number>) => {
  const raw = getRawSums(input);
  return {
    mirror: countMirrorBreaks(input),
    balanceDrift: getBalanceDrift(input, raw),
    groupMismatches: getGroupMismatches(input, raw),
    settlementFindings: findSettlementAnomalies(input.expenses, expenseAmounts),
    ...analyseSets(input),
  };
};
