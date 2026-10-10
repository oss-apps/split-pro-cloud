import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ReplayExpense,
  type ReplayInput,
  type StoredBalance,
  type StoredGroupBalance,
  analyseSet,
  buildSets,
  classifyEdits,
  compareAllocations,
  getImportOffsets,
  pairKey,
  parsePairKey,
  replay,
  toStoredState,
} from '~/scripts/balanceRepair/replay';
import { planSettlementFixes } from '~/scripts/balanceRepair/settlements';

const A = 1;
const B = 2;
const C = 3;
const GROUP = 10;
const OTHER_GROUP = 11;

let nextId = 0;
const expense = (
  overrides: Partial<ReplayExpense> & Pick<ReplayExpense, 'paidBy' | 'participants' | 'createdAt'>,
): ReplayExpense => ({
  id: `e${(nextId += 1)}`,
  currency: 'USD',
  groupId: null,
  isSettlement: false,
  updatedAt: overrides.createdAt,
  deletedAt: null,
  edited: false,
  allocationVersion: null,
  ...overrides,
});

const settlement = (paidBy: number, otherId: number, amount: number, createdAt: number) =>
  expense({
    paidBy,
    createdAt,
    isSettlement: true,
    participants: [
      { userId: paidBy, amount },
      { userId: otherId, amount: -amount },
    ],
  });

const input = (expenses: ReplayExpense[], overrides: Partial<ReplayInput> = {}): ReplayInput => ({
  expenses,
  balances: [],
  groupBalances: [],
  memberships: new Set(),
  existingGroupIds: new Set([GROUP, OTHER_GROUP]),
  cutoff: Number.POSITIVE_INFINITY,
  allocations: [],
  ...overrides,
});

/** Builds the stored rows (both sides) that a replay state would leave in the database. */
const storedRowsFrom = (data: ReplayInput, rule: 'legacy' | 'corrected') => {
  const balances: StoredBalance[] = [];
  const groupBalances: StoredGroupBalance[] = [];
  replay(data, rule).state.forEach((pair, key) => {
    const { currency, lo, hi } = parsePairKey(key);
    if (pair.exists) {
      balances.push(
        {
          userId: lo,
          friendId: hi,
          currency,
          amount: pair.amount,
          createdAt: 0,
          importedFromSplitwise: false,
        },
        {
          userId: hi,
          friendId: lo,
          currency,
          amount: -pair.amount,
          createdAt: 0,
          importedFromSplitwise: false,
        },
      );
    }
    pair.groups.forEach((amount, groupId) =>
      groupBalances.push(
        { groupId, currency, userId: lo, friendId: hi, amount },
        { groupId, currency, userId: hi, friendId: lo, amount: -amount },
      ),
    );
  });
  return { balances, groupBalances };
};

const analyse = (data: ReplayInput) => {
  const { sets } = buildSets(data);
  const importOffsets = getImportOffsets(data);
  const stored = toStoredState(data);
  const legacy = replay(data, 'legacy', importOffsets).state;
  const corrected = replay(data, 'corrected', importOffsets).state;
  return [...sets.entries()].map(([setId, keys]) =>
    analyseSet({ setId, keys, stored, legacy, corrected, editedExpenses: 0, importOffsets }),
  );
};

const groupAmount = (
  data: ReplayInput,
  rule: 'legacy' | 'corrected',
  a: number,
  b: number,
  groupId: number,
) =>
  replay(data, rule)
    .state.get(pairKey('USD', a, b))
    ?.groups.get(groupId) ?? 0;

void describe('balance repair replay', () => {
  // C owes A 10.00 in the group.
  const history = () => [
    expense({
      paidBy: A,
      groupId: GROUP,
      createdAt: 1,
      participants: [
        { userId: A, amount: 1000 },
        { userId: C, amount: -1000 },
      ],
    }),
  ];

  void it('old rule zeroes a group through an unrelated participant, the new rule does not', () => {
    const expenses = [
      ...history(),
      // A pays again and B, who owes A nothing, is listed with a zero share. Balance(A, B) is 0,
      // so the old rule zeroed every group balance between A and the participants.
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 2,
        participants: [
          { userId: A, amount: 500 },
          { userId: B, amount: 0 },
          { userId: C, amount: -500 },
        ],
      }),
    ];
    const data = input(expenses);

    // Balance(A, C) = 15.00 is the lower-id side of the pair.
    assert.equal(groupAmount(data, 'legacy', A, C, GROUP), 0);
    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 1500);
    assert.equal(replay(data, 'legacy').state.get(pairKey('USD', A, C))?.amount, 1500);

    const stored = input(expenses, storedRowsFrom(data, 'legacy'));
    const analysis = analyse(stored).find((a) => a.changes.length);
    assert.equal(analysis?.verdict, 'repair');
    assert.deepEqual(analysis?.changes, [
      { key: pairKey('USD', A, C), groupId: GROUP, stored: 0, corrected: 1500 },
    ]);
  });

  void it('keeps a legitimate settle-up clear that both rules agree on', () => {
    const expenses = [...history(), settlement(C, A, 1000, 2)];
    const data = input(expenses);

    assert.equal(groupAmount(data, 'legacy', A, C, GROUP), 0);
    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 0);

    const analyses = analyse(input(expenses, storedRowsFrom(data, 'legacy')));
    assert.ok(analyses.every((a) => 'nothing-to-do' === a.verdict && a.reproducesLegacy));
  });

  void it('clears the settled pair in every group but leaves other pairs alone', () => {
    const expenses = [
      ...history(),
      expense({
        paidBy: A,
        groupId: OTHER_GROUP,
        createdAt: 2,
        participants: [
          { userId: A, amount: 300 },
          { userId: B, amount: -300 },
          { userId: C, amount: 0 },
        ],
      }),
      settlement(C, A, 1000, 3),
    ];
    const data = input(expenses);

    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 0);
    assert.equal(groupAmount(data, 'corrected', A, B, OTHER_GROUP), 300);
    // A settlement only lists its two people, so the old rule did not touch A-B either.
    assert.equal(groupAmount(data, 'legacy', A, B, OTHER_GROUP), 300);
  });

  void it('does not clear groups for a partial settle-up', () => {
    const data = input([...history(), settlement(C, A, 400, 2)]);
    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 1000);
    assert.equal(groupAmount(data, 'legacy', A, C, GROUP), 1000);
  });

  void it('is a no-op once stored balances equal the corrected replay', () => {
    const expenses = [
      ...history(),
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 2,
        participants: [
          { userId: A, amount: 500 },
          { userId: B, amount: 0 },
          { userId: C, amount: -500 },
        ],
      }),
    ];
    const repaired = input(expenses, storedRowsFrom(input(expenses), 'corrected'));
    assert.ok(analyse(repaired).every((a) => 'nothing-to-do' === a.verdict));
  });

  void it('does not trust a set whose stored rows the old rule cannot reproduce', () => {
    const expenses = history();
    const rows = storedRowsFrom(input(expenses), 'legacy');
    // An expense that is gone (for example a deleted group) still shows in Balance.
    const balances = rows.balances.map((b) => ({
      ...b,
      amount: b.amount + (b.userId === A ? 1 : -1),
    }));
    const groupBalances = rows.groupBalances.map((b) => ({ ...b, amount: 0 }));
    const analyses = analyse(input(expenses, { balances, groupBalances }));
    const untrusted = analyses.find((a) => a.reasons.length);
    assert.equal(untrusted?.verdict, 'not-reproduced');
    assert.match(untrusted?.reasons.join(' ') ?? '', /balance-drift/);
  });

  void it('replays a Splitwise import only when its time is known', () => {
    const expenses = history();
    const rows = storedRowsFrom(input(expenses), 'legacy');
    const imported = (createdAt: number) =>
      rows.balances.map((b) => ({
        ...b,
        amount: b.amount + (b.userId === A ? 700 : -700),
        createdAt,
        importedFromSplitwise: true,
      }));

    // The row predates every expense, so the import created it.
    const before = analyse(input(expenses, { ...rows, balances: imported(-10_000) }));
    assert.ok(before.every((a) => a.reproducesLegacy && !a.reasons.length));

    // The row was created by the expense; the import was added later at an unknown time.
    const after = analyse(input(expenses, { ...rows, balances: imported(1) }));
    assert.match(after.map((a) => a.reasons.join(' ')).join(' '), /splitwise-import-time-unknown/);
  });

  void it('replays deletes by reverting the expense without re-running the rule', () => {
    const removed = expense({
      paidBy: A,
      groupId: GROUP,
      createdAt: 2,
      deletedAt: 3,
      participants: [
        { userId: A, amount: 200 },
        { userId: C, amount: -200 },
      ],
    });
    const data = input([...history(), removed]);
    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 1000);
    assert.equal(replay(data, 'corrected').state.get(pairKey('USD', A, C))?.amount, 1000);
  });

  void it('restores PR #2 settlement allocations when a settlement is deleted after the cutoff', () => {
    const settle = { ...settlement(C, A, 1000, 5), allocationVersion: 1, deletedAt: 6 };
    const data = input([...history(), settle], {
      cutoff: 4,
      memberships: new Set([`${GROUP}:${A}`, `${GROUP}:${C}`]),
    });
    assert.equal(groupAmount(data, 'corrected', A, C, GROUP), 1000);
    assert.equal(groupAmount(data, 'legacy', A, C, GROUP), 1000);
  });

  void it('leaves a set alone when a post-deploy settlement would have recorded other amounts', () => {
    const D = 4;
    const expenses = [
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 1,
        participants: [
          { userId: A, amount: 2000 },
          { userId: B, amount: -1000 },
          { userId: C, amount: -1000 },
        ],
      }),
      // D owes nothing, so the old rule wiped A's group rows with B and C.
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 2,
        participants: [
          { userId: A, amount: 1000 },
          { userId: B, amount: -500 },
          { userId: C, amount: -500 },
          { userId: D, amount: 0 },
        ],
      }),
      // After PR #2: C settles in full, which records the group rows it clears.
      { ...settlement(C, A, 1500, 4), allocationVersion: 1 },
    ];
    const data = input(expenses, { cutoff: 3 });
    assert.equal(groupAmount(data, 'corrected', A, B, GROUP), 1500);
    assert.equal(groupAmount(data, 'legacy', A, B, GROUP), 0);
    assert.equal(replay(data, 'legacy').allocations.size, 0);
    assert.equal(replay(data, 'corrected').allocations.size, 1);

    const stored = input(expenses, { ...storedRowsFrom(data, 'legacy'), cutoff: 3 });
    const { sets, setOf } = buildSets(stored);
    const importOffsets = getImportOffsets(stored);
    const legacyReplay = replay(stored, 'legacy', importOffsets);
    const correctedReplay = replay(stored, 'corrected', importOffsets);
    const allocations = compareAllocations(
      [],
      legacyReplay.allocations,
      correctedReplay.allocations,
      setOf,
    );
    const setId = setOf.get(pairKey('USD', A, B))!;
    const analysis = analyseSet({
      setId,
      keys: sets.get(setId)!,
      stored: toStoredState(stored),
      legacy: legacyReplay.state,
      corrected: correctedReplay.state,
      editedExpenses: 0,
      importOffsets,
      allocations: allocations.get(setId),
    });
    assert.equal(analysis.verdict, 'not-reproduced');
    assert.match(analysis.reasons.join(' '), /settlement-allocations-would-change/);
  });

  void it('couples only pairs that share an expense', () => {
    const data = input([
      expense({
        paidBy: A,
        createdAt: 1,
        participants: [
          { userId: A, amount: 200 },
          { userId: B, amount: -100 },
          { userId: C, amount: -100 },
        ],
      }),
      expense({
        paidBy: B,
        createdAt: 2,
        participants: [
          { userId: B, amount: 100 },
          { userId: C, amount: -100 },
        ],
      }),
    ]);
    const { setOf } = buildSets(data);
    assert.equal(setOf.get(pairKey('USD', A, B)), setOf.get(pairKey('USD', A, C)));
    assert.notEqual(setOf.get(pairKey('USD', B, C)), setOf.get(pairKey('USD', A, C)));
  });
});

void describe('classifyEdits', () => {
  const edited = (createdAt: number, updatedAt: number) =>
    expense({
      paidBy: A,
      groupId: GROUP,
      createdAt,
      updatedAt,
      edited: true,
      participants: [
        { userId: A, amount: 500 },
        { userId: C, amount: -500 },
      ],
    });

  void it('treats an edit as neutral when no settlement happened in its window', () => {
    const edit = edited(1, 5);
    const [result] = classifyEdits(input([edit, settlement(C, A, 500, 6)]));
    assert.equal(result?.status, 'neutral');
  });

  void it('distrusts an edit with a settlement between possible participants in its window', () => {
    const edit = edited(1, 5);
    // B was never on this expense, but is in the group, so an earlier version may have had B.
    const data = input([edit, settlement(B, A, 100, 3)], {
      groupBalances: [
        { groupId: GROUP, currency: 'USD', userId: A, friendId: B, amount: 0 },
        { groupId: GROUP, currency: 'USD', userId: B, friendId: A, amount: 0 },
      ],
    });
    const [result] = classifyEdits(data);
    assert.equal(result?.status, 'settlement-in-window');
    assert.deepEqual(
      result?.taintedKeys.sort(),
      [pairKey('USD', A, B), pairKey('USD', A, C)].sort(),
    );
  });

  void it('never trusts an edited settlement', () => {
    const edit = { ...settlement(C, A, 500, 1), edited: true, updatedAt: 2 };
    assert.equal(classifyEdits(input([edit]))[0]?.status, 'edited-settlement');
  });
});

void describe('planSettlementFixes', () => {
  // The old editor turned payer +50.00 / other -50.00 into +25.00 / +25.00.
  const flipped = (createdAt: number, updatedAt: number) =>
    expense({
      paidBy: A,
      createdAt,
      updatedAt,
      edited: true,
      isSettlement: true,
      participants: [
        { userId: A, amount: 2500 },
        { userId: B, amount: 2500 },
      ],
    });

  void it('restores the canonical form and corrects the pair by the difference', () => {
    const fix = flipped(1, 2);
    const [result] = planSettlementFixes([fix], new Map([[fix.id, 5000]]));
    assert.equal(result?.status, 'auto');
    // Balance(B, A) must move from +25.00 to -50.00.
    assert.equal(result?.delta, -7500);
  });

  void it('leaves it for review when the pair settled again afterwards', () => {
    const fix = flipped(1, 2);
    const later = settlement(B, A, 7500, 3);
    const [result] = planSettlementFixes(
      [fix, later],
      new Map([
        [fix.id, 5000],
        [later.id, 7500],
      ]),
    );
    assert.equal(result?.status, 'manual');
    assert.equal(result?.reason, 'later-settlement-between-pair');
  });

  void it('ignores canonical settlements', () => {
    const ok = settlement(A, B, 5000, 1);
    assert.deepEqual(planSettlementFixes([ok], new Map([[ok.id, 5000]])), []);
  });
});
