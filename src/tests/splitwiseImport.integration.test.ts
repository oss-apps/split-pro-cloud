import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExport, expense, person, type Person } from './splitwiseFixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** Who notifications were looked up for, without sending any. */
const notifiedUserIds: number[] = [];
/** Lets notifications sent after a save look up who gets them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ db }, { appRouter }, lib, { importSplitwiseItem }] = await Promise.all([
    import('~/server/db'),
    import('~/server/api/root'),
    import('~/lib/splitwiseImport'),
    import('~/server/api/services/splitwiseImport'),
  ]);

  db.pushNotification.findMany = (async (args: {
    where: { userId: number | { in: number[] } };
  }) => {
    const { userId } = args.where;
    notifiedUserIds.push(...('number' === typeof userId ? [userId] : userId.in));
    return [];
  }) as unknown as typeof db.pushNotification.findMany;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  // Splitwise ids are global, so each run uses its own range.
  const base = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const email = (name: string) => `${name.toLowerCase()}-${suffix}@example.com`;
  const sw = (name: string, offset: number, withEmail = true): Person =>
    person(base + offset, name, withEmail ? email(name) : null);

  const createUser = (name: string) =>
    db.user.create({ data: { email: email(name), name, currency: 'USD' } });

  const callerFor = (user: { id: number; name: string | null; email: string | null }) =>
    appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });

  /** Imports a file the way the page does: one request per group or set of friends. */
  const importFile = async (
    user: { id: number },
    file: unknown,
    only?: (key: string) => boolean,
  ) => {
    const plan = lib.buildImportPlan(lib.exportFileSchema.parse(JSON.parse(JSON.stringify(file))));
    const results: Record<string, Awaited<ReturnType<typeof importSplitwiseItem>>> = {};
    for (const item of plan.items.filter((i) => !only || only(i.key))) {
      results[item.key] = await importSplitwiseItem(
        user,
        lib.importItemRequestSchema.parse(JSON.parse(JSON.stringify(item.request))),
      );
    }
    return { plan, results };
  };

  const userByEmail = (name: string) =>
    db.user.findUniqueOrThrow({ where: { email: email(name) } });

  /** Balances as "currency user->friend amount" for rows involving these users, non-zero only. */
  const balances = async (userIds: number[]) =>
    (
      await db.balance.findMany({
        where: { userId: { in: userIds }, friendId: { in: userIds }, amount: { not: 0 } },
        orderBy: [{ currency: 'asc' }, { userId: 'asc' }, { friendId: 'asc' }],
      })
    ).map((b) => `${b.currency} ${b.userId}->${b.friendId} ${b.amount}`);

  const groupBalances = async (groupId: number) =>
    (
      await db.groupBalance.findMany({
        where: { groupId, amount: { not: 0 } },
        orderBy: [{ currency: 'asc' }, { userId: 'asc' }, { firendId: 'asc' }],
      })
    ).map((b) => `${b.currency} ${b.userId}->${b.firendId} ${b.amount}`);

  /** Rows that must not change when an import is refused. */
  const snapshot = async () => ({
    users: await db.user.count({ where: { email: { contains: suffix } } }),
    groups: await db.group.count({ where: { createdBy: { email: { contains: suffix } } } }),
    expenses: await db.expense.count({ where: { addedByUser: { email: { contains: suffix } } } }),
    balances: await db.balance.findMany({
      where: { user: { email: { contains: suffix } } },
      orderBy: [{ userId: 'asc' }, { friendId: 'asc' }, { currency: 'asc' }],
      select: { userId: true, friendId: true, currency: true, amount: true },
    }),
  });

  const cleanUp = () => db.user.deleteMany({ where: { email: { contains: suffix } } });

  return {
    db,
    lib,
    base,
    sw,
    email,
    createUser,
    callerFor,
    importFile,
    importSplitwiseItem,
    userByEmail,
    balances,
    groupBalances,
    snapshot,
    cleanUp,
  };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const withSetup = (fn: (t: Setup) => Promise<void>) => async () => {
  const t = await setup();
  try {
    await fn(t);
  } finally {
    await t.cleanUp();
  }
};

const imported = (result: unknown) => {
  assert.equal((result as { status: string }).status, 'imported', JSON.stringify(result));
  return result as {
    imported: number;
    alreadyImported: number;
    skippedDeleted: number;
    groupId: number;
  };
};

const refused = (result: unknown, pattern: RegExp) => {
  assert.equal((result as { status: string }).status, 'refused', JSON.stringify(result));
  const reasons = (result as { reasons: string[] }).reasons;
  assert.ok(
    reasons.some((reason) => pattern.test(reason)),
    `Expected a reason matching ${String(pattern)}, got ${JSON.stringify(reasons)}`,
  );
};

void test(
  'a group imports with exact cents: 3-way uneven split, several payers, 0-decimal currency, payment, deleted',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const gid = t.base + 100;
    const file = buildExport({
      me: ada,
      people: [bo, cy],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id, cy.id] }],
      expenses: [
        // 100.00 split three ways: 33.34 / 33.33 / 33.33, paid by Ada.
        expense({
          id: t.base + 1001,
          groupId: gid,
          description: 'Groceries',
          category: 'Groceries',
          users: [
            [ada.id, 10000, 3334],
            [bo.id, 0, 3333],
            [cy.id, 0, 3333],
          ],
        }),
        // Ada paid 60, Bo paid 40, split three ways. Splitwise: Cy owes Ada 26.66 and Bo 6.67.
        expense({
          id: t.base + 1002,
          groupId: gid,
          description: 'Dinner',
          category: 'Dining out',
          users: [
            [ada.id, 6000, 3334],
            [bo.id, 4000, 3333],
            [cy.id, 0, 3333],
          ],
          repayments: [
            [cy.id, ada.id, 2666],
            [cy.id, bo.id, 667],
          ],
        }),
        // 1000 yen, 334 / 333 / 333, paid by Bo.
        expense({
          id: t.base + 1003,
          groupId: gid,
          description: 'Ramen',
          currency: 'JPY',
          users: [
            [ada.id, 0, 33400],
            [bo.id, 100000, 33300],
            [cy.id, 0, 33300],
          ],
        }),
        // Bo pays Ada back 5.00.
        expense({
          id: t.base + 1004,
          groupId: gid,
          description: 'Payment',
          payment: true,
          users: [
            [bo.id, 500, 0],
            [ada.id, 0, 500],
          ],
        }),
        // Deleted in Splitwise, so skipped.
        expense({
          id: t.base + 1005,
          groupId: gid,
          description: 'Mistake',
          deleted: true,
          users: [
            [ada.id, 99900, 0],
            [bo.id, 0, 99900],
          ],
        }),
      ],
    });

    const { plan, results } = await t.importFile(me, file);
    const item = plan.items.find((i) => i.key === `group:${gid}`)!;
    assert.equal(item.expenseCount, 4);
    assert.equal(item.deletedCount, 1);
    const result = imported(results[`group:${gid}`]);
    assert.deepEqual(
      {
        imported: result.imported,
        alreadyImported: result.alreadyImported,
        skipped: result.skippedDeleted,
      },
      { imported: 4, alreadyImported: 0, skipped: 1 },
    );

    const boUser = await t.userByEmail('Bo');
    const cyUser = await t.userByEmail('Cy');
    const group = await t.db.group.findUniqueOrThrow({
      where: { splitwiseGroupId: String(gid) },
      include: { groupUsers: true },
    });
    assert.equal(group.id, result.groupId);
    assert.deepEqual(
      group.groupUsers.map((g) => g.userId).sort((a, b) => a - b),
      [me.id, boUser.id, cyUser.id].sort((a, b) => a - b),
    );

    const expenses = await t.db.expense.findMany({
      where: { groupId: group.id },
      include: { expenseParticipants: true },
      orderBy: [{ splitwiseExpenseId: 'asc' }, { splitwisePart: 'asc' }],
    });
    const shape = expenses.map((e) => ({
      sw: `${Number(e.splitwiseExpenseId) - t.base}:${e.splitwisePart}`,
      name: e.name,
      category: e.category,
      type: e.splitType,
      currency: e.currency,
      amount: e.amount,
      paidBy: e.paidBy,
      shares: Object.fromEntries(
        e.expenseParticipants
          .sort((a, b) => a.userId - b.userId)
          .map((p) => [
            p.userId === me.id ? 'ada' : p.userId === boUser.id ? 'bo' : 'cy',
            p.amount,
          ]),
      ),
    }));
    assert.deepEqual(shape, [
      {
        sw: '1001:0',
        name: 'Groceries',
        category: 'groceries',
        type: 'EXACT',
        currency: 'USD',
        amount: 10000,
        paidBy: me.id,
        shares: { ada: 6666, bo: -3333, cy: -3333 },
      },
      {
        sw: '1002:0',
        name: 'Dinner (1 of 2, several payers)',
        category: 'diningOut',
        type: 'EXACT',
        currency: 'USD',
        amount: 6000,
        paidBy: me.id,
        shares: { ada: 2666, cy: -2666 },
      },
      {
        sw: '1002:1',
        name: 'Dinner (2 of 2, several payers)',
        category: 'diningOut',
        type: 'EXACT',
        currency: 'USD',
        amount: 4000,
        paidBy: boUser.id,
        shares: { bo: 667, cy: -667 },
      },
      {
        sw: '1003:0',
        name: 'Ramen',
        category: 'general',
        type: 'EXACT',
        currency: 'JPY',
        amount: 100000,
        paidBy: boUser.id,
        shares: { ada: -33400, bo: 66700, cy: -33300 },
      },
      {
        sw: '1004:0',
        name: 'Payment',
        category: 'general',
        type: 'SETTLEMENT',
        currency: 'USD',
        amount: 500,
        paidBy: boUser.id,
        shares: { ada: -500, bo: 500 },
      },
    ]);

    // Ada: +33.33 +33.33 (groceries) +26.66 (dinner) -5.00 (payment) from Bo/Cy; owes Bo 334 yen.
    assert.deepEqual(await t.groupBalances(group.id), [
      `JPY ${me.id}->${boUser.id} -33400`,
      `JPY ${boUser.id}->${me.id} 33400`,
      `JPY ${boUser.id}->${cyUser.id} 33300`,
      `JPY ${cyUser.id}->${boUser.id} -33300`,
      `USD ${me.id}->${boUser.id} 2833`,
      `USD ${me.id}->${cyUser.id} 5999`,
      `USD ${boUser.id}->${me.id} -2833`,
      `USD ${boUser.id}->${cyUser.id} 667`,
      `USD ${cyUser.id}->${me.id} -5999`,
      `USD ${cyUser.id}->${boUser.id} -667`,
    ]);
    assert.deepEqual(
      await t.balances([me.id, boUser.id, cyUser.id]),
      await t.groupBalances(group.id),
    );
    assert.equal(group.defaultCurrency, 'USD');
    await settle();
    assert.deepEqual(notifiedUserIds, [], 'no notifications for imported expenses');
  }),
);

void test(
  'expenses outside groups: friends linked by a 3-person expense import together, payments stay outside groups',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const di = t.sw('Di', 4);
    const gid = t.base + 100;
    const file = buildExport({
      me: ada,
      people: [bo, cy, di],
      groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, bo.id] }],
      nonGroupEntry: true,
      expenses: [
        expense({
          id: t.base + 2001,
          groupId: gid,
          users: [
            [ada.id, 2000, 1000],
            [bo.id, 0, 1000],
          ],
        }),
        // Ada, Bo and Cy outside a group: Bo paid 90.
        expense({
          id: t.base + 2002,
          description: 'Concert',
          category: 'Music',
          users: [
            [ada.id, 0, 3000],
            [bo.id, 9000, 3000],
            [cy.id, 0, 3000],
          ],
        }),
        // Ada pays Bo 30 outside the group.
        expense({
          id: t.base + 2003,
          description: 'Payment',
          payment: true,
          users: [
            [ada.id, 3000, 0],
            [bo.id, 0, 3000],
          ],
        }),
        // Di and Ada only, in euros.
        expense({
          id: t.base + 2004,
          currency: 'EUR',
          users: [
            [ada.id, 1250, 625],
            [di.id, 0, 625],
          ],
        }),
      ],
    });

    const { plan, results } = await t.importFile(me, file);
    const keys = plan.items.map((i) => i.key).sort();
    assert.deepEqual(
      keys,
      [`friends:${bo.id},${cy.id}`, `friends:${di.id}`, `group:${gid}`].sort(),
    );
    Object.values(results).forEach(imported);

    const [boUser, cyUser, diUser] = await Promise.all(['Bo', 'Cy', 'Di'].map(t.userByEmail));
    const concert = await t.db.expense.findFirstOrThrow({
      where: { splitwiseExpenseId: String(t.base + 2002) },
      include: { expenseParticipants: true },
    });
    assert.equal(concert.groupId, null);
    assert.equal(concert.category, 'music');
    assert.equal(concert.expenseParticipants.length, 3);

    const payment = await t.db.expense.findFirstOrThrow({
      where: { splitwiseExpenseId: String(t.base + 2003) },
      include: { settlementAllocations: true },
    });
    assert.equal(payment.splitType, 'SETTLEMENT');
    assert.equal(payment.groupId, null);
    assert.equal(payment.paidBy, me.id);
    // Splitwise's payment outside groups doesn't touch the group balance.
    assert.equal(payment.settlementAllocationVersion, null);
    assert.deepEqual(payment.settlementAllocations, []);

    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    assert.deepEqual(await t.groupBalances(group.id), [
      `USD ${me.id}->${boUser!.id} 1000`,
      `USD ${boUser!.id}->${me.id} -1000`,
    ]);
    // Overall: Bo owes 10 in the group; Ada owes Bo 30 for the concert and paid 30.
    assert.deepEqual(await t.balances([me.id, boUser!.id, cyUser!.id, diUser!.id]), [
      `EUR ${me.id}->${diUser!.id} 625`,
      `EUR ${diUser!.id}->${me.id} -625`,
      `USD ${me.id}->${boUser!.id} 1000`,
      `USD ${boUser!.id}->${me.id} -1000`,
      `USD ${boUser!.id}->${cyUser!.id} 3000`,
      `USD ${cyUser!.id}->${boUser!.id} -3000`,
    ]);
    const friendships = await t.db.friendship.findMany({ where: { userId: me.id } });
    assert.deepEqual(
      friendships.map((f) => f.friendId).sort((a, b) => a - b),
      [boUser!.id, cyUser!.id, diUser!.id].sort((a, b) => a - b),
    );
    await settle();
    assert.deepEqual(notifiedUserIds, []);
  }),
);

void test(
  "a group whose expenses don't add up to Splitwise's balances is refused and nothing is written",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: t.base + 3001,
          groupId: gid,
          users: [
            [ada.id, 5000, 2500],
            [bo.id, 0, 2500],
          ],
        }),
      ],
    });
    // Splitwise says 25.01, the expense says 25.00.
    const group = file.groups.find((g) => g.id === gid)!;
    group.members[0]!.balance = [{ currency_code: 'USD', amount: '25.01' }];
    group.members[1]!.balance = [{ currency_code: 'USD', amount: '-25.01' }];

    const before = await t.snapshot();
    const { results } = await t.importFile(me, file, (key) => key.startsWith('group:'));
    refused(results[`group:${gid}`], /don't add up/);
    refused(
      results[`group:${gid}`],
      /Ada owed USD 25.01, the expenses add up to you owed USD 25.00|you owed USD 25.01/,
    );
    assert.deepEqual(await t.snapshot(), before);
    assert.equal(await t.db.group.findUnique({ where: { splitwiseGroupId: String(gid) } }), null);
    assert.equal(
      await t.db.user.findUnique({ where: { email: t.email('Bo') } }),
      null,
      'nobody is created for a refused group',
    );

    // A pair that disagrees with original_debts is refused too, even when nets agree.
    const fixed = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses: file.expenses,
    });
    fixed.groups.find((g) => g.id === gid)!.original_debts = [];
    const second = await t.importFile(me, fixed, (key) => key.startsWith('group:'));
    refused(
      second.results[`group:${gid}`],
      /Splitwise says you and Bo are settled|Bo and you are settled/,
    );
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  'importing the same file again adds nothing, and resumes a partial import',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const expenses = Array.from({ length: 30 }, (_, index) =>
      expense({
        id: t.base + 4000 + index,
        groupId: index % 2 ? gid : null,
        users: [
          [ada.id, 1000 + index, 500],
          [bo.id, 0, 500 + index],
        ],
      }),
    );
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses,
    });

    const first = await t.importFile(me, file);
    Object.values(first.results).forEach(imported);
    const boUser = await t.userByEmail('Bo');
    const after = await t.snapshot();
    const balancesAfter = await t.balances([me.id, boUser.id]);

    const second = await t.importFile(me, file);
    Object.values(second.results).forEach((result) => {
      const r = imported(result);
      assert.equal(r.imported, 0);
      assert.equal(r.alreadyImported, 15);
    });
    assert.deepEqual(await t.snapshot(), after);
    assert.deepEqual(await t.balances([me.id, boUser.id]), balancesAfter);

    // An interrupted import (some expenses saved) is completed by importing again.
    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    const groupExpenses = await t.db.expense.findMany({
      where: { groupId: group.id },
      include: { expenseParticipants: true },
      orderBy: { splitwiseExpenseId: 'asc' },
    });
    const { deleteExpense } = await import('~/server/api/services/splitService');
    // Remove the last 5 completely, as if the import had stopped before them.
    for (const e of groupExpenses.slice(10)) {
      await deleteExpense(e.id, me.id);
      await t.db.expense.delete({ where: { id: e.id } });
    }
    // Deleting sends notifications after the save; let them run before checking imports send none.
    await new Promise((resolve) => setTimeout(resolve, 200));
    notifiedUserIds.length = 0;
    const third = await t.importFile(me, file, (key) => key.startsWith('group:'));
    const r = imported(third.results[`group:${gid}`]);
    assert.equal(r.imported, 5);
    assert.equal(r.alreadyImported, 10);
    assert.deepEqual(await t.balances([me.id, boUser.id]), balancesAfter);
    await settle();
    assert.deepEqual(notifiedUserIds, []);
  }),
);

void test(
  'a balance imported without history is never counted twice',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const gid = t.base + 100;
    const file = buildExport({
      me: ada,
      people: [bo, cy],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: t.base + 5001,
          groupId: gid,
          users: [
            [ada.id, 4000, 2000],
            [bo.id, 0, 2000],
          ],
        }),
        expense({
          id: t.base + 5002,
          users: [
            [ada.id, 1000, 500],
            [cy.id, 0, 500],
          ],
        }),
      ],
    });

    // The old importer, as the page sends it: Bo's whole balance and the group without balances.
    const oldFriend = (f: (typeof file.friends)[number]) => ({
      id: f.id,
      first_name: f.first_name,
      last_name: f.last_name,
      email: f.email!,
      balance: f.balance,
      picture: { small: '', medium: '', large: '' },
    });
    const boFriend = file.friends.find((f) => f.id === bo.id)!;
    await t.callerFor(me).user.importUsersFromSplitWise({
      usersWithBalance: [oldFriend(boFriend)],
      groups: [
        {
          id: gid,
          name: 'Flat',
          members: [ada, bo].map((p) => ({
            ...oldFriend({ ...boFriend, ...p }),
            balance: [],
          })),
        },
      ],
    });
    const boUser = await t.userByEmail('Bo');
    const oldBalances = await t.balances([me.id, boUser.id]);
    assert.deepEqual(oldBalances, [
      `USD ${me.id}->${boUser.id} 2000`,
      `USD ${boUser.id}->${me.id} -2000`,
    ]);

    const before = await t.snapshot();
    const { results } = await t.importFile(me, file);
    refused(
      results[`group:${gid}`],
      /between you and Bo was already imported from Splitwise without history/,
    );
    // Cy had no balance-only import, so their history comes in.
    imported(results[`friends:${cy.id}`]);
    assert.deepEqual(await t.balances([me.id, boUser.id]), oldBalances);
    assert.equal(
      await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 5001) } }),
      0,
    );
    assert.notDeepEqual(await t.snapshot(), before);

    // The other way around: with history imported, the old importer skips that friend.
    const cyUser = await t.userByEmail('Cy');
    const cyBalances = await t.balances([me.id, cyUser.id]);
    const cyFriend = file.friends.find((f) => f.id === cy.id)!;
    const old = await t.callerFor(me).user.importUsersFromSplitWise({
      usersWithBalance: [oldFriend(cyFriend)],
      groups: [],
    });
    assert.deepEqual(old, { skippedFriends: ['Cy'] });
    assert.deepEqual(await t.balances([me.id, cyUser.id]), cyBalances);
  }),
);

void test(
  'refuses unsupported currencies, people without an email, outsiders and groups you are not in',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const noEmail = t.sw('Ed', 5, false);
    const outsider = t.sw('Flo', 6);
    const g1 = t.base + 101;
    const g2 = t.base + 102;
    const g3 = t.base + 103;
    const g4 = t.base + 104;
    const file = buildExport({
      me: ada,
      people: [bo, noEmail],
      groups: [
        { id: g1, name: 'Odd currency', memberIds: [ada.id, bo.id] },
        { id: g2, name: 'No email', memberIds: [ada.id, noEmail.id] },
        { id: g3, name: 'Someone left', memberIds: [ada.id, bo.id] },
        { id: g4, name: 'Not mine', memberIds: [bo.id] },
      ],
      expenses: [
        expense({
          id: t.base + 6001,
          groupId: g1,
          currency: 'XYZ',
          users: [
            [ada.id, 1000, 500],
            [bo.id, 0, 500],
          ],
        }),
        expense({
          id: t.base + 6002,
          groupId: g2,
          users: [
            [ada.id, 1000, 500],
            [noEmail.id, 0, 500],
          ],
        }),
        // Flo is in the expense but not in the group or your friends.
        expense({
          id: t.base + 6003,
          groupId: g3,
          users: [
            [ada.id, 1000, 0],
            [bo.id, 0, 500],
            [outsider.id, 0, 500],
          ],
        }),
        expense({
          id: t.base + 6004,
          groupId: g4,
          users: [
            [bo.id, 1000, 0],
            [outsider.id, 0, 1000],
          ],
        }),
      ],
    });

    const before = await t.snapshot();
    const { results } = await t.importFile(me, file, (key) => key.startsWith('group:'));
    refused(results[`group:${g1}`], /doesn't support the currency "XYZ"/);
    refused(results[`group:${g2}`], /Ed has no email address/);
    refused(results[`group:${g3}`], /no longer in the group and isn't one of your friends/);
    refused(results[`group:${g4}`], /aren't a member of this group/);
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  "authorization: someone else's group, expenses outside groups that don't include you, crafted requests",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const gid = t.base + 100;
    const file = buildExport({
      me: bo,
      people: [ada, cy],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id, cy.id] }],
      expenses: [
        expense({
          id: t.base + 7001,
          groupId: gid,
          users: [
            [bo.id, 3000, 1000],
            [ada.id, 0, 1000],
            [cy.id, 0, 1000],
          ],
        }),
      ],
    });

    // Bo imports the group first. Cy, not a SplitPro member of it, can't add to it.
    const boUser = await t.createUser('Bo');
    imported((await t.importFile(boUser, file)).results[`group:${gid}`]);
    const cyUser = await t.userByEmail('Cy');
    const cyFile = buildExport({
      me: cy,
      people: [ada, bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id, cy.id] }],
      expenses: file.expenses,
    });
    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    await t.db.groupUser.delete({
      where: { groupId_userId: { groupId: group.id, userId: cyUser.id } },
    });
    refused(
      (await t.importFile(cyUser, cyFile)).results[`group:${gid}`],
      /already imported into SplitPro by someone else/,
    );

    // A member importing the same group again adds nothing.
    await t.db.groupUser.create({ data: { groupId: group.id, userId: cyUser.id } });
    const again = imported((await t.importFile(cyUser, cyFile)).results[`group:${gid}`]);
    assert.equal(again.imported, 0);
    assert.equal(again.alreadyImported, 1);
    assert.equal(await t.db.expense.count({ where: { groupId: group.id } }), 1);

    // A crafted request: an expense outside groups between two other people.
    const adaUser = await t.userByEmail('Ada');
    const request = {
      version: 2 as const,
      currentUser: cy,
      people: [],
      item: {
        kind: 'friends' as const,
        friends: [ada, bo].map((p) => ({ ...p, balance: [], groups: [] })),
      },
      expenses: [
        expense({
          id: t.base + 7002,
          users: [
            [ada.id, 1000, 0],
            [bo.id, 0, 1000],
          ],
        }),
      ],
    };
    refused(
      await t.importSplitwiseItem(cyUser, t.lib.importItemRequestSchema.parse(request)),
      /doesn't include you/,
    );
    // Or an expense that claims a group while being imported with friends.
    refused(
      await t.importSplitwiseItem(
        cyUser,
        t.lib.importItemRequestSchema.parse({
          ...request,
          expenses: [{ ...request.expenses[0]!, group_id: gid }],
        }),
      ),
      /belongs to a group/,
    );
    assert.equal(
      await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 7002) } }),
      0,
    );
    assert.ok(adaUser);

    // The request schema caps sizes.
    assert.equal(
      t.lib.importItemRequestSchema.safeParse({
        ...request,
        expenses: Array.from(
          { length: t.lib.MAX_EXPENSES_PER_REQUEST + 1 },
          () => request.expenses[0],
        ),
      }).success,
      false,
    );
    assert.equal(
      t.lib.importItemRequestSchema.safeParse({
        ...request,
        expenses: [{ ...request.expenses[0]!, description: 'x'.repeat(1_001) }],
      }).success,
      false,
    );
  }),
);

void test(
  'an already-imported expense deleted in Splitwise later is pointed out, not silently kept',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const groups = [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }];
    const spec = {
      id: t.base + 8001,
      groupId: gid,
      description: 'Rent',
      users: [
        [ada.id, 2000, 1000],
        [bo.id, 0, 1000],
      ] as [number, number, number][],
    };
    imported(
      (
        await t.importFile(
          me,
          buildExport({ me: ada, people: [bo], groups, expenses: [expense(spec)] }),
        )
      ).results[`group:${gid}`],
    );

    const later = buildExport({
      me: ada,
      people: [bo],
      groups,
      expenses: [expense({ ...spec, deleted: true })],
    });
    const { results } = await t.importFile(me, later, (key) => key.startsWith('group:'));
    refused(results[`group:${gid}`], /"Rent" \(2024-05-01\) changed in Splitwise or SplitPro/);
  }),
);

void test(
  'an old file without expenses still imports balances as before',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const result = await t.callerFor(me).user.importUsersFromSplitWise({
      usersWithBalance: [
        {
          ...bo,
          email: bo.email!,
          balance: [
            { currency_code: 'USD', amount: '12.5' },
            { currency_code: 'EUR', amount: '-3.0' },
          ],
          picture: { small: '', medium: '', large: '' },
        },
      ],
      groups: [
        {
          id: gid,
          name: 'Old flat',
          members: [
            {
              id: bo.id,
              first_name: 'Bo',
              last_name: null,
              email: bo.email!,
              balance: [],
              picture: { small: '', medium: '', large: '' },
            },
          ],
        },
      ],
    });
    assert.deepEqual(result, { skippedFriends: [] });
    const boUser = await t.userByEmail('Bo');
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `EUR ${me.id}->${boUser.id} -300`,
      `EUR ${boUser.id}->${me.id} 300`,
      `USD ${me.id}->${boUser.id} 1250`,
      `USD ${boUser.id}->${me.id} -1250`,
    ]);
    const rows = await t.db.balance.findMany({ where: { userId: me.id, friendId: boUser.id } });
    assert.ok(rows.every((row) => row.importedFromSplitwise));
    const group = await t.db.group.findUniqueOrThrow({
      where: { splitwiseGroupId: String(gid) },
      include: { groupUsers: true },
    });
    assert.equal(group.name, 'Old flat');
    assert.deepEqual(
      group.groupUsers.map((g) => g.userId),
      [boUser.id],
    );
  }),
);

void test(
  'the import endpoint needs a signed-in user, JSON and a valid, bounded body',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    process.env.NEXTAUTH_SECRET ??= 'test-secret';
    const { Readable } = await import('node:stream');
    const { default: handler } = await import('~/pages/api/import-splitwise');
    const me = await t.createUser('Ada');
    const sessionToken = `session-${t.base}`;
    await t.db.session.create({
      data: { sessionToken, userId: me.id, expires: new Date(Date.now() + 60_000) },
    });

    const call = async ({
      method = 'POST',
      contentType = 'application/json',
      body = '{}',
      signedIn = true,
    }: {
      method?: string;
      contentType?: string;
      body?: string | Buffer;
      signedIn?: boolean;
    }) => {
      const cookie = signedIn ? `next-auth.session-token=${sessionToken}` : '';
      const req = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        headers: { 'content-type': contentType, cookie },
        cookies: signedIn ? { 'next-auth.session-token': sessionToken } : {},
        query: {},
      });
      const res = {
        statusCode: 0,
        body: undefined as unknown,
        headers: {} as Record<string, unknown>,
        setHeader(name: string, value: unknown) {
          this.headers[name] = value;
          return this;
        },
        getHeader(name: string) {
          return this.headers[name];
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(value: unknown) {
          this.body = value;
          return this;
        },
        end() {
          return this;
        },
      };
      await handler(req as never, res as never);
      return { status: res.statusCode, body: res.body };
    };

    assert.equal((await call({ method: 'GET' })).status, 405);
    assert.equal((await call({ contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ signedIn: false })).status, 401);
    assert.equal((await call({ body: '{"version":1}' })).status, 400);
    assert.equal(
      (await call({ body: Buffer.alloc(t.lib.MAX_IMPORT_BODY_BYTES + 1, 32) })).status,
      413,
    );

    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: t.base + 9001,
          groupId: gid,
          users: [
            [ada.id, 1000, 500],
            [bo.id, 0, 500],
          ],
        }),
      ],
    });
    const plan = t.lib.buildImportPlan(
      t.lib.exportFileSchema.parse(JSON.parse(JSON.stringify(file))),
    );
    const response = await call({ body: JSON.stringify(plan.items[0]!.request) });
    assert.equal(response.status, 200);
    imported(response.body);
    assert.equal(
      await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 9001) } }),
      1,
    );
  }),
);

void test(
  'two members importing the same group at the same time save each expense once',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { TRPCError } = await import('@trpc/server');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const gid = t.base + 100;
    const groups = [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id, cy.id] }];
    const expenses = Array.from({ length: 600 }, (_, index) =>
      expense({
        id: t.base + 10_000 + index,
        groupId: gid,
        users: [
          [[ada, bo, cy][index % 3]!.id, 3000 + index, 1000 + index],
          [[ada, bo, cy][(index + 1) % 3]!.id, 0, 1000],
          [[ada, bo, cy][(index + 2) % 3]!.id, 0, 1000],
        ],
      }),
    );
    const boUser = await t.createUser('Bo');
    const cyUser = await t.createUser('Cy');
    const fileFor = (me: Person, others: Person[], list: typeof expenses) =>
      buildExport({ me, people: others, groups, expenses: list });

    // The group exists with everyone in it, from a first import of one expense.
    imported(
      (await t.importFile(boUser, fileFor(bo, [ada, cy], expenses.slice(0, 1)))).results[
        `group:${gid}`
      ],
    );

    const importWithRetry = async (user: { id: number }, file: unknown) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return (await t.importFile(user, file)).results[`group:${gid}`];
        } catch (error) {
          // "Someone else updated these balances at the same time": the user tries again.
          if (!(error instanceof TRPCError) || 'CONFLICT' !== error.code || 3 <= attempt) {
            throw error;
          }
        }
      }
    };
    const [fromBo, fromCy] = await Promise.all([
      importWithRetry(boUser, fileFor(bo, [ada, cy], expenses)),
      importWithRetry(cyUser, fileFor(cy, [ada, bo], expenses)),
    ]);
    const added = imported(fromBo).imported + imported(fromCy).imported;
    assert.equal(added, 599);

    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    assert.equal(await t.db.expense.count({ where: { groupId: group.id } }), 600);
    // The group's balances are Splitwise's.
    const file = fileFor(bo, [ada, cy], expenses);
    const adaUser = await t.userByEmail('Ada');
    const ids = new Map([
      [ada.id, adaUser.id],
      [bo.id, boUser.id],
      [cy.id, cyUser.id],
    ]);
    const nets = await t.db.groupBalance.groupBy({
      by: ['userId', 'currency'],
      where: { groupId: group.id },
      _sum: { amount: true },
    });
    file.groups
      .find((g) => g.id === gid)!
      .members.forEach((member) => {
        const net = nets.find((n) => n.userId === ids.get(member.id));
        assert.equal(
          net?._sum.amount ?? 0,
          Math.round(Number(member.balance[0]?.amount ?? 0) * 100),
        );
      });
  }),
);
