import { countMirrorBreaks, getBalanceDrift, getGroupMismatches, getRawSums } from './audit';
import {
  type ReplayInput,
  type ReplayState,
  type SetAnalysis,
  analyseSet,
  buildSets,
  classifyEdits,
  compareAllocations,
  getImportOffsets,
  pairKey,
  replay,
  toStoredState,
} from './replay';
import { type SettlementFix, planSettlementFixes } from './settlements';

export type RepairPlan = ReturnType<typeof buildPlan>;

export const buildPlan = (input: ReplayInput, expenseAmounts: Map<string, number>) => {
  const raw = getRawSums(input);
  const mirror = countMirrorBreaks(input);
  const balanceDrift = getBalanceDrift(input, raw);
  const groupMismatches = getGroupMismatches(input, raw);

  const settlementFixes: SettlementFix[] = planSettlementFixes(input.expenses, expenseAmounts);

  const importOffsets = getImportOffsets(input);
  const stored = toStoredState(input);
  const legacyReplay = replay(input, 'legacy', importOffsets);
  const correctedReplay = replay(input, 'corrected', importOffsets);
  const legacy = legacyReplay.state;
  const corrected = correctedReplay.state;
  const { sets, setOf } = buildSets(input);
  const allocationsPerSet = compareAllocations(
    input.allocations,
    legacyReplay.allocations,
    correctedReplay.allocations,
    setOf,
  );

  const edits = classifyEdits(input);
  const unverifiableEditsPerSet = new Map<string, number>();
  edits.forEach((edit) =>
    new Set(edit.taintedKeys.map((key) => setOf.get(key))).forEach((setId) => {
      if (setId) {
        unverifiableEditsPerSet.set(setId, (unverifiableEditsPerSet.get(setId) ?? 0) + 1);
      }
    }),
  );

  const settlementSets = new Set(
    settlementFixes.map((fix) => setOf.get(pairKey(fix.currency, fix.paidBy, fix.otherId))),
  );

  const analyses: SetAnalysis[] = [...sets.entries()].map(([setId, keys]) => {
    const analysis = analyseSet({
      setId,
      keys,
      stored,
      legacy,
      corrected,
      editedExpenses: unverifiableEditsPerSet.get(setId) ?? 0,
      importOffsets,
      allocations: allocationsPerSet.get(setId),
    });
    // Phase 1 settlements are edited, so their sets are excluded already. Keep it explicit.
    if (settlementSets.has(setId) && 'repair' === analysis.verdict) {
      return {
        ...analysis,
        verdict: 'edited' as const,
        reasons: [...analysis.reasons, 'phase-1-settlement'],
        changes: [],
      };
    }
    return analysis;
  });

  return {
    mirror,
    balanceDrift,
    groupMismatches,
    settlementFixes,
    edits,
    analyses,
    sets,
    setOf,
    stored,
  };
};

/** Snapshot of the rows a set's repair depends on, to detect live writes before applying. */
export const getSetRows = (keys: string[], stored: ReplayState) =>
  keys.map((key) => {
    const pair = stored.get(key);
    return {
      key,
      amount: pair?.amount ?? 0,
      exists: !!pair?.exists,
      groups: [...(pair?.groups.entries() ?? [])],
    };
  });
