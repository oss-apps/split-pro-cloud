import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getOwnTestDatabase } from './ownDatabase';
import { buildExport, expense, person, type Person } from './splitwiseFixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** Who notifications were looked up for, without sending any. */
const notifiedUserIds: number[] = [];
/** Lets notifications sent after a save look up who gets them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = await getOwnTestDatabase(databaseUrl!, 'swimport');
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
    refused(
      results[`group:${gid}`],
      /"Rent" \(2024-05-01\) was deleted in Splitwise after it was imported/,
    );
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
    await t.db.friendship.createMany({
      data: [
        { userId: boUser.id, friendId: cyUser.id },
        { userId: cyUser.id, friendId: boUser.id },
      ],
    });
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

void test(
  'a batch that keeps conflicting with other writes is saved in smaller parts, each expense once',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { Prisma } = await import('@prisma/client');
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 100;
    const expenses = Array.from({ length: 5 }, (_, index) =>
      expense({
        id: t.base + 7000 + index,
        groupId: gid,
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

    // Any transaction saving more than one expense fails like a serialization conflict would.
    let conflicts = 0;
    const conflictOnBatches = <T extends object>(tx: T): T =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if ('expense' !== prop) {
            return value;
          }
          const delegate = value as { createManyAndReturn: (args: { data: unknown[] }) => unknown };
          return new Proxy(delegate, {
            get(model, name) {
              if ('createManyAndReturn' !== name) {
                return Reflect.get(model, name) as unknown;
              }
              return (args: { data: unknown[] }) => {
                if (1 < args.data.length) {
                  conflicts++;
                  throw new Prisma.PrismaClientKnownRequestError('write conflict', {
                    code: 'P2034',
                    clientVersion: 'test',
                  });
                }
                return model.createManyAndReturn(args);
              };
            },
          });
        },
      });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with `t.db` below
    const original = t.db.$transaction;
    t.db.$transaction = ((operation: unknown, options: unknown) =>
      'function' === typeof operation
        ? original.call(
            t.db,
            (tx: object) => (operation as (tx: object) => Promise<unknown>)(conflictOnBatches(tx)),
            options as never,
          )
        : original.call(t.db, operation as never, options as never)) as typeof original;

    try {
      const { results } = await t.importFile(me, file, (key) => key.startsWith('group:'));
      const r = imported(results[`group:${gid}`]);
      assert.equal(r.imported, 5);
      assert.equal(r.alreadyImported, 0);
    } finally {
      t.db.$transaction = original;
    }

    assert.ok(0 < conflicts, 'the batch conflicted');
    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    assert.equal(await t.db.expense.count({ where: { groupId: group.id } }), 5);
    const boUser = await t.userByEmail('Bo');
    // Bo owes 5.00 + 5.01 + 5.02 + 5.03 + 5.04.
    assert.deepEqual(await t.groupBalances(group.id), [
      `USD ${me.id}->${boUser.id} 2510`,
      `USD ${boUser.id}->${me.id} -2510`,
    ]);
  }),
);

/** The request the page would send for one group or set of friends. */
const requestFor = (t: Setup, file: unknown, key: string) =>
  t.lib.importItemRequestSchema.parse(
    JSON.parse(
      JSON.stringify(
        t.lib.buildImportPlan(t.lib.exportFileSchema.parse(file)).items.find((i) => i.key === key)!
          .request,
      ),
    ),
  );

/** The old importer's input for one friend from an exporter file. */
const oldFriendOf = (friend: {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
  balance: { currency_code: string; amount: string }[];
}) => ({
  id: friend.id,
  first_name: friend.first_name,
  last_name: friend.last_name,
  email: friend.email!,
  balance: friend.balance,
  picture: { small: '', medium: '', large: '' },
});

type Transaction = (operation: unknown, options?: unknown) => Promise<unknown>;

/**
 * Replaces `db.$transaction` for interactive transactions until restored. `around` gets each one
 * with its number (from 1) and the original call.
 */
const hookTransactions = (
  t: Setup,
  around: (
    n: number,
    run: () => Promise<unknown>,
    operation: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
) => {
  const original = t.db.$transaction.bind(t.db) as Transaction;
  let count = 0;
  let active = true;
  (t.db as unknown as { $transaction: Transaction }).$transaction = (operation, options) => {
    if (!active || 'function' !== typeof operation) {
      return original(operation, options);
    }
    const op = operation as (tx: unknown) => Promise<unknown>;
    return around(++count, () => original(op, options), op);
  };
  return {
    original,
    restore: () => {
      active = false;
      (t.db as unknown as { $transaction: Transaction }).$transaction = original;
    },
  };
};

const twoPeopleFile = (t: Setup, cents = 1000) => {
  const ada = t.sw('Ada', 1);
  const bo = t.sw('Bo', 2);
  const file = buildExport({
    me: ada,
    people: [bo],
    groups: [],
    expenses: [
      expense({
        id: t.base + 9001,
        users: [
          [ada.id, 2 * cents, cents],
          [bo.id, 0, cents],
        ],
      }),
    ],
  });
  return { ada, bo, file, key: `friends:${bo.id}` };
};

void test(
  'P1-a: a balance-only import finishing after the history checks makes the history import refuse',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { importUserBalanceFromSplitWise } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const { file, key } = twoPeopleFile(t);
    const request = requestFor(t, file, key);

    // The old import runs after every check, just before anything is written.
    const hook = hookTransactions(t, async (n, run) => {
      if (1 === n) {
        hook.restore();
        await importUserBalanceFromSplitWise(me.id, [oldFriendOf(file.friends[0]!)]);
      }
      return run();
    });
    let result;
    try {
      result = await t.importSplitwiseItem(me, request);
    } finally {
      hook.restore();
    }

    refused(result, /already imported from Splitwise without history/);
    // The balance is counted once, from the balance-only import, and no expense was saved.
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `USD ${me.id}->${boUser.id} 1000`,
      `USD ${boUser.id}->${me.id} -1000`,
    ]);
    assert.equal(await t.db.expense.count({ where: { addedBy: me.id } }), 0);
  }),
);

void test(
  'P1-a: a balance-only import while the history import is saving waits, then skips the pair',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { importUserBalanceFromSplitWise } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const { file, key } = twoPeopleFile(t);
    const request = requestFor(t, file, key);

    // The old import starts while the history import's claim is written but not committed.
    let legacy: Promise<string[]> | undefined;
    const hook = hookTransactions(t, async (n, run, operation) => {
      if (1 !== n) return run();
      hook.restore();
      return hook.original(
        async (tx: unknown) => {
          const value = await operation(tx);
          legacy = importUserBalanceFromSplitWise(me.id, [oldFriendOf(file.friends[0]!)]);
          await new Promise((resolve) => setTimeout(resolve, 300));
          return value;
        },
        { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 },
      );
    });
    let result;
    try {
      result = await t.importSplitwiseItem(me, request);
    } finally {
      hook.restore();
    }

    imported(result);
    assert.deepEqual(await legacy, ['Bo']);
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `USD ${me.id}->${boUser.id} 1000`,
      `USD ${boUser.id}->${me.id} -1000`,
    ]);
  }),
);

const sharedGroupFile = (t: Setup, me: Person, other: Person, cents: number) => {
  const gid = t.base + 300;
  return {
    gid,
    file: buildExport({
      me,
      people: [other],
      groups: [{ id: gid, name: 'Shared', memberIds: [me.id, other.id].sort((a, b) => a - b) }],
      expenses: [
        expense({
          id: t.base + 9100,
          groupId: gid,
          users: [
            [t.sw('Ada', 1).id, cents, cents / 2],
            [t.sw('Bo', 2).id, 0, cents / 2],
          ],
        }),
      ],
    }),
  };
};

void test(
  "P1-b: two members importing different versions at the same time: one waits, then is refused (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const first = sharedGroupFile(t, ada, bo, 1000);
    const second = sharedGroupFile(t, bo, ada, 2000);
    const key = `group:${first.gid}`;

    const results = await Promise.all([
      t.importSplitwiseItem(adaUser, requestFor(t, first.file, key)),
      t.importSplitwiseItem(boUser, requestFor(t, second.file, key)),
    ]);

    const winner = results.findIndex((r) => 'imported' === r.status);
    assert.notEqual(winner, -1, JSON.stringify(results));
    refused(results[1 - winner], /already in SplitPro with different amounts or people/);
    const owed = 0 === winner ? 500 : 1000;
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), [
      `USD ${adaUser.id}->${boUser.id} ${owed}`,
      `USD ${boUser.id}->${adaUser.id} -${owed}`,
    ]);
  }),
);

void test(
  'P1-b: an import of a group already being imported is refused when it can no longer wait',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const locks = await import('~/server/api/services/splitwiseImportLocks');
    const adaUser = await t.createUser('Ada');
    const { gid, file } = sharedGroupFile(t, t.sw('Ada', 1), t.sw('Bo', 2), 1000);
    const request = requestFor(t, file, `group:${gid}`);

    const token = await locks.acquireImportLocks([`splitwise-group:${gid}`], 0);
    assert.ok(token);
    try {
      refused(
        await t.importSplitwiseItem(adaUser, request, { lockWaitMs: 300 }),
        /An import of this group is already running/,
      );
    } finally {
      await locks.releaseImportLocks(token);
    }
    imported(await t.importSplitwiseItem(adaUser, request, { lockWaitMs: 0 }));
  }),
);

void test(
  'P1-b: an expense saved by someone else meanwhile is compared before it is skipped, in the same transaction',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { insertImportedExpenses } = await import('~/server/api/services/splitService');
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const { gid, file } = sharedGroupFile(t, t.sw('Ada', 1), t.sw('Bo', 2), 1000);
    const request = requestFor(t, file, `group:${gid}`);

    // As if an import that didn't hold the lease saved another version first.
    const hook = hookTransactions(t, async (n, run) => {
      if (2 === n) {
        const group = await t.db.group.findUniqueOrThrow({
          where: { splitwiseGroupId: String(gid) },
        });
        await hook.original(async (tx: unknown) =>
          insertImportedExpenses(tx as never, group.id, [
            {
              paidBy: adaUser.id,
              name: 'Other version',
              category: 'general',
              amount: 30,
              splitType: 'EXACT',
              currency: 'USD',
              participants: [
                { userId: adaUser.id, amount: 15 },
                { userId: boUser.id, amount: -15 },
              ],
              currentUserId: boUser.id,
              expenseDate: new Date(),
              splitwiseExpenseId: String(t.base + 9100),
              splitwiseScope: `group:${group.id}`,
              splitwisePart: 0,
            },
          ]),
        );
      }
      return run();
    });
    let result;
    try {
      result = await t.importSplitwiseItem(adaUser, request);
    } finally {
      hook.restore();
    }

    assert.equal(result.status, 'partial', JSON.stringify(result));
    assert.match(
      (result as { reason: string }).reason,
      /imported at the same time with different amounts or people/,
    );
    // Only the other version moved money.
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), [
      `USD ${adaUser.id}->${boUser.id} 1500`,
      `USD ${boUser.id}->${adaUser.id} -1500`,
    ]);
  }),
);

void test(
  'P1-b: a version imported earlier is compared too, so a different one is refused',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const first = sharedGroupFile(t, ada, bo, 1000);
    imported(await t.importSplitwiseItem(adaUser, requestFor(t, first.file, `group:${first.gid}`)));

    // Bo's file agrees: nothing new. A different version is refused, and Ada's stays.
    const same = sharedGroupFile(t, bo, ada, 1000);
    const again = imported(
      await t.importSplitwiseItem(boUser, requestFor(t, same.file, `group:${same.gid}`)),
    );
    assert.deepEqual([again.imported, again.alreadyImported], [0, 1]);
    const other = sharedGroupFile(t, bo, ada, 2000);
    refused(
      await t.importSplitwiseItem(boUser, requestFor(t, other.file, `group:${other.gid}`)),
      /already in SplitPro with different amounts or people/,
    );
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), [
      `USD ${adaUser.id}->${boUser.id} 500`,
      `USD ${boUser.id}->${adaUser.id} -500`,
    ]);
  }),
);

void test(
  "ids are scoped: someone else's file claiming your expense ids can't block or change your import (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const fred = t.sw('Fred', 3);
    const adaUser = await t.createUser('Ada');
    const fredUser = await t.createUser('Fred');
    const [groupExpenseId, friendExpenseId] = [t.base + 9201, t.base + 9202];

    // Fred makes up a group with Ada and Bo, and an expense outside groups with Ada, reusing ids.
    // (A debt between Ada and Bo alone would be refused; see the next test.)
    const forged = buildExport({
      me: fred,
      people: [ada, bo],
      groups: [{ id: t.base + 400, name: 'Forged', memberIds: [ada.id, bo.id, fred.id] }],
      expenses: [
        expense({
          id: groupExpenseId,
          groupId: t.base + 400,
          users: [
            [fred.id, 10000, 0],
            [ada.id, 0, 10000],
          ],
        }),
        expense({
          id: friendExpenseId,
          users: [
            [fred.id, 4000, 2000],
            [ada.id, 0, 2000],
          ],
        }),
      ],
    });
    Object.values((await t.importFile(fredUser, forged)).results).forEach(imported);

    // Ada's real group and expense outside groups, with the same ids, still import.
    const real = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: t.base + 401, name: 'Real', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: groupExpenseId,
          groupId: t.base + 401,
          users: [
            [ada.id, 3000, 1500],
            [bo.id, 0, 1500],
          ],
        }),
        expense({
          id: friendExpenseId,
          users: [
            [ada.id, 1000, 500],
            [bo.id, 0, 500],
          ],
        }),
      ],
    });
    const { results } = await t.importFile(adaUser, real);
    assert.deepEqual(
      Object.values(results).map((r) => [r.status, 'imported' === r.status ? r.imported : 0]),
      [
        ['imported', 1],
        ['imported', 1],
      ],
    );

    // Ada's own expense that moved out of the group in Splitwise is caught, not imported twice.
    const moved = buildExport({
      me: ada,
      people: [bo],
      groups: [],
      expenses: [
        expense({
          id: groupExpenseId,
          users: [
            [ada.id, 3000, 1500],
            [bo.id, 0, 1500],
          ],
        }),
      ],
    });
    refused(
      (await t.importFile(adaUser, moved)).results[`friends:${bo.id}`],
      /already imported in another group with other people/,
    );
  }),
);

void test(
  "debts between two other people need them to be known to you, like in the app (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const fred = t.sw('Fred', 1);
    const ada = t.sw('Ada', 2);
    const bo = t.sw('Bo', 3);
    const newcomer = t.sw('Cy', 4);
    const fredUser = await t.createUser('Fred');
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const gid = t.base + 450;
    const fileWith = (debtor: Person, people: Person[], id: number) =>
      buildExport({
        me: fred,
        people,
        groups: [{ id, name: 'Made up', memberIds: [fred.id, ...people.map((p) => p.id)] }],
        expenses: [
          expense({
            id: id * 10,
            groupId: id,
            users: [
              [ada.id, 10000, 0],
              [debtor.id, 0, 10000],
            ],
          }),
        ],
      });
    const before = await t.snapshot();

    // Ada and Bo already use SplitPro and don't know Fred: Fred can't put a debt between them.
    refused(
      (await t.importFile(fredUser, fileWith(bo, [ada, bo], gid))).results[`group:${gid}`],
      /Ada, Bo already use SplitPro/,
    );
    // Nor between Ada and someone new.
    refused(
      (await t.importFile(fredUser, fileWith(newcomer, [ada, newcomer], gid + 1))).results[
        `group:${gid + 1}`
      ],
      /Ada already uses SplitPro/,
    );
    assert.deepEqual(await t.snapshot(), before, 'nothing written');
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), []);

    // Once they are Fred's friends, it imports, as adding the expense in the app would.
    await t.db.friendship.createMany({
      data: [adaUser, boUser].flatMap((u) => [
        { userId: fredUser.id, friendId: u.id },
        { userId: u.id, friendId: fredUser.id },
      ]),
    });
    imported((await t.importFile(fredUser, fileWith(bo, [ada, bo], gid))).results[`group:${gid}`]);
    assert.equal((await t.balances([adaUser.id, boUser.id])).length, 2);
  }),
);

void test(
  'non-group: two people in the same expense import it once; a different version is refused',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const [adaUser, boUser, cyUser] = await Promise.all(['Ada', 'Bo', 'Cy'].map(t.createUser));
    const shared = (me: Person, others: Person[], cents: number) =>
      buildExport({
        me,
        people: others,
        groups: [],
        expenses: [
          expense({
            id: t.base + 9301,
            users: [
              [ada.id, 3 * cents, cents],
              [bo.id, 0, cents],
              [cy.id, 0, cents],
            ],
          }),
        ],
      });
    Object.values((await t.importFile(adaUser!, shared(ada, [bo, cy], 1000))).results).forEach(
      imported,
    );
    const before = await t.balances([adaUser!.id, boUser!.id, cyUser!.id]);

    const again = Object.values((await t.importFile(boUser!, shared(bo, [ada, cy], 1000))).results);
    assert.deepEqual(
      again.map((r) => [r.status, 'imported' === r.status ? r.alreadyImported : r]),
      [['imported', 1]],
    );
    refused(
      Object.values((await t.importFile(cyUser!, shared(cy, [ada, bo], 1200))).results)[0],
      /already in SplitPro with different amounts or people/,
    );
    assert.deepEqual(await t.balances([adaUser!.id, boUser!.id, cyUser!.id]), before);
  }),
);

void test(
  "P1-c: a group that simplifies debts imports the original debts, everyone's total matches (Sol's case)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const me = await t.createUser('Ada');
    const gid = t.base + 500;
    // Ada owes Bo 10 and Bo owes Cy 10. Splitwise shows it simplified: Ada owes Cy 10.
    const file = buildExport({
      me: ada,
      people: [bo, cy],
      groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, bo.id, cy.id], simplify: true }],
      expenses: [
        expense({
          id: t.base + 9401,
          groupId: gid,
          users: [
            [bo.id, 1000, 0],
            [ada.id, 0, 1000],
          ],
        }),
        expense({
          id: t.base + 9402,
          groupId: gid,
          users: [
            [cy.id, 1000, 0],
            [bo.id, 0, 1000],
          ],
        }),
      ],
    });
    const group = file.groups.find((g) => g.id === gid)!;
    assert.deepEqual(
      group.simplified_debts.map((d) => [d.from, d.to, d.amount]),
      [[ada.id, cy.id, '10.0']],
    );
    assert.equal(file.friends.find((f) => f.id === cy.id)!.balance[0]!.amount, '-10.0');

    const { plan, results } = await t.importFile(me, file);
    assert.equal(plan.items.find((i) => i.key === `group:${gid}`)!.simplified, true);
    const { groupId } = imported(results[`group:${gid}`]);

    const [boUser, cyUser] = [await t.userByEmail('Bo'), await t.userByEmail('Cy')];
    assert.deepEqual(await t.groupBalances(groupId), [
      `USD ${me.id}->${boUser.id} -1000`,
      `USD ${boUser.id}->${me.id} 1000`,
      `USD ${boUser.id}->${cyUser.id} -1000`,
      `USD ${cyUser.id}->${boUser.id} 1000`,
    ]);
    // Each person's total in the group is what Splitwise reports.
    const totals = (
      await t.db.groupBalance.groupBy({
        by: ['userId'],
        where: { groupId },
        _sum: { amount: true },
      })
    ).map((row) => [row.userId, row._sum.amount] as const);
    assert.deepEqual(
      new Map(totals),
      new Map([
        [me.id, -1000],
        [boUser.id, 0],
        [cyUser.id, 1000],
      ]),
    );

    // The original debts are still checked pair by pair.
    const tampered = structuredClone(file);
    const tamperedGroup = tampered.groups.find((g) => g.id === gid)!;
    tamperedGroup.original_debts = tamperedGroup.simplified_debts;
    refused(
      await t.importSplitwiseItem(me, requestFor(t, tampered, `group:${gid}`)),
      /don't add up to the balances Splitwise reports/,
    );
  }),
);

void test(
  "P2-a: an expense with several payers keeps everyone's spending (Sol's case)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const me = await t.createUser('Ada');
    const gid = t.base + 600;
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Dinner club', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: t.base + 9501,
          groupId: gid,
          users: [
            [ada.id, 3000, 1000],
            [bo.id, 2000, 4000],
          ],
          repayments: [[bo.id, ada.id, 2000]],
        }),
      ],
    });
    const { groupId } = imported((await t.importFile(me, file)).results[`group:${gid}`]);
    const expenses = await t.db.expense.findMany({
      where: { groupId },
      orderBy: { amount: 'desc' },
    });
    assert.deepEqual(
      expenses.map((e) => e.amount),
      [3000, 2000],
    );
    const boUser = await t.userByEmail('Bo');
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `USD ${me.id}->${boUser.id} 2000`,
      `USD ${boUser.id}->${me.id} -2000`,
    ]);
  }),
);

void test(
  "P2-c: a stop after some batches says how many were saved, and importing again finishes (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { TRPCError } = await import('@trpc/server');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const me = await t.createUser('Ada');
    const gid = t.base + 700;
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Long', memberIds: [ada.id, bo.id] }],
      expenses: Array.from({ length: 251 }, (_, i) =>
        expense({
          id: t.base + 10_000 + i,
          groupId: gid,
          users: [
            [ada.id, 200, 100],
            [bo.id, 0, 100],
          ],
        }),
      ),
    });
    const request = requestFor(t, file, `group:${gid}`);

    // The setup and the first batch of 250 commit; every transaction after that conflicts.
    const hook = hookTransactions(t, async (n, run) => {
      if (2 < n) {
        throw new TRPCError({ code: 'CONFLICT', message: 'injected conflict' });
      }
      return run();
    });
    let result;
    try {
      result = await t.importSplitwiseItem(me, request);
    } finally {
      hook.restore();
    }
    assert.deepEqual(result, {
      status: 'partial',
      imported: 250,
      remaining: 1,
      alreadyImported: 0,
      reason: 'Someone else updated these balances at the same time. Please try again.',
    });

    const again = imported(await t.importSplitwiseItem(me, request));
    assert.deepEqual([again.imported, again.alreadyImported], [1, 250]);
    const boUser = await t.userByEmail('Bo');
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `USD ${me.id}->${boUser.id} 25100`,
      `USD ${boUser.id}->${me.id} -25100`,
    ]);
  }),
);

void test(
  "P2-c: two people with the same email are refused before anything is written (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const cy = person(t.base + 2, 'Cy', t.email('Same'));
    const di = person(t.base + 3, 'Di', ` ${t.email('Same').toUpperCase()} `);
    const me = await t.createUser('Ada');
    const gid = t.base + 800;
    const file = buildExport({
      me: ada,
      people: [cy, di],
      groups: [{ id: gid, name: 'Same email', memberIds: [ada.id, cy.id, di.id] }],
      expenses: [
        expense({
          id: t.base + 9601,
          groupId: gid,
          users: [
            [ada.id, 3000, 1000],
            [cy.id, 0, 1000],
            [di.id, 0, 1000],
          ],
        }),
      ],
    });
    const before = await t.snapshot();
    refused(
      (await t.importFile(me, file)).results[`group:${gid}`],
      /Cy and Di have the same email address in Splitwise/,
    );
    assert.deepEqual(await t.snapshot(), before);
    assert.equal(await t.db.group.count({ where: { splitwiseGroupId: String(gid) } }), 0);
  }),
);

void test(
  'P2-d: a balance outside groups that no expense explains is refused, not dropped',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const file = buildExport({ me: ada, people: [bo], groups: [], expenses: [] });
    file.friends[0]!.balance = [{ currency_code: 'USD', amount: '10.0' }];
    const { plan } = await t.importFile(me, file, () => false);
    const item = plan.items.find((i) => i.key === `friends:${bo.id}`)!;
    assert.match(item.problem ?? '', /no expenses that explain it/);
    refused(
      await t.importSplitwiseItem(me, requestFor(t, file, item.key)),
      /don't add up to the balances Splitwise reports/,
    );
  }),
);
