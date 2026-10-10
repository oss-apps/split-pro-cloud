import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getPairIssues } from '~/scripts/balanceRepair/eligibility';
import { analyseSets } from '~/scripts/balanceRepair/plan';
import {
  type ReplayExpense,
  type ReplayInput,
  type StoredBalance,
  type StoredGroupBalance,
  pairKey,
  parsePairKey,
  replay,
} from '~/scripts/balanceRepair/replay';
import { findSettlementAnomalies } from '~/scripts/balanceRepair/settlements';

const A = 1;
const B = 2;
const C = 3;
const D = 4;
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

/** `paidBy` pays `otherId`: payer +amount, other -amount. */
const pays = (
  paidBy: number,
  otherId: number,
  amount: number,
  createdAt: number,
  overrides: Partial<ReplayExpense> = {},
) =>
  expense({
    paidBy,
    createdAt,
    participants: [
      { userId: paidBy, amount },
      { userId: otherId, amount: -amount },
    ],
    ...overrides,
  });

const settlement = (paidBy: number, otherId: number, amount: number, createdAt: number) =>
  pays(paidBy, otherId, amount, createdAt, { isSettlement: true });

/** Rows the old code would have left in the database for this history. */
const legacyRows = (expenses: ReplayExpense[]) => {
  const balances: StoredBalance[] = [];
  const groupBalances: StoredGroupBalance[] = [];
  replay(input(expenses), 'legacy').forEach((pair, key) => {
    const { currency, lo, hi } = parsePairKey(key);
    if (pair.exists) {
      balances.push(
        { userId: lo, friendId: hi, currency, amount: pair.amount, importedFromSplitwise: false },
        { userId: hi, friendId: lo, currency, amount: -pair.amount, importedFromSplitwise: false },
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

const input = (expenses: ReplayExpense[], overrides: Partial<ReplayInput> = {}): ReplayInput => ({
  expenses,
  balances: [],
  groupBalances: [],
  allocations: [],
  cutoff: Number.POSITIVE_INFINITY,
  ...overrides,
});

/** The stored state the old code produced, analysed. */
const analyse = (expenses: ReplayExpense[], overrides: Partial<ReplayInput> = {}) => {
  const result = analyseSets(input(expenses, { ...legacyRows(expenses), ...overrides }));
  const setOf = (a: number, b: number) =>
    result.analyses.find((analysis) => analysis.setId === result.setOf.get(pairKey('USD', a, b)));
  return { ...result, setOf };
};

const groupAmount = (
  expenses: ReplayExpense[],
  rule: 'legacy' | 'corrected',
  a: number,
  b: number,
) =>
  replay(input(expenses), rule)
    .get(pairKey('USD', a, b))
    ?.groups.get(GROUP) ?? 0;

// C owes A 10.00 in the group.
const groupDebt = (createdAt = 1) =>
  expense({
    paidBy: A,
    groupId: GROUP,
    createdAt,
    participants: [
      { userId: A, amount: 1000 },
      { userId: C, amount: -1000 },
    ],
  });

// A pays again and B, who owes A nothing, is listed with a zero share. Balance(A, B) is 0, so
// the old rule zeroed every group balance between A and the participants.
const zeroShareTrigger = (createdAt = 2) =>
  expense({
    paidBy: A,
    groupId: GROUP,
    createdAt,
    participants: [
      { userId: A, amount: 500 },
      { userId: B, amount: 0 },
      { userId: C, amount: -500 },
    ],
  });

void describe('balance repair replay', () => {
  void it('old rule zeroes a group through an unrelated participant, the new rule does not', () => {
    const expenses = [groupDebt(), zeroShareTrigger()];
    assert.equal(groupAmount(expenses, 'legacy', A, C), 0);
    assert.equal(groupAmount(expenses, 'corrected', A, C), 1500);

    const set = analyse(expenses).setOf(A, C);
    assert.equal(set?.verdict, 'repair');
    assert.deepEqual(set?.changes, [
      { key: pairKey('USD', A, C), groupId: GROUP, stored: 0, corrected: 1500 },
    ]);
  });

  void it('keeps a legitimate settle-up clear that both rules agree on', () => {
    const expenses = [groupDebt(), settlement(C, A, 1000, 2)];
    assert.equal(groupAmount(expenses, 'legacy', A, C), 0);
    assert.equal(groupAmount(expenses, 'corrected', A, C), 0);
    assert.equal(analyse(expenses).setOf(A, C)?.verdict, 'nothing-to-do');
  });

  void it('does not clear groups for a partial settle-up', () => {
    const expenses = [groupDebt(), settlement(C, A, 400, 2)];
    assert.equal(groupAmount(expenses, 'corrected', A, C), 1000);
    assert.equal(groupAmount(expenses, 'legacy', A, C), 1000);
  });

  void it('clears the settled pair in every group but leaves other pairs alone', () => {
    const expenses = [
      groupDebt(),
      expense({
        paidBy: A,
        groupId: OTHER_GROUP,
        createdAt: 2,
        participants: [
          { userId: A, amount: 300 },
          { userId: B, amount: -300 },
        ],
      }),
      settlement(C, A, 1000, 3),
    ];
    const state = replay(input(expenses), 'corrected');
    assert.equal(state.get(pairKey('USD', A, C))?.groups.get(GROUP), 0);
    assert.equal(state.get(pairKey('USD', A, B))?.groups.get(OTHER_GROUP), 300);
  });

  void it('is a no-op once stored balances equal the corrected replay', () => {
    const expenses = [groupDebt(), zeroShareTrigger()];
    const repaired = legacyRows(expenses);
    repaired.groupBalances = repaired.groupBalances.map((row) =>
      row.userId === A && row.friendId === C
        ? { ...row, amount: 1500 }
        : row.userId === C && row.friendId === A
          ? { ...row, amount: -1500 }
          : row,
    );
    const result = analyseSets(input(expenses, repaired));
    assert.ok(result.analyses.every((a) => 'repair' !== a.verdict));
  });

  void it('couples only pairs that share an expense', () => {
    const { setOf } = analyseSets(input([zeroShareTrigger(), pays(B, C, 100, 3)]));
    assert.equal(setOf.get(pairKey('USD', A, B)), setOf.get(pairKey('USD', A, C)));
    assert.notEqual(setOf.get(pairKey('USD', B, C)), setOf.get(pairKey('USD', A, C)));
  });
});

void describe('repair eligibility', () => {
  void it('skips a pair whose deleted settlement would manufacture a debt', () => {
    // Review sample: A pays a group expense C cancels in the group, a settlement is made and
    // deleted, then the group expenses are deleted. The replay cannot know what the user meant.
    const expenses = [
      expense({
        paidBy: C,
        groupId: GROUP,
        createdAt: 1,
        deletedAt: 6,
        participants: [
          { userId: C, amount: 1820 },
          { userId: A, amount: -1820 },
        ],
      }),
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 2,
        deletedAt: 3,
        participants: [
          { userId: A, amount: 1820 },
          { userId: C, amount: -1820 },
        ],
      }),
      { ...settlement(A, C, 1820, 4), deletedAt: 5 },
      zeroShareTrigger(7),
    ];
    assert.notEqual(
      groupAmount(expenses, 'corrected', A, C),
      groupAmount(expenses, 'legacy', A, C),
    );
    const set = analyse(expenses).setOf(A, C);
    assert.equal(set?.verdict, 'skipped');
    assert.match(set?.reasons.join(' ') ?? '', /deleted-expense/);
    assert.deepEqual(set?.changes, []);
  });

  void it('skips a pair touched by an edited personal expense', () => {
    // Review repro: the personal expense was A->B when the settlement cleared the group, and
    // was later edited to A->C. Only the final version is stored.
    const expenses = [
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 1,
        participants: [
          { userId: A, amount: 1000 },
          { userId: B, amount: -1000 },
        ],
      }),
      pays(A, C, 500, 2, { edited: true, updatedAt: 4 }),
      settlement(B, A, 1500, 3),
      expense({
        paidBy: A,
        groupId: GROUP,
        createdAt: 5,
        participants: [
          { userId: A, amount: 0 },
          { userId: B, amount: 0 },
          { userId: D, amount: 0 },
        ],
      }),
    ];
    const { analyses } = analyse(expenses);
    assert.ok(analyses.every((a) => 'repair' !== a.verdict));
    const issues = getPairIssues(input(expenses, legacyRows(expenses)));
    assert.ok(issues.get(pairKey('USD', A, C))?.has('edited-expense'));
    // The settlement between A and B happened while the edited expense's earlier version
    // existed, so A-B is not trusted either.
    assert.ok(issues.get(pairKey('USD', A, B))?.has('settlement-during-other-edit'));
  });

  void it('treats an expense written again after creation as edited', () => {
    const expenses = [groupDebt(), { ...zeroShareTrigger(2), updatedAt: 2 + 60_000 }];
    const set = analyse(expenses).setOf(A, C);
    assert.equal(set?.verdict, 'skipped');
    assert.match(set?.reasons.join(' ') ?? '', /edited-expense/);
  });

  void it('skips other currencies of a pair with an edited expense', () => {
    const expenses = [
      groupDebt(),
      zeroShareTrigger(),
      pays(A, C, 100, 3, { currency: 'EUR', edited: true }),
    ];
    const set = analyse(expenses).setOf(A, C);
    assert.equal(set?.verdict, 'skipped');
    assert.match(set?.reasons.join(' ') ?? '', /edited-expense-other-currency/);
  });

  void it('skips a Splitwise import and any Balance the live expenses do not explain', () => {
    // Review repro: an imported offset plus an expense of a since-deleted group. The script
    // would have inferred the wrong offset.
    const expenses = [groupDebt(), zeroShareTrigger()];
    const rows = legacyRows(expenses);
    const imported = rows.balances.map((b) =>
      b.userId === A && b.friendId === C
        ? { ...b, amount: b.amount + 900, importedFromSplitwise: true }
        : b.userId === C && b.friendId === A
          ? { ...b, amount: b.amount - 900, importedFromSplitwise: true }
          : b,
    );
    const set = analyse(expenses, { balances: imported }).setOf(A, C);
    assert.equal(set?.verdict, 'skipped');
    assert.match(set?.reasons.join(' ') ?? '', /splitwise-import/);
    assert.match(set?.reasons.join(' ') ?? '', /balance-not-explained/);

    const unexplained = rows.balances.map((b) =>
      b.userId === A && b.friendId === C
        ? { ...b, amount: b.amount + 900 }
        : b.userId === C && b.friendId === A
          ? { ...b, amount: b.amount - 900 }
          : b,
    );
    const deletedGroup = analyse(expenses, { balances: unexplained }).setOf(A, C);
    assert.equal(deletedGroup?.verdict, 'skipped');
    assert.deepEqual(deletedGroup?.reasons, [
      'balance-not-explained:1',
      'legacy-balance-mismatch:1',
    ]);
  });

  void it('skips a pair with PR #2 settlement allocations', () => {
    const expenses = [groupDebt(), zeroShareTrigger()];
    const set = analyse(expenses, {
      allocations: [
        {
          settlementExpenseId: 's',
          groupId: GROUP,
          currency: 'USD',
          userId: A,
          friendId: C,
          amount: 1,
        },
      ],
    }).setOf(A, C);
    assert.equal(set?.verdict, 'skipped');
    assert.match(set?.reasons.join(' ') ?? '', /settlement-allocation/);
  });

  void it('does not repair a set the old rule cannot reproduce', () => {
    const expenses = [groupDebt(), zeroShareTrigger()];
    const rows = legacyRows(expenses);
    rows.groupBalances = rows.groupBalances.map((row) =>
      row.userId === A && row.friendId === C
        ? { ...row, amount: 7 }
        : row.userId === C && row.friendId === A
          ? { ...row, amount: -7 }
          : row,
    );
    const set = analyseSets(input(expenses, rows));
    const analysis = set.analyses.find((a) => a.setId === set.setOf.get(pairKey('USD', A, C)));
    assert.equal(analysis?.verdict, 'not-reproduced');
  });
});

void describe('findSettlementAnomalies', () => {
  void it('reports non-canonical settlements with the evidence, without a fix', () => {
    const zeroed = { ...settlement(A, B, 5000, 1), edited: true, updatedAt: 2 };
    zeroed.participants = [
      { userId: A, amount: 0 },
      { userId: B, amount: 0 },
    ];
    const later = pays(B, A, 300, 3);
    const [finding] = findSettlementAnomalies(
      [zeroed, later, settlement(A, B, 100, 4)],
      new Map([[zeroed.id, 5000]]),
    );
    assert.equal(finding?.reason, 'other-amount-zero');
    assert.equal(finding?.laterExpenses, 1);
    assert.equal(finding?.laterSettlements, 1);
    assert.equal(finding?.canonicalDelta, -5000);
  });
});
