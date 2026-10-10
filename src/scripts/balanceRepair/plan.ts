import { countMirrorBreaks, getBalanceDrift, getGroupMismatches, getRawSums } from './audit';
import { type EditWindow, getPairIssues } from './eligibility';
import {
  type ReplayInput,
  type ReplayState,
  type SetAnalysis,
  analyseSet,
  buildSets,
  expensePairKeys,
  replay,
  toStoredState,
} from './replay';
import { findSettlementAnomalies } from './settlements';

/** Classifies every set. Pure, so it runs the same on the full snapshot and on one set. */
export const analyseSets = (input: ReplayInput, editWindows?: EditWindow[]) => {
  const issues = getPairIssues(input, editWindows);
  const stored = toStoredState(input);
  const legacy = replay(input, 'legacy');
  const corrected = replay(input, 'corrected');
  const { sets, setOf } = buildSets(input);

  const analyses: SetAnalysis[] = [...sets.entries()].map(([setId, keys]) =>
    analyseSet({ setId, keys, stored, legacy, corrected, issues }),
  );

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

  return { analyses, sets, setOf, stored, expenseIdsBySet };
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

export type SetRow = { key: string; amount: number; exists: boolean; groups: [number, number][] };

/** Snapshot of the rows a set's repair depends on, to detect live writes before applying. */
export const getSetRows = (keys: string[], stored: ReplayState): SetRow[] =>
  keys.map((key) => {
    const pair = stored.get(key);
    return {
      key,
      amount: pair?.amount ?? 0,
      exists: !!pair?.exists,
      groups: [...(pair?.groups.entries() ?? [])].sort((a, b) => a[0] - b[0]),
    };
  });
