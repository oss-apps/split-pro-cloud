import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addDebt,
  addExpense,
  buildImportPlan,
  convertExpense,
  createLedger,
  exportFileSchema,
  getNonGroupBalances,
  importItemRequestSchema,
  parseAmount,
  splitwiseExpenseSchema,
  splitwiseFriendSchema,
  toCategory,
} from '~/lib/splitwiseImport';

import { buildExport, expense, person } from './splitwiseFixtures';

const parse = (spec: Parameters<typeof expense>[0]) => splitwiseExpenseSchema.parse(expense(spec));

const parts = (spec: Parameters<typeof expense>[0]) => {
  const result = convertExpense(parse(spec));
  assert.ok('parts' in result, JSON.stringify(result));
  return result.parts;
};

void describe('parseAmount', () => {
  void it('reads Splitwise decimals exactly, in hundredths', () => {
    assert.equal(parseAmount('25.0'), 2500);
    assert.equal(parseAmount('4.5'), 450);
    assert.equal(parseAmount('4.49'), 449);
    assert.equal(parseAmount('-5.02'), -502);
    assert.equal(parseAmount('1000'), 100000);
    assert.equal(parseAmount('0.1'), 10);
    // Floats would get these wrong.
    assert.equal(parseAmount('1.15'), 115);
    assert.equal(parseAmount('8.95'), 895);
  });

  void it('rejects anything else', () => {
    ['', 'abc', '1.234', '1,5', '1e3', '0x10', '99999999999999.0', '--1'].forEach((value) =>
      assert.equal(parseAmount(value), null, value),
    );
  });
});

void describe('toCategory', () => {
  void it('maps English Splitwise categories that clearly match, otherwise the default', () => {
    assert.equal(toCategory('Dining out'), 'diningOut');
    assert.equal(toCategory('TV/Phone/Internet'), 'internet');
    assert.equal(toCategory('Heat/gas'), 'gas');
    assert.equal(toCategory('Insurance'), 'general');
    assert.equal(toCategory('Restaurants'), 'general');
    assert.equal(toCategory(undefined), 'general');
  });
});

void describe('convertExpense', () => {
  void it('keeps one expense for one payer, with zero shares kept', () => {
    assert.deepEqual(
      parts({
        id: 1,
        users: [
          [1, 1000, 0],
          [2, 0, 1000],
          [3, 0, 0],
        ],
      }).map((p) => [p.paidBy, p.amount, p.shares]),
      [
        [
          1,
          1000,
          [
            { userId: 1, amount: 1000 },
            { userId: 2, amount: -1000 },
            { userId: 3, amount: 0 },
          ],
        ],
      ],
    );
  });

  void it("follows Splitwise's repayments for several payers, even when another matching exists", () => {
    // A paid 100, B paid 50; C and D owe 75 each. Splitwise: C owes B 50 and A 25, D owes A 75.
    const result = parts({
      id: 2,
      description: 'Cabin',
      users: [
        [1, 10000, 0],
        [2, 5000, 0],
        [3, 0, 7500],
        [4, 0, 7500],
      ],
      repayments: [
        [3, 2, 5000],
        [3, 1, 2500],
        [4, 1, 7500],
      ],
    });
    assert.deepEqual(
      result.map((p) => ({ name: p.name, paidBy: p.paidBy, amount: p.amount, shares: p.shares })),
      [
        {
          name: 'Cabin (1 of 2, several payers)',
          paidBy: 1,
          amount: 10000,
          shares: [
            { userId: 1, amount: 10000 },
            { userId: 3, amount: -2500 },
            { userId: 4, amount: -7500 },
          ],
        },
        {
          name: 'Cabin (2 of 2, several payers)',
          paidBy: 2,
          amount: 5000,
          shares: [
            { userId: 2, amount: 5000 },
            { userId: 3, amount: -5000 },
          ],
        },
      ],
    );
  });

  void it('works out the debts itself only when one person paid', () => {
    const onePayer = {
      id: 3,
      users: [
        [1, 10000, 3334],
        [2, 0, 3333],
        [3, 0, 3333],
      ] as [number, number, number][],
    };
    [[], [[3, 1, 9999]] as [number, number, number][]].forEach((repayments) => {
      const ledger = createLedger();
      parts({ ...onePayer, repayments }).forEach((p) => addExpense(ledger, p));
      assert.deepEqual(Object.fromEntries([...ledger.pairs].filter(([, v]) => 0 !== v)), {
        'USD|1|2': 3333,
        'USD|1|3': 3333,
      });
    });

    // Two payers, even with a single person owed overall: missing or wrong repayments refuse.
    const twoPayers = {
      id: 4,
      users: [
        [1, 6000, 3334],
        [2, 4000, 3333],
        [3, 0, 3333],
      ] as [number, number, number][],
    };
    [[], [[3, 1, 9999]] as [number, number, number][]].forEach((repayments) => {
      const result = convertExpense(
        splitwiseExpenseSchema.parse(expense({ ...twoPayers, repayments })),
      );
      assert.ok('error' in result, JSON.stringify(repayments));
      assert.match(result.error, /several people paid and Splitwise didn't say who owes whom/);
    });
    assert.ok(
      'parts' in
        convertExpense(
          splitwiseExpenseSchema.parse(
            expense({
              ...twoPayers,
              repayments: [
                [3, 1, 2666],
                [3, 2, 667],
              ],
            }),
          ),
        ),
    );
  });

  void it("refuses a chain through a debtor who also paid, without repayments (Sol's MISSING_MULTI_PAYER_CHAIN)", () => {
    // A paid 20, owes 0. B paid 10, owes 20. C owes 10. Splitwise: C owes B 10, B owes A 20.
    // Only A is owed overall, but B owing A 10 and C owing A 10 would erase B and C's debt.
    const users: [number, number, number][] = [
      [1, 0, 0],
      [2, 2000, 0],
      [3, 1000, 2000],
      [4, 0, 1000],
    ];
    const withRepayments = parts({
      id: 9,
      users,
      repayments: [
        [4, 3, 1000],
        [3, 2, 2000],
      ],
    });
    const ledger = createLedger();
    withRepayments.forEach((p) => addExpense(ledger, p));
    assert.deepEqual(Object.fromEntries([...ledger.pairs].filter(([, v]) => 0 !== v)), {
      'USD|2|3': 2000,
      'USD|3|4': 1000,
    });
    const without = convertExpense(
      splitwiseExpenseSchema.parse({
        ...expense({
          id: 9,
          users,
          repayments: [
            [4, 3, 1000],
            [3, 2, 2000],
          ],
        }),
        repayments: [],
      }),
    );
    assert.ok('error' in without);
  });

  void it("refuses a zero-net cycle of payers without repayments (Sol's MISSING_MULTI_PAYER_CYCLE)", () => {
    // Everyone paid 10 and owes 10, so every net is 0, but Splitwise says A owes B, B owes C and
    // C owes A 10 each. Without repayments those debts would be erased.
    const users: [number, number, number][] = [
      [1, 0, 0],
      [2, 1000, 1000],
      [3, 1000, 1000],
      [4, 1000, 1000],
    ];
    const repayments: [number, number, number][] = [
      [2, 3, 1000],
      [3, 4, 1000],
      [4, 2, 1000],
    ];
    const ledger = createLedger();
    parts({ id: 10, users, repayments }).forEach((p) => addExpense(ledger, p));
    assert.deepEqual(Object.fromEntries([...ledger.pairs].filter(([, v]) => 0 !== v)), {
      'USD|2|3': -1000,
      'USD|3|4': -1000,
      'USD|2|4': 1000,
    });
    const without = convertExpense(
      splitwiseExpenseSchema.parse({ ...expense({ id: 10, users, repayments }), repayments: [] }),
    );
    assert.ok('error' in without);
  });

  void it("refuses rather than invent who owes whom when repayments are missing (Sol's case)", () => {
    // B and C paid 10 each; D and E owe 10 each. Splitwise says D owes C and E owes B. Without
    // repayments, D owing B and E owing C would fit the nets just as well.
    const users: [number, number, number][] = [
      [1, 0, 0],
      [2, 1000, 0],
      [3, 1000, 0],
      [4, 0, 1000],
      [5, 0, 1000],
    ];
    const withRepayments = parts({
      id: 8,
      users,
      repayments: [
        [4, 3, 1000],
        [5, 2, 1000],
      ],
    });
    const ledger = createLedger();
    withRepayments.forEach((p) => addExpense(ledger, p));
    assert.deepEqual(Object.fromEntries([...ledger.pairs].filter(([, v]) => 0 !== v)), {
      'USD|3|4': 1000,
      'USD|2|5': 1000,
    });

    [[], [[4, 2, 1000]] as [number, number, number][]].forEach((repayments) => {
      const result = convertExpense(
        splitwiseExpenseSchema.parse(expense({ id: 8, users, repayments })),
      );
      assert.ok('error' in result);
      assert.match(result.error, /didn't say who owes whom/);
    });
  });

  void it('refuses repayments to someone who paid less than they would receive', () => {
    // Nets fit, but the debt is routed through B, who paid nothing.
    const result = convertExpense(
      splitwiseExpenseSchema.parse(
        expense({
          id: 9,
          users: [
            [1, 1000, 0],
            [2, 0, 0],
            [3, 0, 1000],
          ],
          repayments: [
            [3, 2, 1000],
            [2, 1, 1000],
          ],
        }),
      ),
    );
    // A single person owes, so the debt is still clear: C owes A.
    assert.ok('parts' in result);
    assert.deepEqual(result.parts[0]!.shares, [
      { userId: 1, amount: 1000 },
      { userId: 3, amount: -1000 },
      { userId: 2, amount: 0 },
    ]);
  });

  void it('turns a payment into a settle up from the payer', () => {
    const [part, ...rest] = parts({
      id: 4,
      payment: true,
      users: [
        [2, 1234, 0],
        [1, 0, 1234],
      ],
    });
    assert.equal(rest.length, 0);
    assert.deepEqual(
      {
        settle: part!.isSettlement,
        paidBy: part!.paidBy,
        amount: part!.amount,
        shares: part!.shares,
      },
      {
        settle: true,
        paidBy: 2,
        amount: 1234,
        shares: [
          { userId: 2, amount: 1234 },
          { userId: 1, amount: -1234 },
        ],
      },
    );
  });

  void it('refuses unknown currencies, broken shares and bad dates', () => {
    const base = {
      id: 5,
      users: [
        [1, 1000, 500],
        [2, 0, 500],
      ] as [number, number, number][],
    };
    const error = (raw: object) => {
      const result = convertExpense(splitwiseExpenseSchema.parse(raw));
      assert.ok('error' in result);
      return result.error;
    };
    assert.match(error(expense({ ...base, currency: 'ABC' })), /currency "ABC"/);
    assert.match(error({ ...expense(base), cost: '10.01' }), /don't add up/);
    assert.match(error({ ...expense(base), date: 'yesterday' }), /date/);
    const tampered = expense(base);
    tampered.users[0]!.net_balance = '5.01';
    assert.match(error(tampered), /shares are not valid/);
  });

  void it('keeps every net and every pair exact for random uneven splits', () => {
    let seed = 42;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };

    for (let round = 0; round < 500; round++) {
      const count = 2 + random(6);
      const ids = Array.from({ length: count }, (_, i) => i + 1);
      const cost = 1 + random(1_000_000);
      const split = (total: number) => {
        const weights = ids.map(() => random(5));
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const amounts = weights.map((w) => Math.floor((total * w) / sum));
        amounts[random(count)] += total - amounts.reduce((a, b) => a + b, 0);
        return amounts;
      };
      const paid = split(cost);
      const owed = split(cost);
      // Splitwise-like repayments: debtors in reverse id order, greedily.
      const nets = ids.map((id, i) => [id, paid[i]! - owed[i]!] as [number, number]);
      const creditors = nets.filter(([, n]) => 0 < n).map(([id, n]) => [id, n]);
      const repayments: [number, number, number][] = [];
      nets
        .filter(([, n]) => 0 > n)
        .reverse()
        .forEach(([id, n]) => {
          let owes = -n;
          creditors.forEach((creditor) => {
            const amount = Math.min(owes, creditor[1]!);
            if (0 < amount) {
              repayments.push([id, creditor[0]!, amount]);
              creditor[1] -= amount;
              owes -= amount;
            }
          });
        });

      const spec = {
        id: round,
        users: ids.map((id, i) => [id, paid[i]!, owed[i]!] as [number, number, number]),
        repayments,
      };
      // Several payers with every net zero have no repayments, which can't be told apart from
      // missing ones (a cycle of debts would fit too), so they are refused.
      if (!repayments.length && 1 < paid.filter((amount) => 0 < amount).length) {
        assert.ok('error' in convertExpense(splitwiseExpenseSchema.parse(expense(spec))));
        continue;
      }
      const converted = parts(spec);
      const actual = createLedger();
      converted.forEach((p) => {
        addExpense(actual, p);
        assert.equal(
          p.shares.reduce((sum, share) => sum + share.amount, 0),
          0,
          'shares add up to zero',
        );
        assert.ok(p.amount >= p.shares.find((s) => s.userId === p.paidBy)!.amount);
      });
      const expected = createLedger();
      repayments.forEach(([from, to, amount]) => addDebt(expected, 'USD', from, to, amount));
      assert.deepEqual(
        Object.fromEntries([...actual.pairs].filter(([, v]) => 0 !== v)),
        Object.fromEntries([...expected.pairs].filter(([, v]) => 0 !== v)),
      );
      ids.forEach((id, i) =>
        assert.equal(actual.nets.get(`USD|${id}`) ?? 0, paid[i]! - owed[i]!, `net of ${id}`),
      );
      // One expense per person who paid, for what they paid, so the parts cost the whole amount.
      const payers = ids.filter((_, i) => 0 < paid[i]!);
      assert.deepEqual(
        converted.map((p) => [p.paidBy, p.amount]),
        payers.map((id) => [id, paid[ids.indexOf(id)]!]),
      );
      assert.equal(
        converted.reduce((sum, p) => sum + p.amount, 0),
        cost,
      );
      // Each person's own shares across the parts are what they owe in Splitwise.
      const owedInParts = new Map<number, number>();
      converted.forEach((p) =>
        p.shares.forEach((share) =>
          owedInParts.set(
            share.userId,
            (owedInParts.get(share.userId) ?? 0) +
              (share.userId === p.paidBy ? p.amount - share.amount : -share.amount),
          ),
        ),
      );
      ids.forEach((id, i) => assert.equal(owedInParts.get(id) ?? 0, owed[i]!, `owed by ${id}`));

      // Without repayments, it converts only when one person paid.
      const withoutRepayments = convertExpense(
        splitwiseExpenseSchema.parse({ ...expense(spec), repayments: [] }),
      );
      if (1 < payers.length) {
        assert.ok('error' in withoutRepayments, 'ambiguous without repayments');
      } else {
        assert.ok('parts' in withoutRepayments);
        assert.deepEqual(withoutRepayments.parts, converted);
      }
    }
  });

  void it("keeps everyone's spending when several people paid (Sol's case)", () => {
    // A paid 30 and owes 10, B paid 20 and owes 40, so B owes A 20.
    const result = parts({
      id: 6,
      description: 'Dinner',
      users: [
        [1, 3000, 1000],
        [2, 2000, 4000],
      ],
      repayments: [[2, 1, 2000]],
    });
    assert.deepEqual(
      result.map((p) => ({ paidBy: p.paidBy, amount: p.amount, shares: p.shares })),
      [
        {
          paidBy: 1,
          amount: 3000,
          shares: [
            { userId: 1, amount: 2000 },
            { userId: 2, amount: -2000 },
          ],
        },
        { paidBy: 2, amount: 2000, shares: [{ userId: 2, amount: 0 }] },
      ],
    );
    assert.equal(
      result.reduce((sum, p) => sum + p.amount, 0),
      5000,
    );
    const ledger = createLedger();
    result.forEach((p) => addExpense(ledger, p));
    assert.deepEqual(Object.fromEntries(ledger.pairs), { 'USD|1|2': 2000 });
  });

  void it('splits three uneven payers exactly, following repayments', () => {
    // Cost 100.01: A paid 50.01, B 30, C 20; they owe 33.34, 33.33, 33.34.
    // A is owed 16.67 (by C 13.34 and B 3.33), B paid 30 and owes 33.33, C owes 13.34.
    const result = parts({
      id: 7,
      users: [
        [1, 5001, 3334],
        [2, 3000, 3333],
        [3, 2000, 3334],
      ],
      repayments: [
        [3, 1, 1334],
        [2, 1, 333],
      ],
    });
    assert.deepEqual(
      result.map((p) => [p.paidBy, p.amount, p.shares]),
      [
        [
          1,
          5001,
          [
            { userId: 1, amount: 1667 },
            { userId: 2, amount: -333 },
            { userId: 3, amount: -1334 },
          ],
        ],
        [2, 3000, [{ userId: 2, amount: 0 }]],
        [3, 2000, [{ userId: 3, amount: 0 }]],
      ],
    );
  });
});

void describe('getNonGroupBalances', () => {
  const friend = (groups: object[] | null) =>
    splitwiseFriendSchema.parse({
      ...person(2, 'Bo', 'bo@example.com'),
      balance: [{ currency_code: 'USD', amount: '15.0' }],
      groups,
    });

  void it('uses group 0 when Splitwise lists it', () => {
    assert.deepEqual(
      getNonGroupBalances(
        friend([
          { group_id: 9, balance: [{ currency_code: 'USD', amount: '10.0' }] },
          { group_id: 0, balance: [{ currency_code: 'USD', amount: '5.0' }] },
        ]),
      ),
      [{ currency: 'USD', amount: 500 }],
    );
  });

  void it('otherwise takes the group balances off the overall balance', () => {
    assert.deepEqual(
      getNonGroupBalances(
        friend([{ group_id: 9, balance: [{ currency_code: 'USD', amount: '10.0' }] }]),
      ),
      [{ currency: 'USD', amount: 500 }],
    );
  });
});

void describe('buildImportPlan', () => {
  void it('splits a file into groups and linked friends, counting deleted and skipped expenses', () => {
    const [ada, bo, cy, di, ed] = [
      person(1, 'Ada', 'ada@example.com'),
      person(2, 'Bo', 'bo@example.com'),
      person(3, 'Cy', 'cy@example.com'),
      person(4, 'Di', 'di@example.com'),
      person(5, 'Ed', 'ed@example.com'),
    ];
    const file = buildExport({
      me: ada,
      people: [bo, cy, di, ed],
      groups: [{ id: 10, name: 'Flat', memberIds: [1, 2] }],
      expenses: [
        expense({
          id: 1,
          groupId: 10,
          users: [
            [1, 100, 50],
            [2, 0, 50],
          ],
        }),
        expense({
          id: 2,
          groupId: 10,
          deleted: true,
          users: [
            [1, 100, 50],
            [2, 0, 50],
          ],
        }),
        // Links Bo and Cy outside groups.
        expense({
          id: 3,
          users: [
            [1, 300, 100],
            [2, 0, 100],
            [3, 0, 100],
          ],
        }),
        expense({
          id: 4,
          users: [
            [1, 100, 50],
            [4, 0, 50],
          ],
        }),
        // Not yours, and in a group that isn't in the file.
        expense({
          id: 5,
          users: [
            [2, 100, 50],
            [5, 0, 50],
          ],
        }),
        expense({
          id: 6,
          groupId: 99,
          users: [
            [1, 100, 50],
            [2, 0, 50],
          ],
        }),
      ],
    });

    const plan = buildImportPlan(exportFileSchema.parse(file));
    assert.deepEqual(
      plan.items.map((item) => [item.key, item.label, item.expenseCount, item.deletedCount]),
      [
        ['group:10', 'Flat', 1, 1],
        ['friends:2,3', 'Bo, Cy', 1, 0],
        ['friends:4', 'Di', 1, 0],
      ],
    );
    assert.equal(plan.skippedExpenses, 2);
    assert.equal(plan.unreadable, 0);
  });

  void it("flags a group whose expenses couldn't be read", () => {
    const file = buildExport({
      me: person(1, 'Ada', 'ada@example.com'),
      people: [person(2, 'Bo', 'bo@example.com')],
      groups: [{ id: 10, name: 'Flat', memberIds: [1, 2] }],
      expenses: [
        expense({
          id: 1,
          groupId: 10,
          users: [
            [1, 100, 50],
            [2, 0, 50],
          ],
        }),
      ],
    });
    const plan = buildImportPlan(
      exportFileSchema.parse({ ...file, expenses: [...file.expenses, { id: 'x', group_id: 10 }] }),
    );
    assert.equal(plan.unreadable, 1);
    assert.match(plan.items[0]!.problem ?? '', /couldn't be read/);
  });

  void it('refuses a file that lists the same expense twice, before anything else', () => {
    const one = expense({
      id: 1,
      users: [
        [1, 200, 100],
        [2, 0, 100],
      ],
    });
    const file = buildExport({
      me: person(1, 'Ada', 'ada@example.com'),
      people: [person(2, 'Bo', 'bo@example.com')],
      groups: [],
      expenses: [one, one],
    });
    const parsed = exportFileSchema.safeParse(file);
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /same Splitwise expense more than once/);

    // The server checks each request again.
    const request = {
      version: 2,
      currentUser: file.currentUser,
      people: [],
      item: { kind: 'friends', friends: file.friends },
      expenses: [one, one],
    };
    assert.equal(importItemRequestSchema.safeParse(request).success, false);
    assert.equal(importItemRequestSchema.safeParse({ ...request, expenses: [one] }).success, true);
  });

  void it("lists a friend whose balance no expense explains, as something that can't be imported", () => {
    const ada = person(1, 'Ada', 'ada@example.com');
    const bo = person(2, 'Bo', 'bo@example.com');
    const file = buildExport({ me: ada, people: [bo], groups: [], expenses: [] });
    file.friends[0]!.balance = [{ currency_code: 'USD', amount: '10.0' }];
    const plan = buildImportPlan(exportFileSchema.parse(file));
    assert.deepEqual(
      plan.items.map((item) => [item.key, item.expenseCount, item.problem]),
      [
        [
          'friends:2',
          0,
          'Splitwise reports a balance outside groups, but the file has no expenses that explain it.',
        ],
      ],
    );
  });

  void it('flags groups that simplify debts', () => {
    const [ada, bo, cy] = [1, 2, 3].map((id) => person(id, `P${id}`, `p${id}@example.com`)) as [
      ReturnType<typeof person>,
      ReturnType<typeof person>,
      ReturnType<typeof person>,
    ];
    const plan = buildImportPlan(
      exportFileSchema.parse(
        buildExport({
          me: ada,
          people: [bo, cy],
          groups: [
            { id: 10, name: 'Simplified', memberIds: [1, 2, 3], simplify: true },
            { id: 11, name: 'Plain', memberIds: [1, 2, 3] },
          ],
          expenses: [],
        }),
      ),
    );
    assert.deepEqual(
      plan.items.map((item) => [item.label, item.simplified]),
      [
        ['Simplified', true],
        ['Plain', false],
      ],
    );
  });
});
