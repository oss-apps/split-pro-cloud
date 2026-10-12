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

  void it('matches payers itself when repayments are missing or wrong, keeping every net', () => {
    const spec = {
      id: 3,
      users: [
        [1, 6000, 3334],
        [2, 4000, 3333],
        [3, 0, 3333],
      ] as [number, number, number][],
    };
    [[], [[3, 1, 9999]] as [number, number, number][]].forEach((repayments) => {
      const ledger = createLedger();
      parts({ ...spec, repayments }).forEach((p) => addExpense(ledger, p));
      assert.deepEqual(Object.fromEntries(ledger.nets), {
        'USD|1': 2666,
        'USD|2': 667,
        'USD|3': -3333,
      });
    });
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
      // One expense per person owed money, and the parts cost what the payers paid.
      assert.equal(converted.length, new Set(repayments.map(([, to]) => to)).size || 1);
    }
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
});
