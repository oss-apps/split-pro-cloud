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

  // Expense history is off until turned on; these tests are about it, so it's on.
  await db.appMetadata.upsert({
    where: { key: 'splitwise_history_import_enabled' },
    update: { value: 'true' },
    create: { key: 'splitwise_history_import_enabled', value: 'true' },
  });

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

  /** Makes everyone friends with everyone, like inviting each other in the app. */
  const befriend = (...users: { id: number }[]) =>
    db.friendship.createMany({
      data: users.flatMap((a) =>
        users.filter((b) => b.id !== a.id).map((b) => ({ userId: a.id, friendId: b.id })),
      ),
      skipDuplicates: true,
    });

  return {
    db,
    lib,
    base,
    sw,
    email,
    createUser,
    befriend,
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

const extraCleanUps: (() => Promise<unknown>)[] = [];

/** Another setup with its own people and ids, cleaned up with the test that made it. */
const fresh = async () => {
  const child = await setup();
  extraCleanUps.push(child.cleanUp);
  return child;
};

const withSetup = (fn: (t: Setup) => Promise<void>) => async () => {
  const t = await setup();
  try {
    await fn(t);
  } finally {
    await t.cleanUp();
    for (const cleanUp of extraCleanUps.splice(0)) {
      await cleanUp();
    }
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
      /You and Bo have balances from an earlier Splitwise import that brought over balances only/,
    );
    // Cy has no balance-only import, but you do, and your total would change: refused too.
    refused(
      results[`friends:${cy.id}`],
      /You have balances from an earlier Splitwise import that brought over balances only/,
    );
    assert.deepEqual(await t.balances([me.id, boUser.id]), oldBalances);
    assert.equal(
      await t.db.expense.count({
        where: { splitwiseExpenseId: { in: [String(t.base + 5001), String(t.base + 5002)] } },
      }),
      0,
    );
    // Both are refused before anything is written.
    assert.deepEqual(await t.snapshot(), before);
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
    // Saved by several transactions, still untouched.
    assert.equal(
      await t.db.expense.count({ where: { groupId: group.id, splitwiseEdited: true } }),
      0,
    );
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
 * that can write with its number (from 1) and the original call. The read-only balance checks
 * (REPEATABLE READ) aren't counted.
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
    if (
      !active ||
      'function' !== typeof operation ||
      'RepeatableRead' === (options as { isolationLevel?: string } | undefined)?.isolationLevel
    ) {
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
    await t.befriend(me, boUser);
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

    refused(
      result,
      /have balances from an earlier Splitwise import that brought over balances only/,
    );
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
    await t.befriend(me, boUser);
    const { file, key } = twoPeopleFile(t);
    const request = requestFor(t, file, key);

    // The old import starts while the history import's first batch has marked the people but
    // isn't committed yet.
    let legacy: Promise<string[]> | undefined;
    const hook = hookTransactions(t, async (n, run, operation) => {
      if (2 !== n) return run();
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
    await t.befriend(adaUser, boUser);
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
    await t.befriend(adaUser, boUser);
    const { gid, file } = sharedGroupFile(t, t.sw('Ada', 1), t.sw('Bo', 2), 1000);
    const request = requestFor(t, file, `group:${gid}`);

    // As if an import that didn't hold the lease saved another version first. Only Ada is in it,
    // so it writes no balance rows and the comparison of the expense is what catches it.
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
              participants: [{ userId: adaUser.id, amount: 0 }],
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
    // Nothing moved money.
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), []);
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
    await t.befriend(adaUser, boUser);
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
  "ids are scoped: someone else's file reusing your expense ids can't change money, and can only refuse people connected to them (Sol's repro)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const fred = t.sw('Fred', 3);
    const gil = t.sw('Gil', 4);
    const adaUser = await t.createUser('Ada');
    const fredUser = await t.createUser('Fred');
    const [groupExpenseId, friendExpenseId, sharedId] = [
      t.base + 9201,
      t.base + 9202,
      t.base + 9203,
    ];
    const twoWay = (id: number, payer: Person, other: Person, groupId?: number) =>
      expense({
        id,
        groupId: groupId ?? null,
        users: [
          [payer.id, 3000, 1500],
          [other.id, 0, 1500],
        ],
      });

    // Fred isn't connected to Ada, so he can't put her in a made-up group or expense at all.
    const withAda = buildExport({
      me: fred,
      people: [ada],
      groups: [{ id: t.base + 400, name: 'Forged', memberIds: [ada.id, fred.id] }],
      expenses: [
        twoWay(groupExpenseId, fred, ada, t.base + 400),
        twoWay(friendExpenseId, fred, ada),
      ],
    });
    const before = await t.balances([adaUser.id, fredUser.id]);
    Object.values((await t.importFile(fredUser, withAda)).results).forEach((r) =>
      refused(r, /Ada already uses SplitPro but isn't connected to you/),
    );
    assert.deepEqual(await t.balances([adaUser.id, fredUser.id]), before);

    // With someone new instead, Fred's file can reuse Ada's ids, but they aren't Ada's expenses.
    const withGil = buildExport({
      me: fred,
      people: [gil],
      groups: [{ id: t.base + 401, name: 'Forged', memberIds: [gil.id, fred.id] }],
      expenses: [
        twoWay(groupExpenseId, fred, gil, t.base + 401),
        twoWay(friendExpenseId, fred, gil),
      ],
    });
    Object.values((await t.importFile(fredUser, withGil)).results).forEach(imported);

    const real = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: t.base + 402, name: 'Real', memberIds: [ada.id, bo.id] }],
      expenses: [twoWay(groupExpenseId, ada, bo, t.base + 402), twoWay(friendExpenseId, ada, bo)],
    });
    const { results } = await t.importFile(adaUser, real);
    assert.deepEqual(
      Object.values(results).map((r) => [r.status, 'imported' === r.status ? r.imported : 0]),
      [
        ['imported', 1],
        ['imported', 1],
      ],
    );

    // Once Fred and Ada are connected, an expense of theirs with an id Ada uses elsewhere makes
    // Ada's import refuse, which is the worst it can do: no money changes.
    await t.befriend(adaUser, fredUser);
    Object.values(
      (
        await t.importFile(
          fredUser,
          buildExport({
            me: fred,
            people: [ada],
            groups: [],
            expenses: [twoWay(sharedId, fred, ada)],
          }),
        )
      ).results,
    ).forEach(imported);
    const boUser = await t.userByEmail('Bo');
    const balancesBefore = await t.balances([adaUser.id, boUser.id, fredUser.id]);
    refused(
      (
        await t.importFile(
          adaUser,
          buildExport({ me: ada, people: [bo], groups: [], expenses: [twoWay(sharedId, ada, bo)] }),
        )
      ).results[`friends:${bo.id}`],
      /An earlier import already added a different version of the Splitwise expense .* outside groups/,
    );
    assert.deepEqual(await t.balances([adaUser.id, boUser.id, fredUser.id]), balancesBefore);

    // Ada's own expense that moved out of the group in Splitwise is caught, not imported twice.
    refused(
      (
        await t.importFile(
          adaUser,
          buildExport({
            me: ada,
            people: [bo],
            groups: [],
            expenses: [twoWay(groupExpenseId, ada, bo)],
          }),
        )
      ).results[`friends:${bo.id}`],
      /An earlier import already added a different version of the Splitwise expense .* in another group/,
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
      /Ada and Bo already use SplitPro/,
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
    await t.befriend(adaUser!, boUser!, cyUser!);
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

/**
 * Writes what the balance-only import on main wrote, with no claims: each friend's whole
 * Splitwise balance on both sides with `importedFromSplitwise`, and groups with members only.
 */
const importLikeMain = async (
  t: Setup,
  importerId: number,
  balances: { friendId: number; currency: string; cents: number }[],
  groups: { splitwiseGroupId: number; name: string; memberIds: number[] }[] = [],
) => {
  await t.db.$transaction([
    ...balances.flatMap(({ friendId, currency, cents }) => [
      t.db.balance.upsert({
        where: { userId_currency_friendId: { userId: importerId, currency, friendId } },
        update: { amount: { increment: cents }, importedFromSplitwise: true },
        create: {
          userId: importerId,
          currency,
          friendId,
          amount: cents,
          importedFromSplitwise: true,
        },
      }),
      t.db.balance.upsert({
        where: { userId_currency_friendId: { userId: friendId, currency, friendId: importerId } },
        update: { amount: { increment: -cents }, importedFromSplitwise: true },
        create: {
          userId: friendId,
          currency,
          friendId: importerId,
          amount: -cents,
          importedFromSplitwise: true,
        },
      }),
    ]),
    ...groups.map((group) =>
      t.db.group.create({
        data: {
          name: group.name,
          splitwiseGroupId: String(group.splitwiseGroupId),
          publicId: `legacy-${t.base}-${group.splitwiseGroupId}`,
          userId: importerId,
          groupUsers: { create: group.memberIds.map((userId) => ({ userId })) },
        },
      }),
    ),
  ]);
};

/** Ada owes Bo 10 and Bo owes Cy 10; Splitwise simplifies it to Ada owes Cy 10. */
const simplifiedChainFile = (t: Setup) => {
  const ada = t.sw('Ada', 1);
  const bo = t.sw('Bo', 2);
  const cy = t.sw('Cy', 3);
  const gid = t.base + 800;
  const file = buildExport({
    me: ada,
    people: [bo, cy],
    groups: [{ id: gid, name: 'Simplified', memberIds: [ada.id, bo.id, cy.id], simplify: true }],
    expenses: [
      expense({
        id: t.base + 8001,
        groupId: gid,
        users: [
          [bo.id, 1000, 0],
          [ada.id, 0, 1000],
        ],
      }),
      expense({
        id: t.base + 8002,
        groupId: gid,
        users: [
          [cy.id, 1000, 0],
          [bo.id, 0, 1000],
        ],
      }),
    ],
  });
  return { ada, bo, cy, gid, file };
};

void test(
  "finding 1: a balance-only import of a simplified group's other pair refuses its history (Sol's LEGACY_SIMPLIFIED_DOUBLE)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { importUserBalanceFromSplitWise, importGroupFromSplitwise } = await import(
      '~/server/api/services/splitService'
    );
    const me = await t.createUser('Ada');
    const { cy, gid, file } = simplifiedChainFile(t);
    const cyFriend = file.friends.find((f) => f.id === cy.id)!;
    // Splitwise shows Ada owing Cy 10, so that's what the balance-only import brings over.
    assert.deepEqual(cyFriend.balance, [{ currency_code: 'USD', amount: '-10.0' }]);
    await importUserBalanceFromSplitWise(me.id, [oldFriendOf(cyFriend)]);
    const group = file.groups.find((g) => g.id === gid)!;
    await importGroupFromSplitwise(me.id, [
      {
        id: gid,
        name: group.name,
        members: group.members.map((m) => ({ ...oldFriendOf({ ...m, balance: [] }) })),
      },
    ]);
    const before = await t.snapshot();

    const result = (await t.importFile(me, file)).results[`group:${gid}`];
    refused(
      result,
      /You and Cy have balances from an earlier Splitwise import that brought over balances only/,
    );
    refused(result, /may already include these expenses, so they can't be imported on top of them/);
    assert.deepEqual(await t.snapshot(), before, 'nothing written');
    const total = await t.db.balance.aggregate({
      where: { userId: me.id },
      _sum: { amount: true },
    });
    assert.equal(total._sum.amount, -1000, 'Ada still owes 10 in all, not 20');
  }),
);

void test(
  'finding 1: balance-only imports made before claims existed are found from their balances, for groups and friends',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const cyUser = await t.createUser('Cy');
    const { bo, cy, gid, file } = simplifiedChainFile(t);
    await importLikeMain(
      t,
      me.id,
      [{ friendId: cyUser.id, currency: 'USD', cents: -1000 }],
      [{ splitwiseGroupId: gid, name: 'Simplified', memberIds: [me.id, boUser.id, cyUser.id] }],
    );
    assert.equal(
      await t.db.splitwiseImportPerson.count({
        where: { userId: { in: [me.id, boUser.id, cyUser.id] } },
      }),
      0,
      'no claims, like data written before this change',
    );
    const before = await t.snapshot();
    refused(
      (await t.importFile(me, file)).results[`group:${gid}`],
      /You and Cy have balances from an earlier Splitwise import that brought over balances only/,
    );
    assert.deepEqual(await t.snapshot(), before);

    // Outside groups too: Bo's balance came over as one amount, so his expenses can't.
    await importLikeMain(t, me.id, [{ friendId: boUser.id, currency: 'USD', cents: 500 }]);
    const nonGroup = buildExport({
      me: t.sw('Ada', 1),
      people: [bo, cy],
      groups: [],
      expenses: [
        expense({
          id: t.base + 8101,
          users: [
            [t.sw('Ada', 1).id, 1000, 500],
            [bo.id, 0, 500],
          ],
        }),
      ],
    });
    const nonGroupResult = (await t.importFile(me, nonGroup)).results[`friends:${bo.id}`];
    refused(
      nonGroupResult,
      /You and Bo have balances from an earlier Splitwise import that brought over balances only/,
    );
    refused(nonGroupResult, /may already include these expenses/);
    assert.deepEqual(await t.balances([me.id, boUser.id]), [
      `USD ${me.id}->${boUser.id} 500`,
      `USD ${boUser.id}->${me.id} -500`,
    ]);
  }),
);

void test(
  "finding 1: after a group's history, a balance-only import of any two of its members is skipped",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { importUserBalanceFromSplitWise } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const { cy, gid, file } = simplifiedChainFile(t);
    imported((await t.importFile(me, file)).results[`group:${gid}`]);
    const cyUser = await t.userByEmail('Cy');
    // Ada and Cy have no expense together, but Splitwise's simplified balance puts the group's
    // debt between them.
    const skipped = await importUserBalanceFromSplitWise(me.id, [
      oldFriendOf(file.friends.find((f) => f.id === cy.id)!),
    ]);
    assert.deepEqual(skipped, ['Cy']);
    assert.deepEqual(await t.balances([me.id, cyUser.id]), []);
  }),
);

void test(
  "finding 2: an expense moved out of a group isn't imported again by someone in it (Sol's THIRD_MEMBER_MOVED_DOUBLE)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const cy = t.sw('Cy', 3);
    const gid = t.base + 820;
    const rent = expense({
      id: t.base + 8201,
      groupId: gid,
      users: [
        [bo.id, 2000, 1000],
        [cy.id, 0, 1000],
      ],
    });
    imported(
      (
        await t.importFile(
          me,
          buildExport({
            me: ada,
            people: [bo, cy],
            groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id, cy.id] }],
            expenses: [rent],
          }),
        )
      ).results[`group:${gid}`],
    );
    const boUser = await t.userByEmail('Bo');
    const cyUser = await t.userByEmail('Cy');
    const before = await t.balances([boUser.id, cyUser.id]);
    assert.deepEqual(before, [
      `USD ${boUser.id}->${cyUser.id} 1000`,
      `USD ${cyUser.id}->${boUser.id} -1000`,
    ]);

    // Bo, who didn't import the group, imports the same expense after it moved outside groups.
    const moved = buildExport({
      me: bo,
      people: [cy],
      groups: [],
      expenses: [{ ...rent, group_id: null }],
    });
    refused(
      (await t.importFile(boUser, moved)).results[`friends:${cy.id}`],
      /An earlier import already added a different version of the Splitwise expense .* in another group/,
    );
    assert.equal(await t.db.expense.count({ where: { splitwiseExpenseId: String(rent.id) } }), 1);
    assert.deepEqual(await t.balances([boUser.id, cyUser.id]), before);
  }),
);

void test(
  'finding 2: the same expense saved meanwhile in another scope is caught in the saving transaction',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { insertImportedExpenses } = await import('~/server/api/services/splitService');
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    await t.befriend(adaUser, boUser);
    const { file, key } = twoPeopleFile(t);
    const request = requestFor(t, file, key);
    const group = await t.db.group.create({
      data: {
        name: 'Elsewhere',
        publicId: `elsewhere-${t.base}`,
        userId: boUser.id,
        groupUsers: { create: [{ userId: adaUser.id }, { userId: boUser.id }] },
      },
    });

    // After every check passed, someone saves the same expense in a group, with only Ada in it so
    // it writes no balance rows: the check of other scopes is what catches it.
    const hook = hookTransactions(t, async (n, run) => {
      if (2 === n) {
        await hook.original(async (tx: unknown) =>
          insertImportedExpenses(tx as never, group.id, [
            {
              paidBy: adaUser.id,
              name: 'Same expense, in a group',
              category: 'general',
              amount: 20,
              splitType: 'EXACT',
              currency: 'USD',
              participants: [{ userId: adaUser.id, amount: 0 }],
              currentUserId: boUser.id,
              expenseDate: new Date(),
              splitwiseExpenseId: String(t.base + 9001),
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
      /An earlier import already added a different version of the Splitwise expense .* in another group/,
    );
    assert.equal(
      await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 9001) } }),
      1,
    );
    assert.deepEqual(await t.balances([adaUser.id, boUser.id]), []);
  }),
);

void test(
  "finding 4: an import can't add existing accounts you aren't connected to, even to an empty group (Sol's EMPTY_GROUP_CONNECTION_BOOTSTRAP)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { getKnownUserIds } = await import('~/server/api/services/accessControl');
    const fred = t.sw('Fred', 1);
    const ada = t.sw('Ada', 2);
    const bo = t.sw('Bo', 3);
    const newcomer = t.sw('Cy', 4);
    const fredUser = await t.createUser('Fred');
    const adaUser = await t.createUser('Ada');
    const boUser = await t.createUser('Bo');
    const gid = t.base + 840;
    const before = await t.snapshot();

    refused(
      (
        await t.importFile(
          fredUser,
          buildExport({
            me: fred,
            people: [ada, bo],
            groups: [{ id: gid, name: 'Empty', memberIds: [fred.id, ada.id, bo.id] }],
            expenses: [],
          }),
        )
      ).results[`group:${gid}`],
      /Ada and Bo already use SplitPro but aren't connected to you there yet/,
    );
    assert.deepEqual(await t.snapshot(), before, 'no group, nothing written');
    assert.equal((await getKnownUserIds(fredUser.id, [adaUser.id, boUser.id])).size, 0);

    // People without an account are added, as an invite would.
    imported(
      (
        await t.importFile(
          fredUser,
          buildExport({
            me: fred,
            people: [newcomer],
            groups: [{ id: gid + 1, name: 'New people', memberIds: [fred.id, newcomer.id] }],
            expenses: [],
          }),
        )
      ).results[`group:${gid + 1}`],
    );

    // An existing group gets no one new you aren't connected to either.
    const flat = await t.db.group.findUniqueOrThrow({
      where: { splitwiseGroupId: String(gid + 1) },
    });
    refused(
      (
        await t.importFile(
          fredUser,
          buildExport({
            me: fred,
            people: [newcomer, ada],
            groups: [
              { id: gid + 1, name: 'New people', memberIds: [fred.id, newcomer.id, ada.id] },
            ],
            expenses: [
              expense({
                id: t.base + 8401,
                groupId: gid + 1,
                users: [
                  [fred.id, 1000, 500],
                  [ada.id, 0, 500],
                ],
              }),
            ],
          }),
        )
      ).results[`group:${gid + 1}`],
      /Ada already uses SplitPro but isn't connected to you there yet/,
    );
    assert.equal(
      await t.db.groupUser.count({ where: { groupId: flat.id, userId: adaUser.id } }),
      0,
    );
  }),
);

void test(
  "finding 5: a split batch that stops part way reports what its first half saved (Sol's RECURSIVE_PARTIAL_COUNTS)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { Prisma } = await import('@prisma/client');
    const me = await t.createUser('Ada');
    const ada = t.sw('Ada', 1);
    const bo = t.sw('Bo', 2);
    const gid = t.base + 860;
    const ids = Array.from({ length: 4 }, (_, i) => t.base + 8601 + i);
    const file = buildExport({
      me: ada,
      people: [bo],
      groups: [{ id: gid, name: 'Flat', memberIds: [ada.id, bo.id] }],
      expenses: ids.map((id) =>
        expense({
          id,
          groupId: gid,
          users: [
            [ada.id, 200, 100],
            [bo.id, 0, 100],
          ],
        }),
      ),
    });

    // The whole batch keeps conflicting, so it is split; the first half saves, the second fails.
    const failing = <T extends object>(tx: T): T =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if ('expense' !== prop) return value;
          const delegate = value as {
            createManyAndReturn: (args: { data: { splitwiseExpenseId: string }[] }) => unknown;
          };
          return new Proxy(delegate, {
            get(model, name) {
              if ('createManyAndReturn' !== name) return Reflect.get(model, name) as unknown;
              return (args: { data: { splitwiseExpenseId: string }[] }) => {
                if (4 === args.data.length) {
                  throw new Prisma.PrismaClientKnownRequestError('write conflict', {
                    code: 'P2034',
                    clientVersion: 'test',
                  });
                }
                if (args.data.some((row) => String(ids[2]) === row.splitwiseExpenseId)) {
                  throw new Error('second half failed');
                }
                return model.createManyAndReturn(args);
              };
            },
          });
        },
      });
    const hook = hookTransactions(t, (_n, _run, operation) =>
      hook.original((tx: unknown) => operation(failing(tx as object)), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    let result;
    try {
      result = (await t.importFile(me, file)).results[`group:${gid}`];
    } finally {
      hook.restore();
    }
    assert.deepEqual(
      { ...result, reason: undefined },
      { status: 'partial', imported: 2, remaining: 2, alreadyImported: 0, reason: undefined },
    );
    const group = await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(gid) } });
    assert.equal(await t.db.expense.count({ where: { groupId: group.id } }), 2);

    const resumed = imported((await t.importFile(me, file)).results[`group:${gid}`]);
    assert.deepEqual([resumed.imported, resumed.alreadyImported], [2, 2]);
  }),
);

void test(
  'finding 2: the comparison covers the group, the money and the people, and ignores zero shares',
  { skip: !databaseUrl },
  async () => {
    process.env.SKIP_ENV_VALIDATION = '1';
    const { isSameImportedExpense } = await import('~/server/api/services/splitService');
    const saved = [
      {
        groupId: 7,
        amount: 1000,
        currency: 'USD',
        paidBy: 1,
        splitType: 'EXACT' as const,
        splitwisePart: 0,
        deletedAt: null,
        splitwiseEdited: false,
        expenseParticipants: [
          { userId: 1, amount: 500 },
          { userId: 2, amount: -500 },
        ],
      },
    ];
    const part = {
      amount: 1000,
      currency: 'USD',
      paidBy: 1,
      isSettlement: false,
      splitwisePart: 0,
      shares: [
        { userId: 1, amount: 500 },
        { userId: 2, amount: -500 },
      ],
    };
    assert.equal(isSameImportedExpense(saved, 7, [part]), true);
    assert.equal(
      isSameImportedExpense(saved, 7, [
        { ...part, shares: [...part.shares, { userId: 3, amount: 0 }] },
      ]),
      true,
    );
    assert.equal(isSameImportedExpense(saved, 8, [part]), false, 'another group');
    assert.equal(isSameImportedExpense(saved, null, [part]), false, 'outside groups');
    [
      { amount: 1001 },
      { currency: 'EUR' },
      { paidBy: 2 },
      { isSettlement: true },
      { splitwisePart: 1 },
      {
        shares: [
          { userId: 1, amount: 499 },
          { userId: 2, amount: -499 },
        ],
      },
    ].forEach((changed) =>
      assert.equal(
        isSameImportedExpense(saved, 7, [{ ...part, ...changed }]),
        false,
        JSON.stringify(changed),
      ),
    );
    assert.equal(
      isSameImportedExpense([{ ...saved[0]!, deletedAt: new Date() }], 7, [part]),
      false,
      'deleted in SplitPro',
    );
    assert.equal(
      isSameImportedExpense([{ ...saved[0]!, splitwiseEdited: true }], 7, [part]),
      false,
      'changed in SplitPro since it was imported',
    );
  },
);

void test(
  'person rule, the other way: after history, the balance-only import skips anyone involved',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { importUserBalanceFromSplitWise } = await import('~/server/api/services/splitService');
    const gus = await t.createUser('Gus');
    const hal = await t.createUser('Hal');
    const ivy = await t.createUser('Ivy');
    await t.befriend(gus, hal);
    const [swGus, swHal, swIvy] = [t.sw('Gus', 1), t.sw('Hal', 2), t.sw('Ivy', 3)];
    const file = buildExport({
      me: swGus,
      people: [swHal],
      groups: [],
      expenses: [
        expense({
          id: t.base + 5101,
          users: [
            [swGus.id, 2000, 1000],
            [swHal.id, 0, 1000],
          ],
        }),
      ],
    });
    imported((await t.importFile(gus, file)).results[`friends:${swHal.id}`]);
    const marks = await t.db.splitwiseImportPerson.findMany({
      where: { userId: { in: [gus.id, hal.id, ivy.id] } },
      orderBy: { userId: 'asc' },
    });
    assert.deepEqual(
      marks.map((m) => [m.userId, m.mode]),
      [
        [gus.id, 'HISTORY'],
        [hal.id, 'HISTORY'],
      ],
    );

    const before = await t.balances([gus.id, hal.id, ivy.id]);
    const old = (friend: Person, cents: string) => ({
      ...oldFriendOf({ ...friend, balance: [{ currency_code: 'USD', amount: cents }] }),
    });
    // Gus with Hal, Gus with Ivy (Gus has history), Ivy with Hal (Hal has history).
    assert.deepEqual(await importUserBalanceFromSplitWise(gus.id, [old(swHal, '10.0')]), ['Hal']);
    assert.deepEqual(await importUserBalanceFromSplitWise(gus.id, [old(swIvy, '5.0')]), ['Ivy']);
    assert.deepEqual(await importUserBalanceFromSplitWise(ivy.id, [old(swHal, '7.0')]), ['Hal']);
    assert.deepEqual(await t.balances([gus.id, hal.id, ivy.id]), before);
    assert.equal(
      await t.db.splitwiseImportPerson.count({ where: { userId: ivy.id } }),
      0,
      'nothing written, so Ivy is not marked',
    );
  }),
);

/** A group of Ada (you), Bo and Cy, with one expense: Bo paid 20 for Ada and Bo. */
const personRuleFile = (t: Setup) => {
  const [ada, bo, cy] = [t.sw('Ada', 1), t.sw('Bo', 2), t.sw('Cy', 3)];
  const gid = t.base + 1300;
  const file = buildExport({
    me: ada,
    people: [bo, cy],
    groups: [{ id: gid, name: 'Person rule', memberIds: [ada.id, bo.id, cy.id] }],
    expenses: [
      expense({
        id: t.base + 13001,
        groupId: gid,
        users: [
          [ada.id, 0, 1000],
          [bo.id, 2000, 1000],
        ],
      }),
    ],
  });
  return { ada, bo, cy, gid, file, key: `group:${gid}` };
};

const personRuleUsers = async (t: Setup) => {
  const users = await Promise.all(['Ada', 'Bo', 'Cy', 'Dee'].map((n) => t.createUser(n)));
  const [ada, bo, cy, dee] = users as [
    Awaited<ReturnType<Setup['createUser']>>,
    ...Awaited<ReturnType<Setup['createUser']>>[],
  ];
  await t.befriend(ada, bo!);
  await t.befriend(ada, cy!);
  return { ada, bo: bo!, cy: cy!, dee: dee! };
};

void test(
  'person rule: anyone whose balance changes with any balance-only data refuses the import',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const cases: [
      string,
      (u: Awaited<ReturnType<typeof personRuleUsers>>) => Promise<void>,
      RegExp,
    ][] = [
      // A zero EUR balance between Bo and someone outside the group, from the old import.
      [
        'zero, other currency, with someone outside the group',
        (u) => importLikeMain(t, u.bo.id, [{ friendId: u.dee.id, currency: 'EUR', cents: 0 }]),
        /^Bo has balances from an earlier Splitwise import/,
      ],
      // Ada's balance with Dee was imported, then settled to zero in SplitPro.
      [
        'settled',
        async (u) => {
          await importLikeMain(t, u.ada.id, [{ friendId: u.dee.id, currency: 'USD', cents: 500 }]);
          await t.db.balance.updateMany({
            where: { OR: [{ userId: u.ada.id }, { friendId: u.ada.id }] },
            data: { amount: 0 },
          });
        },
        /^You have balances from an earlier Splitwise import/,
      ],
      // Imported by this version, then settled and the friend removed: the rows are gone, the
      // mark the import wrote stays.
      [
        'rows removed',
        async (u) => {
          const { importUserBalanceFromSplitWise } = await import(
            '~/server/api/services/splitService'
          );
          const dee = t.sw('Dee', 9);
          await importUserBalanceFromSplitWise(u.bo.id, [
            oldFriendOf({
              ...dee,
              email: u.dee.email,
              balance: [{ currency_code: 'USD', amount: '4.0' }],
            }),
          ]);
          await t.db.balance.deleteMany({
            where: {
              OR: [
                { userId: u.bo.id, friendId: u.dee.id },
                { userId: u.dee.id, friendId: u.bo.id },
              ],
            },
          });
        },
        /^Bo has balances from an earlier Splitwise import/,
      ],
      // Only recorded: the rows are gone (a settled friend was removed), the mark stays.
      [
        'marked only',
        async (u) => {
          await t.db.splitwiseImportPerson.create({ data: { userId: u.bo.id, mode: 'BALANCE' } });
        },
        /^Bo has balances from an earlier Splitwise import/,
      ],
    ];
    for (const [label, arrange, reason] of cases) {
      const run = await fresh();
      const u = await personRuleUsers(run);
      await arrange(u);
      const { file, key, gid } = personRuleFile(run);
      const before = await run.balances([u.ada.id, u.bo.id, u.cy.id, u.dee.id]);
      const result = (await run.importFile(u.ada, file)).results[key];
      refused(result, reason);
      refused(result, /The balances already imported stay as they are/);
      assert.deepEqual(await run.balances([u.ada.id, u.bo.id, u.cy.id, u.dee.id]), before, label);
      assert.equal(
        await run.db.group.count({ where: { splitwiseGroupId: String(gid) } }),
        0,
        label,
      );
    }

    // Cy has an old balance with Dee, but no share in any expense, so nobody's total is at risk.
    const run = await fresh();
    const u = await personRuleUsers(run);
    await importLikeMain(run, u.cy.id, [{ friendId: u.dee.id, currency: 'USD', cents: 700 }]);
    const { file, key } = personRuleFile(run);
    imported((await run.importFile(u.ada, file)).results[key]);
    // Ada owes Bo 10.
    assert.deepEqual(
      (await run.balances([u.ada.id, u.bo.id])).sort(),
      [`USD ${u.ada.id}->${u.bo.id} -1000`, `USD ${u.bo.id}->${u.ada.id} 1000`].sort(),
    );
  }),
);

void test(
  "person rule: a former member's old balance with you still refuses the group (Sol's FORMER_MEMBER_OLD_BALANCE)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const u = await personRuleUsers(t);
    const { ada, bo, cy, gid } = personRuleFile(t);
    // The old import gave you a balance with Cy for an expense in this group, then Cy left.
    await importLikeMain(
      t,
      u.ada.id,
      [{ friendId: u.cy.id, currency: 'USD', cents: -1000 }],
      [{ splitwiseGroupId: gid, name: 'Person rule', memberIds: [u.ada.id, u.bo.id] }],
    );
    const file = buildExport({
      me: ada,
      people: [bo, cy],
      groups: [{ id: gid, name: 'Person rule', memberIds: [ada.id, bo.id] }],
      expenses: [
        expense({
          id: t.base + 13101,
          groupId: gid,
          users: [
            [ada.id, 0, 1000],
            [bo.id, 1000, 0],
          ],
        }),
      ],
    });
    const before = await t.balances([u.ada.id, u.bo.id, u.cy.id]);
    refused(
      (await t.importFile(u.ada, file)).results[`group:${gid}`],
      /^You have balances from an earlier Splitwise import/,
    );
    assert.deepEqual(await t.balances([u.ada.id, u.bo.id, u.cy.id]), before);
  }),
);

void test(
  "person rule, in the transaction: an old app version's balance-only import after the checks is seen (Sol's MAIN_LEGACY_AFTER_PREFLIGHT)",
  { skip: !databaseUrl },
  withSetup(async () => {
    for (const at of [1, 2]) {
      const run = await fresh();
      const u = await personRuleUsers(run);
      const { file, key } = personRuleFile(run);
      const request = requestFor(run, file, key);
      // Before the setup transaction (1), or after it, before the first batch (2). Like the old
      // code: flags only, nothing recorded.
      const hook = hookTransactions(run, async (n, go) => {
        if (at === n) {
          await importLikeMain(run, u.ada.id, [
            { friendId: u.dee.id, currency: 'USD', cents: 300 },
          ]);
        }
        return go();
      });
      let result;
      try {
        result = await run.importSplitwiseItem(u.ada, request);
      } finally {
        hook.restore();
      }
      refused(result, /^You have balances from an earlier Splitwise import/);
      assert.equal(
        await run.db.expense.count({ where: { splitwiseExpenseId: String(run.base + 13001) } }),
        0,
        `injected at transaction ${at}`,
      );
      assert.equal(
        await run.db.splitwiseImportPerson.count({ where: { mode: 'HISTORY', userId: u.ada.id } }),
        0,
      );
      if (1 === at) {
        // Seen by the setup transaction, so not even the group is created.
        assert.equal(
          await run.db.group.count({ where: { splitwiseGroupId: String(run.base + 1300) } }),
          0,
        );
      }
    }
  }),
);

void test(
  "moved expense: the same importer's expense with all other people changed is never saved again (Sol's RESCOPED_DISJOINT_PARTIES)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli'];
    const users = await Promise.all(names.map((n) => t.createUser(n)));
    await Promise.all(users.slice(1).map((other) => t.befriend(users[0]!, other)));
    const sw = names.map((n, i) => t.sw(n, i + 1));
    const id = t.base + 14001;
    const fileIn = (gid: number, payer: Person, other: Person) =>
      buildExport({
        me: sw[0]!,
        people: sw.slice(1),
        groups: [{ id: gid, name: `Group ${gid}`, memberIds: [sw[0]!.id, payer.id, other.id] }],
        expenses: [
          expense({
            id,
            groupId: gid,
            users: [
              [payer.id, 2000, 1000],
              [other.id, 0, 1000],
            ],
          }),
        ],
      });
    const [g1, g2] = [t.base + 1401, t.base + 1402];
    imported((await t.importFile(users[0]!, fileIn(g1, sw[1]!, sw[2]!))).results[`group:${g1}`]);
    refused(
      (await t.importFile(users[0]!, fileIn(g2, sw[3]!, sw[4]!))).results[`group:${g2}`],
      new RegExp(`a different version of the Splitwise expense .*id ${id}\\).* in another group`),
    );
    const rows = await t.db.expense.findMany({ where: { splitwiseExpenseId: String(id) } });
    assert.deepEqual(
      rows.map((row) => row.amount),
      [2000],
    );
  }),
);

void test(
  'the history import switch: off by default, the server refuses and the page imports balances only',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const u = await personRuleUsers(t);
    const { file, key } = personRuleFile(t);
    const request = requestFor(t, file, key);
    const key_ = 'splitwise_history_import_enabled';
    try {
      for (const value of [null, 'false', 'TRUE', 'yes']) {
        await t.db.appMetadata.deleteMany({ where: { key: key_ } });
        if (null !== value) {
          await t.db.appMetadata.create({ data: { key: key_, value } });
        }
        assert.equal(await t.callerFor(u.ada).user.splitwiseHistoryImportEnabled(), false);
        refused(await t.importSplitwiseItem(u.ada, request), /isn't turned on yet/);
      }
      assert.equal(
        await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 13001) } }),
        0,
      );
    } finally {
      await t.db.appMetadata.upsert({
        where: { key: key_ },
        update: { value: 'true' },
        create: { key: key_, value: 'true' },
      });
    }
    assert.equal(await t.callerFor(u.ada).user.splitwiseHistoryImportEnabled(), true);
    imported(await t.importSplitwiseItem(u.ada, request));
  }),
);

void test(
  "moved expense: someone else's import that lists you, with a zero share, is the same expense",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const names = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli'];
    const users = await Promise.all(names.map((n) => t.createUser(n)));
    const [ada, bo] = users as [(typeof users)[number], (typeof users)[number]];
    await Promise.all(users.slice(1).map((other) => t.befriend(ada, other)));
    await Promise.all(users.slice(2).map((other) => t.befriend(bo, other)));
    const [swAda, swBo, swCy, swDee, swEli] = names.map((n, i) => t.sw(n, i + 1));
    const id = t.base + 15001;
    const [g1, g2] = [t.base + 1501, t.base + 1502];
    // Bo imports it: Bo paid for Cy, and Ada is listed with nothing paid or owed.
    const first = buildExport({
      me: swBo!,
      people: [swAda!, swCy!],
      groups: [{ id: g1, name: 'First', memberIds: [swAda!.id, swBo!.id, swCy!.id] }],
      expenses: [
        expense({
          id,
          groupId: g1,
          users: [
            [swBo!.id, 2000, 1000],
            [swCy!.id, 0, 1000],
            [swAda!.id, 0, 0],
          ],
        }),
      ],
    });
    imported((await t.importFile(bo, first)).results[`group:${g1}`]);
    // It moved in Splitwise, and now only Dee and Eli are in it.
    const moved = buildExport({
      me: swAda!,
      people: [swBo!, swCy!, swDee!, swEli!],
      groups: [{ id: g2, name: 'Second', memberIds: [swAda!.id, swDee!.id, swEli!.id] }],
      expenses: [
        expense({
          id,
          groupId: g2,
          users: [
            [swDee!.id, 2000, 1000],
            [swEli!.id, 0, 1000],
          ],
        }),
      ],
    });
    refused(
      (await t.importFile(ada, moved)).results[`group:${g2}`],
      /a different version of the Splitwise expense .* in another group/,
    );
    assert.equal(await t.db.expense.count({ where: { splitwiseExpenseId: String(id) } }), 1);
  }),
);

void test(
  "moved expense: someone else's import with any of the same people paying or owing is the same expense",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const names = ['Ada', 'Bo', 'Cy', 'Dee'];
    const users = await Promise.all(names.map((n) => t.createUser(n)));
    const [ada, bo] = users as [(typeof users)[number], (typeof users)[number]];
    await Promise.all(users.slice(1).map((other) => t.befriend(ada, other)));
    await Promise.all(users.slice(2).map((other) => t.befriend(bo, other)));
    const [swAda, swBo, swCy, swDee] = names.map((n, i) => t.sw(n, i + 1));
    const id = t.base + 16001;
    const [g1, g2] = [t.base + 1601, t.base + 1602];
    // Bo imports it: Bo paid for Cy. Ada isn't in it at all.
    const first = buildExport({
      me: swBo!,
      people: [swCy!],
      groups: [{ id: g1, name: 'First', memberIds: [swBo!.id, swCy!.id] }],
      expenses: [
        expense({
          id,
          groupId: g1,
          users: [
            [swBo!.id, 2000, 1000],
            [swCy!.id, 0, 1000],
          ],
        }),
      ],
    });
    imported((await t.importFile(bo, first)).results[`group:${g1}`]);
    // In Ada's file it's in another group, Cy paying for Dee: Cy is in both.
    const moved = buildExport({
      me: swAda!,
      people: [swCy!, swDee!],
      groups: [{ id: g2, name: 'Second', memberIds: [swAda!.id, swCy!.id, swDee!.id] }],
      expenses: [
        expense({
          id,
          groupId: g2,
          users: [
            [swCy!.id, 2000, 1000],
            [swDee!.id, 0, 1000],
          ],
        }),
      ],
    });
    refused(
      (await t.importFile(ada, moved)).results[`group:${g2}`],
      /a different version of the Splitwise expense .* in another group/,
    );
    assert.equal(await t.db.expense.count({ where: { splitwiseExpenseId: String(id) } }), 1);
  }),
);

/** The person rule's read, the only query that mentions balance-only marks and flags. */
const isPersonRuleQuery = (query: unknown) => {
  const sql = Array.isArray(query) ? query.join('') : '';
  return sql.includes('"SplitwiseImportPerson"') && sql.includes('"importedFromSplitwise"');
};

/**
 * Runs `fn` with the person rule seeing nothing, so the pair guard is tested on its own. The
 * wrapper isn't bound: a transaction's client finds `$queryRaw` on the base client and calls it
 * with itself as `this`, so its queries stay in the transaction. The original is put back exactly.
 */
const withoutPersonRule = async <T>(t: Setup, fn: () => Promise<T>) => {
  const client = t.db as unknown as Record<string, unknown>;
  const own = Object.getOwnPropertyDescriptor(client, '$queryRaw');
  const queryRaw = client.$queryRaw as (this: unknown, ...args: unknown[]) => Promise<unknown>;
  client.$queryRaw = function (this: unknown, query: unknown, ...values: unknown[]) {
    return isPersonRuleQuery(query) ? Promise.resolve([]) : queryRaw.call(this, query, ...values);
  };
  try {
    return await fn();
  } finally {
    if (own) {
      Object.defineProperty(client, '$queryRaw', own);
    } else {
      delete client.$queryRaw;
    }
  }
};

const NOT_CLEAN = /You and Bo already have expenses, payments or balances in SplitPro\./;
/** A batch that finds new SplitPro history between Ada and Bo stops with this. */
const NOT_CLEAN_REASON =
  "You and Bo already have expenses, payments or balances in SplitPro. History can only be imported for people you haven't recorded expenses or payments with in SplitPro yet. Import your Splitwise history before you start adding expenses together here.";
const CLEAN_SLATE_COPY =
  /History can only be imported for people you haven't recorded expenses or payments with in SplitPro yet\./;

/** Every pair, currency and group of these people that the guard would find inconsistent. */
const unexplainedAmong = async (t: Setup, userIds: number[], currencies = ['USD', 'EUR']) => {
  const { findUnexplainedBalances } = await import('~/server/api/services/balanceConsistency');
  const groups = await t.db.groupUser.findMany({
    where: { userId: { in: userIds } },
    select: { groupId: true },
    distinct: ['groupId'],
  });
  const keys = userIds.flatMap((a) =>
    userIds
      .filter((b) => a < b)
      .flatMap((b) =>
        currencies.flatMap((currency) =>
          [null, ...groups.map((g) => g.groupId)].map((groupId) => ({
            userId: a,
            friendId: b,
            currency,
            groupId,
          })),
        ),
      ),
  );
  return findUnexplainedBalances(t.db, keys);
};

/**
 * Stored rows against PR #8's replay of the same expenses (`replay`, corrected rule), as a second
 * recomputation: they and the guard must agree. The replay doesn't give back what a deleted
 * settle up cleared, so with deleted settle ups only `Balance` rows are compared.
 */
const assertMatchesReplay = async (t: Setup, userIds: number[], { groups = true } = {}) => {
  const { replay, pairKey } = await import('~/scripts/balanceRepair/replay');
  const expenses = await t.db.expense.findMany({
    where: {
      OR: [
        { paidBy: { in: userIds } },
        { expenseParticipants: { some: { userId: { in: userIds } } } },
      ],
    },
    include: { expenseParticipants: { select: { userId: true, amount: true } } },
  });
  const state = replay(
    {
      expenses: expenses.map((e) => ({
        id: e.id,
        paidBy: e.paidBy,
        currency: e.currency,
        groupId: e.groupId,
        isSettlement: 'SETTLEMENT' === e.splitType,
        createdAt: e.createdAt.getTime(),
        updatedAt: e.updatedAt.getTime(),
        deletedAt: e.deletedAt?.getTime() ?? null,
        addedBy: e.addedBy,
        updatedBy: e.updatedBy,
        edited: null !== e.updatedBy,
        allocationVersion: e.settlementAllocationVersion,
        participants: e.expenseParticipants,
      })),
      memberships: new Set(),
      balances: [],
      groupBalances: [],
      allocations: [],
      cutoff: 0,
    },
    'corrected',
  );
  const [balances, groupBalances] = await Promise.all([
    t.db.balance.findMany({ where: { userId: { in: userIds }, friendId: { in: userIds } } }),
    t.db.groupBalance.findMany({ where: { userId: { in: userIds }, firendId: { in: userIds } } }),
  ]);
  balances
    .filter((b) => b.userId < b.friendId)
    .forEach((b) =>
      assert.equal(
        state.get(pairKey(b.currency, b.userId, b.friendId))?.amount ?? 0,
        b.amount,
        `Balance ${b.currency} ${b.userId}->${b.friendId}`,
      ),
    );
  groupBalances
    .filter((b) => groups && b.userId < b.firendId)
    .forEach((b) =>
      assert.equal(
        state.get(pairKey(b.currency, b.userId, b.firendId))?.groups.get(b.groupId) ?? 0,
        b.amount,
        `GroupBalance ${b.groupId} ${b.currency} ${b.userId}->${b.firendId}`,
      ),
    );
};

void test(
  "pair guard: a balance-only import that was settled and whose rows were removed leaves no trace, and is refused (Sol's deletion boundary)",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    // What the balance-only import on main writes: Bo owes Ada 10, no expense behind it.
    await importLikeMain(t, me.id, [{ friendId: bo.id, currency: 'USD', cents: 1000 }]);
    // Bo settles it in SplitPro, then Ada removes Bo, which deletes the settled rows.
    await addUserExpense(
      bo.id,
      'Settle up',
      'general',
      10,
      'SETTLEMENT',
      'USD',
      [
        { userId: bo.id, amount: 10 },
        { userId: me.id, amount: -10 },
      ],
      bo.id,
      new Date('2025-01-01T00:00:00Z'),
    );
    await t.callerFor(me).user.deleteFriend({ friendId: bo.id });
    assert.equal(
      await t.db.balance.count({ where: { userId: { in: [me.id, bo.id] } } }),
      0,
      'no balance rows, so no flag',
    );
    assert.equal(
      await t.db.splitwiseImportPerson.count({ where: { userId: { in: [me.id, bo.id] } } }),
      0,
    );

    // They reconnect, and Ada imports the Splitwise expense behind that 10.
    await t.befriend(me, bo);
    const before = await t.snapshot();
    const { file, key } = twoPeopleFile(t);
    const result = (await t.importFile(me, file)).results[key];
    refused(result, NOT_CLEAN);
    refused(result, CLEAN_SLATE_COPY);
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  'pair guard alone: a surviving balance-only flag is refused with the person rule turned off',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    await importLikeMain(t, me.id, [{ friendId: bo.id, currency: 'USD', cents: 1000 }]);
    const { file, key } = twoPeopleFile(t);
    const before = await t.snapshot();

    // With the person rule, that's what refuses it.
    refused(
      (await t.importFile(me, file)).results[key],
      /You and Bo have balances from an earlier Splitwise import that brought over balances only/,
    );
    // Without it, the guard does: the 10 isn't explained by any expense.
    const result = await withoutPersonRule(t, () => t.importFile(me, file));
    refused(result.results[key], NOT_CLEAN);
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  'pair guard, in the transaction: drift appearing after the checks is seen by the setup and by each batch',
  { skip: !databaseUrl },
  async () => {
    for (const at of [1, 2]) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        // A new group: if the setup didn't check, it would be created before a batch refused.
        const [ada, swBo] = [run.sw('Ada', 1), run.sw('Bo', 2)];
        const gid = run.base + 1800;
        const file = buildExport({
          me: ada,
          people: [swBo],
          groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, swBo.id] }],
          expenses: [
            expense({
              id: run.base + 9001,
              groupId: gid,
              users: [
                [ada.id, 2000, 1000],
                [swBo.id, 0, 1000],
              ],
            }),
          ],
        });
        const key = `group:${gid}`;
        const before = await run.snapshot();
        // Someone adds 3 to the pair's rows without an expense, after the preflight checks.
        const hook = hookTransactions(run, async (n, go) => {
          if (at === n) {
            await hook.original(async (tx: unknown) =>
              (tx as typeof run.db).balance.createMany({
                data: [
                  { userId: me.id, friendId: bo.id, currency: 'USD', amount: 300 },
                  { userId: bo.id, friendId: me.id, currency: 'USD', amount: -300 },
                ],
              }),
            );
          }
          return go();
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[key];
        } finally {
          hook.restore();
        }
        refused(result, /Balances changed during the import\. Please run it again\./);
        assert.equal(
          await run.db.expense.count({ where: { splitwiseExpenseId: String(run.base + 9001) } }),
          0,
          `transaction ${at}`,
        );
        // Only the injected rows changed. Seen by the setup, not even the group is created; seen
        // by the first batch, the group from the setup stays, empty.
        const after = await run.snapshot();
        assert.equal(after.balances.length, before.balances.length + 2);
        assert.equal(after.groups, before.groups + (1 === at ? 0 : 1), `transaction ${at}`);
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'pair guard agrees with how balances are kept: random adds, edits, deletes and settle ups leave nothing unexplained',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const svc = await import('~/server/api/services/splitService');
    const users = await Promise.all(['Ada', 'Bo', 'Cy', 'Dee'].map((n) => t.createUser(n)));
    const ids = users.map((u) => u.id);
    await t.befriend(...users);
    const group = await t.db.group.create({
      data: {
        name: 'Random',
        publicId: `random-${t.base}`,
        userId: ids[0]!,
        groupUsers: { create: ids.map((userId) => ({ userId })) },
      },
    });
    let seed = 11;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      // The high bits: the low ones repeat after a few calls.
      return Math.floor(seed / 2 ** 16) % max;
    };
    const date = new Date('2025-01-01T00:00:00Z');
    const live: { id: string; paidBy: number }[] = [];
    for (let step = 0; step < 120; step++) {
      const payer = ids[random(4)]!;
      const other = ids.filter((id) => id !== payer)[random(3)]!;
      const currency = random(3) ? 'USD' : 'EUR';
      const cents = 100 + random(5000);
      const action = random(10);
      if (8 <= action && live.length) {
        const [gone] = live.splice(random(live.length), 1);
        await svc.deleteExpense(gone!.id, gone!.paidBy);
      } else if (7 === action) {
        // Someone who owes settles all of it outside groups, which clears their group rows.
        const owing = await t.db.balance.findMany({
          where: { userId: { in: ids }, friendId: { in: ids }, amount: { lt: 0 } },
          orderBy: [{ userId: 'asc' }, { friendId: 'asc' }, { currency: 'asc' }],
        });
        const debt = owing[random(Math.max(1, owing.length))];
        if (debt) {
          const value = -debt.amount / 100;
          const e = await svc.addUserExpense(
            debt.userId,
            'Settle up',
            'general',
            value,
            'SETTLEMENT',
            debt.currency,
            [
              { userId: debt.userId, amount: value },
              { userId: debt.friendId, amount: -value },
            ],
            debt.userId,
            date,
          );
          live.push({ id: e.id, paidBy: debt.userId });
        }
      } else if (6 === action && live.length) {
        const target = live[random(live.length)]!;
        const saved = await t.db.expense.findUniqueOrThrow({ where: { id: target.id } });
        if ('SETTLEMENT' !== saved.splitType) {
          await svc.editExpense(
            target.id,
            target.paidBy,
            saved.name,
            saved.category,
            cents / 100,
            'EXACT',
            currency,
            [
              { userId: target.paidBy, amount: cents / 100 },
              { userId: ids.find((id) => id !== target.paidBy)!, amount: -cents / 100 },
            ],
            target.paidBy,
            date,
          );
        }
      } else {
        const inGroup = 0 === random(2);
        // The other person owes half, rounded down.
        const owed = Math.floor(cents / 2) / 100;
        const parts = [
          { userId: payer, amount: owed },
          { userId: other, amount: -owed },
        ];
        const e = inGroup
          ? await svc.createGroupExpense(
              group.id,
              payer,
              'Random',
              'general',
              cents / 100,
              'EXACT',
              currency,
              parts,
              payer,
              date,
            )
          : await svc.addUserExpense(
              payer,
              'Random',
              'general',
              cents / 100,
              'EXACT',
              currency,
              parts,
              payer,
              date,
            );
        live.push({ id: e.id, paidBy: payer });
      }
    }
    assert.ok(
      await t.db.settlementAllocation.count({ where: { groupId: group.id } }),
      'some settle ups cleared group rows',
    );
    assert.deepEqual(await unexplainedAmong(t, ids), []);
    await assertMatchesReplay(t, ids, { groups: false });

    // One cent off anywhere is seen.
    const row = await t.db.groupBalance.findFirstOrThrow({ where: { groupId: group.id } });
    await t.db.groupBalance.update({
      where: {
        groupId_currency_firendId_userId: {
          groupId: row.groupId,
          currency: row.currency,
          firendId: row.firendId,
          userId: row.userId,
        },
      },
      data: { amount: { increment: 1 } },
    });
    assert.equal((await unexplainedAmong(t, ids)).length, 1);
  }),
);

void test(
  'a manual expense between the pair added in the middle of an import stops it with the saved count, and running it again is refused',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const { IMPORT_BATCH_SIZE } = await import('~/server/api/services/splitwiseImport');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [ada, swBo] = [t.sw('Ada', 1), t.sw('Bo', 2)];
    const count = IMPORT_BATCH_SIZE + 50;
    const file = buildExport({
      me: ada,
      people: [swBo],
      groups: [],
      expenses: Array.from({ length: count }, (_, index) =>
        expense({
          id: t.base + 20_000 + index,
          users: [
            [ada.id, 200, 100],
            [swBo.id, 0, 100],
          ],
        }),
      ),
    });
    const key = `friends:${swBo.id}`;

    // Bo adds a taxi in the app once the first batch is saved.
    const hook = hookTransactions(t, async (n, run) => {
      if (3 === n) {
        hook.restore();
        await addUserExpense(
          bo.id,
          'Taxi',
          'taxi',
          7,
          'EQUAL',
          'USD',
          [
            { userId: bo.id, amount: 3.5 },
            { userId: me.id, amount: -3.5 },
          ],
          bo.id,
          new Date('2025-01-01T00:00:00Z'),
        );
      }
      return run();
    });
    let first;
    try {
      first = (await t.importFile(me, file)).results[key];
    } finally {
      hook.restore();
    }
    assert.deepEqual(first, {
      status: 'partial',
      imported: IMPORT_BATCH_SIZE,
      remaining: 50,
      alreadyImported: 0,
      reason: NOT_CLEAN_REASON,
    });

    // The taxi is SplitPro history between them, so running it again is refused too.
    const before = await t.snapshot();
    const second = (await t.importFile(me, file)).results[key];
    refused(second, NOT_CLEAN);
    refused(second, CLEAN_SLATE_COPY);
    assert.deepEqual(await t.snapshot(), before);
    // What was saved stays, and every balance is still what the expenses add up to: 250 times 1,
    // less the 3.50 taxi.
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id]), []);
    assert.deepEqual(
      (await t.balances([me.id, bo.id])).sort(),
      [
        `USD ${me.id}->${bo.id} ${IMPORT_BATCH_SIZE * 100 - 350}`,
        `USD ${bo.id}->${me.id} ${350 - IMPORT_BATCH_SIZE * 100}`,
      ].sort(),
    );
    await assertMatchesReplay(t, [me.id, bo.id]);
  }),
);

void test(
  'an account made between the checks and the setup, with expenses its rows no longer show, is checked again and refused',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const { file, key } = twoPeopleFile(t);
    // Bo has no account when the import checks. Before its setup, Bo signs up, an expense with
    // Ada is added, and the rows are removed, as Sol's deletion boundary leaves them.
    const hook = hookTransactions(t, async (n, run) => {
      if (1 === n) {
        hook.restore();
        const bo = await t.createUser('Bo');
        await t.befriend(me, bo);
        await addUserExpense(
          me.id,
          'Taxi',
          'taxi',
          10,
          'EQUAL',
          'USD',
          [
            { userId: me.id, amount: 5 },
            { userId: bo.id, amount: -5 },
          ],
          me.id,
          new Date('2025-01-01T00:00:00Z'),
        );
        await t.db.balance.deleteMany({
          where: {
            OR: [
              { userId: me.id, friendId: bo.id },
              { userId: bo.id, friendId: me.id },
            ],
          },
        });
      }
      return run();
    });
    let result;
    try {
      result = (await t.importFile(me, file)).results[key];
    } finally {
      hook.restore();
    }
    refused(result, NOT_CLEAN);
    assert.equal(
      await t.db.expense.count({ where: { splitwiseExpenseId: String(t.base + 9001) } }),
      0,
    );
  }),
);

const DATE = new Date('2025-01-01T00:00:00Z');

/** Ada (you) and Bo in a Splitwise group, with one expense: Ada paid 20, half for Bo. */
const groupOfTwoFile = (t: Setup, gid: number, id: number) => {
  const [ada, bo] = [t.sw('Ada', 1), t.sw('Bo', 2)];
  return buildExport({
    me: ada,
    people: [bo],
    groups: [{ id: gid, name: `Group ${gid}`, memberIds: [ada.id, bo.id] }],
    expenses: [
      expense({
        id,
        groupId: gid,
        users: [
          [ada.id, 2000, 1000],
          [bo.id, 0, 1000],
        ],
      }),
    ],
  });
};

void test(
  'clean slate: two Splitwise groups and expenses outside groups with the same people all import, and again adds nothing',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [ada, swBo] = [t.sw('Ada', 1), t.sw('Bo', 2)];
    const [g1, g2] = [t.base + 2101, t.base + 2102];
    const file = buildExport({
      me: ada,
      people: [swBo],
      groups: [
        { id: g1, name: 'Trip', memberIds: [ada.id, swBo.id] },
        { id: g2, name: 'Flat', memberIds: [ada.id, swBo.id] },
      ],
      expenses: [
        expense({
          id: t.base + 21001,
          groupId: g1,
          users: [
            [ada.id, 2000, 1000],
            [swBo.id, 0, 1000],
          ],
        }),
        expense({
          id: t.base + 21002,
          groupId: g2,
          currency: 'EUR',
          users: [
            [swBo.id, 900, 300],
            [ada.id, 0, 600],
          ],
        }),
        expense({
          id: t.base + 21003,
          users: [
            [ada.id, 500, 250],
            [swBo.id, 0, 250],
          ],
        }),
      ],
    });
    const { results } = await t.importFile(me, file);
    assert.deepEqual(
      Object.keys(results).sort(),
      [`friends:${swBo.id}`, `group:${g1}`, `group:${g2}`].sort(),
    );
    Object.values(results).forEach(imported);
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id]), []);
    await assertMatchesReplay(t, [me.id, bo.id]);

    Object.values((await t.importFile(me, file)).results).forEach((r) =>
      assert.equal(imported(r).imported, 0),
    );
  }),
);

void test(
  'clean slate: any manual SplitPro history between the pair refuses the import, and nothing is written',
  { skip: !databaseUrl },
  async () => {
    const svc = await import('~/server/api/services/splitService');
    const cases: [
      string,
      (me: { id: number }, bo: { id: number }, run: Setup) => Promise<unknown>,
    ][] = [
      [
        'only a deleted expense',
        async (me, bo) => {
          const e = await svc.addUserExpense(
            me.id,
            'Taxi',
            'taxi',
            10,
            'EQUAL',
            'USD',
            [
              { userId: me.id, amount: 5 },
              { userId: bo.id, amount: -5 },
            ],
            me.id,
            DATE,
          );
          await svc.deleteExpense(e.id, me.id);
        },
      ],
      [
        'only a settle up',
        (me, bo) =>
          svc.addUserExpense(
            bo.id,
            'Settle up',
            'general',
            5,
            'SETTLEMENT',
            'USD',
            [
              { userId: bo.id, amount: 5 },
              { userId: me.id, amount: -5 },
            ],
            bo.id,
            DATE,
          ),
      ],
      [
        'an expense with a zero share',
        (me, bo) =>
          svc.addUserExpense(
            me.id,
            'Gift',
            'gifts',
            10,
            'EXACT',
            'USD',
            [
              { userId: me.id, amount: 0 },
              { userId: bo.id, amount: 0 },
            ],
            me.id,
            DATE,
          ),
      ],
      [
        'an expense in another currency',
        (me, bo) =>
          svc.addUserExpense(
            bo.id,
            'Train',
            'train',
            8,
            'EQUAL',
            'EUR',
            [
              { userId: bo.id, amount: 4 },
              { userId: me.id, amount: -4 },
            ],
            bo.id,
            DATE,
          ),
      ],
      [
        'a group expense settled outside the group (settlement allocations)',
        async (me, bo, run) => {
          const group = await run.db.group.create({
            data: {
              name: 'Manual',
              publicId: `manual-${run.base}`,
              userId: me.id,
              groupUsers: { create: [{ userId: me.id }, { userId: bo.id }] },
            },
          });
          await svc.createGroupExpense(
            group.id,
            me.id,
            'Dinner',
            'diningOut',
            20,
            'EXACT',
            'USD',
            [
              { userId: me.id, amount: 10 },
              { userId: bo.id, amount: -10 },
            ],
            me.id,
            DATE,
          );
          await svc.addUserExpense(
            bo.id,
            'Settle up',
            'general',
            10,
            'SETTLEMENT',
            'USD',
            [
              { userId: bo.id, amount: 10 },
              { userId: me.id, amount: -10 },
            ],
            bo.id,
            DATE,
          );
          assert.equal(
            await run.db.settlementAllocation.count({ where: { groupId: group.id } }),
            2,
          );
        },
      ],
    ];
    for (const [label, record] of cases) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        await record(me, bo, run);
        const before = await run.snapshot();
        const { file, key } = twoPeopleFile(run);
        const result = (await run.importFile(me, file)).results[key];
        refused(result, NOT_CLEAN);
        refused(result, CLEAN_SLATE_COPY);
        assert.deepEqual(await run.snapshot(), before, label);
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  "clean slate: an expense someone else paid for both isn't history between them",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    const cy = await t.createUser('Cy');
    await t.befriend(me, bo, cy);
    await addUserExpense(
      cy.id,
      'Dinner',
      'diningOut',
      30,
      'EQUAL',
      'USD',
      [
        { userId: cy.id, amount: 20 },
        { userId: me.id, amount: -10 },
        { userId: bo.id, amount: -10 },
      ],
      cy.id,
      DATE,
    );
    const { file, key } = twoPeopleFile(t);
    imported((await t.importFile(me, file)).results[key]);
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id, cy.id]), []);
  }),
);

void test(
  "Sol's r5: a balance-only import, settled, friend removed, then a settled group with the opposite debt deleted, is refused",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const svc = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    // Bo owed Ada 10 from Splitwise, imported as one amount the way main does, and paid it.
    await importLikeMain(t, me.id, [{ friendId: bo.id, currency: 'USD', cents: 1000 }]);
    await svc.addUserExpense(
      bo.id,
      'Settle up',
      'general',
      10,
      'SETTLEMENT',
      'USD',
      [
        { userId: bo.id, amount: 10 },
        { userId: me.id, amount: -10 },
      ],
      bo.id,
      DATE,
    );
    await t.callerFor(me).user.deleteFriend({ friendId: bo.id });
    // Reconnected: an unrelated group with the opposite debt, settled outside it, then deleted.
    await t.befriend(me, bo);
    const group = await t.db.group.create({
      data: {
        name: 'Settled',
        publicId: `settled-${t.base}`,
        userId: me.id,
        groupUsers: { create: [{ userId: me.id }, { userId: bo.id }] },
      },
    });
    await svc.createGroupExpense(
      group.id,
      bo.id,
      'Opposite',
      'general',
      20,
      'EXACT',
      'USD',
      [
        { userId: bo.id, amount: 10 },
        { userId: me.id, amount: -10 },
      ],
      bo.id,
      DATE,
    );
    await svc.addUserExpense(
      me.id,
      'Settle up',
      'general',
      10,
      'SETTLEMENT',
      'USD',
      [
        { userId: me.id, amount: 10 },
        { userId: bo.id, amount: -10 },
      ],
      me.id,
      DATE,
    );
    await t.callerFor(me).group.delete({ groupId: group.id });
    // The balance says 0 and so do the remaining expenses: only the settle ups show the history.
    assert.deepEqual(await t.balances([me.id, bo.id]), []);
    assert.equal(
      await t.db.balance.count({
        where: { userId: { in: [me.id, bo.id] }, importedFromSplitwise: true },
      }),
      0,
    );

    const before = await t.snapshot();
    const { file, key } = twoPeopleFile(t);
    const result = (await t.importFile(me, file)).results[key];
    refused(result, NOT_CLEAN);
    refused(result, CLEAN_SLATE_COPY);
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  "Sol's r5: a settle up edited to the same net after a member left (allocations gone, #29) is refused",
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const svc = await import('~/server/api/services/splitService');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const gid = t.base + 2301;
    const group = await t.db.group.create({
      data: {
        name: `Group ${gid}`,
        splitwiseGroupId: String(gid),
        publicId: `left-${t.base}`,
        userId: me.id,
        groupUsers: { create: [{ userId: me.id }, { userId: bo.id }] },
      },
    });
    await svc.createGroupExpense(
      group.id,
      me.id,
      'Group expense',
      'general',
      20,
      'EXACT',
      'USD',
      [
        { userId: me.id, amount: 10 },
        { userId: bo.id, amount: -10 },
      ],
      me.id,
      DATE,
    );
    const settlement = await svc.addUserExpense(
      bo.id,
      'Settle up',
      'general',
      10,
      'SETTLEMENT',
      'USD',
      [
        { userId: bo.id, amount: 10 },
        { userId: me.id, amount: -10 },
      ],
      bo.id,
      DATE,
    );
    await t.callerFor(bo).group.leaveGroup({ groupId: group.id });
    await svc.editExpense(
      settlement.id,
      bo.id,
      'Same net',
      'general',
      10,
      'EXACT',
      'USD',
      [
        { userId: bo.id, amount: 10 },
        { userId: me.id, amount: -10 },
      ],
      bo.id,
      DATE,
    );
    assert.equal(
      await t.db.settlementAllocation.count({ where: { settlementExpenseId: settlement.id } }),
      0,
    );

    const before = await t.snapshot();
    const result = (await t.importFile(me, groupOfTwoFile(t, gid, t.base + 23001))).results[
      `group:${gid}`
    ];
    refused(result, NOT_CLEAN);
    assert.deepEqual(await t.snapshot(), before);
  }),
);

void test(
  'clean slate: on a pair with only imported history, rows the expenses no longer explain are refused, in any group; fixed, it imports',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [g1, g2] = [t.base + 2201, t.base + 2202];
    imported(
      (await t.importFile(me, groupOfTwoFile(t, g1, t.base + 22001))).results[`group:${g1}`],
    );
    const g1Id = (await t.db.group.findUniqueOrThrow({ where: { splitwiseGroupId: String(g1) } }))
      .id;
    const second = groupOfTwoFile(t, g2, t.base + 22002);
    const refusedNow = async (label: string) => {
      const before = await t.snapshot();
      refused((await t.importFile(me, second)).results[`group:${g2}`], NOT_CLEAN);
      assert.deepEqual(await t.snapshot(), before, label);
    };
    const row = (userId: number, friendId: number) => ({
      userId_currency_friendId: { userId, currency: 'USD', friendId },
    });
    const pairRows = {
      OR: [
        { userId: me.id, friendId: bo.id },
        { userId: bo.id, friendId: me.id },
      ],
    };

    // Both rows moved by 5, still mirrored.
    await t.db.balance.update({ where: row(me.id, bo.id), data: { amount: { increment: 500 } } });
    await t.db.balance.update({ where: row(bo.id, me.id), data: { amount: { increment: -500 } } });
    await refusedNow('mirrored');
    await t.db.balance.update({ where: row(me.id, bo.id), data: { amount: { increment: -500 } } });
    await t.db.balance.update({ where: row(bo.id, me.id), data: { amount: { increment: 500 } } });
    // Only one of the two rows, either one.
    for (const [a, b] of [
      [me.id, bo.id],
      [bo.id, me.id],
    ] as const) {
      await t.db.balance.update({ where: row(a, b), data: { amount: { increment: 1 } } });
      await refusedNow(`row ${a}->${b}`);
      await t.db.balance.update({ where: row(a, b), data: { amount: { increment: -1 } } });
    }
    // Rows gone while the imported expenses are still there.
    const rows = await t.db.balance.findMany({ where: pairRows });
    await t.db.balance.deleteMany({ where: pairRows });
    await refusedNow('rows missing');
    await t.db.balance.createMany({ data: rows });
    // The first group's rows cleared without a record.
    const groupRows = await t.db.groupBalance.findMany({ where: { groupId: g1Id } });
    await t.db.groupBalance.updateMany({ where: { groupId: g1Id }, data: { amount: 0 } });
    await refusedNow('group rows cleared');
    for (const r of groupRows) {
      await t.db.groupBalance.update({
        where: {
          groupId_currency_firendId_userId: {
            groupId: r.groupId,
            currency: r.currency,
            firendId: r.firendId,
            userId: r.userId,
          },
        },
        data: { amount: r.amount },
      });
    }

    imported((await t.importFile(me, second)).results[`group:${g2}`]);
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id]), []);
    await assertMatchesReplay(t, [me.id, bo.id]);
  }),
);

void test(
  'rows removed after the check (as removing a friend does) stop the import, before the setup or in a batch',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [g1, g2] = [t.base + 2401, t.base + 2402];
    // Imported history that nets to 0: both rows exist, at 0.
    imported(
      (
        await t.importFile(
          me,
          buildExport({
            me: t.sw('Ada', 1),
            people: [t.sw('Bo', 2)],
            groups: [{ id: g1, name: 'Even', memberIds: [t.sw('Ada', 1).id, t.sw('Bo', 2).id] }],
            expenses: [
              expense({
                id: t.base + 24001,
                groupId: g1,
                users: [
                  [t.sw('Ada', 1).id, 2000, 1000],
                  [t.sw('Bo', 2).id, 0, 1000],
                ],
              }),
              expense({
                id: t.base + 24002,
                groupId: g1,
                users: [
                  [t.sw('Bo', 2).id, 2000, 1000],
                  [t.sw('Ada', 1).id, 0, 1000],
                ],
              }),
            ],
          }),
        )
      ).results[`group:${g1}`],
    );
    const pairRows = {
      OR: [
        { userId: me.id, friendId: bo.id },
        { userId: bo.id, friendId: me.id },
      ],
    };
    assert.deepEqual(
      (await t.db.balance.findMany({ where: pairRows })).map((b) => b.amount),
      [0, 0],
    );
    const second = groupOfTwoFile(t, g2, t.base + 24003);

    for (const at of [1, 2]) {
      const hook = hookTransactions(t, async (n, run) => {
        if (at === n) {
          await hook.original(async (tx: unknown) =>
            (tx as typeof t.db).balance.deleteMany({ where: pairRows }),
          );
        }
        return run();
      });
      let result;
      try {
        result = (await t.importFile(me, second)).results[`group:${g2}`];
      } finally {
        hook.restore();
      }
      refused(result, /Balances changed during the import/);
      await t.db.balance.createMany({
        data: [
          { userId: me.id, friendId: bo.id, currency: 'USD', amount: 0 },
          { userId: bo.id, friendId: me.id, currency: 'USD', amount: 0 },
        ],
      });
    }
    imported((await t.importFile(me, second)).results[`group:${g2}`]);
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id]), []);
  }),
);

void test(
  'a manual expense with a zero share, or in another currency, added in the middle of an import stops it too',
  { skip: !databaseUrl },
  async () => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const { IMPORT_BATCH_SIZE } = await import('~/server/api/services/splitwiseImport');
    const variants: [string, (me: number, bo: number) => Promise<unknown>][] = [
      [
        'zero share',
        (me, bo) =>
          addUserExpense(
            bo,
            'Gift',
            'gifts',
            7,
            'EXACT',
            'USD',
            [
              { userId: bo, amount: 0 },
              { userId: me, amount: 0 },
            ],
            bo,
            DATE,
          ),
      ],
      [
        'another currency',
        (me, bo) =>
          addUserExpense(
            bo,
            'Train',
            'train',
            7,
            'EQUAL',
            'EUR',
            [
              { userId: bo, amount: 3.5 },
              { userId: me, amount: -3.5 },
            ],
            bo,
            DATE,
          ),
      ],
    ];
    for (const [label, add] of variants) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        const [ada, swBo] = [run.sw('Ada', 1), run.sw('Bo', 2)];
        const file = buildExport({
          me: ada,
          people: [swBo],
          groups: [],
          expenses: Array.from({ length: IMPORT_BATCH_SIZE + 50 }, (_, index) =>
            expense({
              id: run.base + 25_000 + index,
              users: [
                [ada.id, 200, 100],
                [swBo.id, 0, 100],
              ],
            }),
          ),
        });
        const hook = hookTransactions(run, async (n, go) => {
          if (3 === n) {
            hook.restore();
            await add(me.id, bo.id);
          }
          return go();
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[`friends:${swBo.id}`];
        } finally {
          hook.restore();
        }
        assert.deepEqual(
          result,
          {
            status: 'partial',
            imported: IMPORT_BATCH_SIZE,
            remaining: 50,
            alreadyImported: 0,
            reason: NOT_CLEAN_REASON,
          },
          label,
        );
      } finally {
        await run.cleanUp();
      }
    }
  },
);

/** Ada pays 20 for herself and Bo, then Bo pays Ada back: real SplitPro history, settled. */
const enterAndSettle = async (
  t: Setup,
  ada: { id: number },
  bo: { id: number },
  groupId?: number,
) => {
  const svc = await import('~/server/api/services/splitService');
  const shares = [
    { userId: ada.id, amount: 10 },
    { userId: bo.id, amount: -10 },
  ];
  if (undefined === groupId) {
    await svc.addUserExpense(ada.id, 'Bill', 'general', 20, 'EXACT', 'USD', shares, ada.id, DATE);
  } else {
    await svc.createGroupExpense(
      groupId,
      ada.id,
      'Bill',
      'general',
      20,
      'EXACT',
      'USD',
      shares,
      ada.id,
      DATE,
    );
  }
  await svc.addUserExpense(
    bo.id,
    'Paid back',
    'general',
    10,
    'SETTLEMENT',
    'USD',
    [
      { userId: bo.id, amount: 10 },
      { userId: ada.id, amount: -10 },
    ],
    bo.id,
    DATE,
  );
};

void test(
  "r6: a bill entered, settled and the friend removed after the checks leaves no rows, and is still refused, before the setup or a batch (Sol's absent-row race)",
  { skip: !databaseUrl },
  async () => {
    for (const grouped of [false, true]) {
      for (const at of [1, 2]) {
        const run = await fresh();
        try {
          const me = await run.createUser('Ada');
          const bo = await run.createUser('Bo');
          await run.befriend(me, bo);
          const { file, key } = twoPeopleFile(run);
          const hook = hookTransactions(run, async (n, go) => {
            if (at === n) {
              hook.restore();
              if (grouped) {
                const group = await run
                  .callerFor(me)
                  .group.create({ name: 'Paid', currency: 'USD' });
                await run.callerFor(bo).group.joinGroup({ groupId: group.publicId });
                await enterAndSettle(run, me, bo, group.id);
                await run.callerFor(me).group.delete({ groupId: group.id });
              } else {
                await enterAndSettle(run, me, bo);
              }
              await run.callerFor(me).user.deleteFriend({ friendId: bo.id });
              assert.equal(
                await run.db.balance.count({ where: { userId: { in: [me.id, bo.id] } } }),
                0,
                'the rows are gone',
              );
            }
            return go();
          });
          let result;
          try {
            result = (await run.importFile(me, file)).results[key];
          } finally {
            hook.restore();
          }
          refused(result, NOT_CLEAN);
          const label = `${grouped ? 'group' : 'friends'}, transaction ${at}`;
          assert.equal(
            await run.db.expense.count({ where: { splitwiseExpenseId: String(run.base + 9001) } }),
            0,
            label,
          );
          assert.equal(
            await run.db.balance.count({ where: { userId: { in: [me.id, bo.id] } } }),
            0,
            label,
          );
        } finally {
          await run.cleanUp();
        }
      }
    }
  },
);

void test(
  'r6: an expense committed by someone else while a batch is saving makes it retry, and the retry refuses',
  { skip: !databaseUrl },
  async () => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    for (const grouped of [false, true]) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        const gid = run.base + 2600;
        const file = grouped ? groupOfTwoFile(run, gid, run.base + 26001) : twoPeopleFile(run).file;
        const key = grouped ? `group:${gid}` : `friends:${run.sw('Bo', 2).id}`;
        // In the first batch, after its checks passed and before it writes, Bo's bill commits.
        let committed = false;
        const hook = hookTransactions(run, async (n, go, operation) => {
          if (2 !== n) return go();
          hook.restore();
          return hook.original(
            (tx: Record<string, unknown>) =>
              operation(
                new Proxy(tx, {
                  get(target, prop, receiver) {
                    const value = Reflect.get(target, prop, receiver) as unknown;
                    if ('expense' !== prop) return value;
                    return new Proxy(value as object, {
                      get(model, name) {
                        const fn = Reflect.get(model, name) as (...args: unknown[]) => unknown;
                        if ('createManyAndReturn' !== name) return fn;
                        return async (...args: unknown[]) => {
                          if (!committed) {
                            committed = true;
                            await addUserExpense(
                              bo.id,
                              'Taxi',
                              'taxi',
                              6,
                              'EXACT',
                              'USD',
                              [
                                { userId: bo.id, amount: 3 },
                                { userId: me.id, amount: -3 },
                              ],
                              bo.id,
                              DATE,
                            );
                          }
                          return fn.apply(model, args);
                        };
                      },
                    });
                  },
                }),
              ),
            { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 20_000 },
          );
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[key];
        } finally {
          hook.restore();
        }
        const label = grouped ? 'group' : 'friends';
        refused(result, NOT_CLEAN);
        assert.ok(committed, label);
        // Only the taxi is saved: the import's write failed to serialize, and the retry saw it.
        assert.deepEqual(
          (await run.balances([me.id, bo.id])).sort(),
          [`USD ${bo.id}->${me.id} 300`, `USD ${me.id}->${bo.id} -300`].sort(),
          label,
        );
        assert.equal(
          await run.db.expense.count({
            where: { splitwiseExpenseId: { not: null }, addedBy: me.id },
          }),
          0,
          label,
        );
      } finally {
        await run.cleanUp();
      }
    }
  },
);

/** Imports one Ada/Bo expense into a group, and returns it with the people. */
const importedExpenseOf = async (t: Setup) => {
  const me = await t.createUser('Ada');
  const bo = await t.createUser('Bo');
  const cy = await t.createUser('Cy');
  await t.befriend(me, bo, cy);
  const gid = t.base + 2700;
  const [ada, swBo, swCy] = [t.sw('Ada', 1), t.sw('Bo', 2), t.sw('Cy', 3)];
  const file = buildExport({
    me: ada,
    people: [swBo, swCy],
    groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, swBo.id, swCy.id] }],
    expenses: [
      expense({
        id: t.base + 27001,
        groupId: gid,
        users: [
          [ada.id, 2000, 1000],
          [swBo.id, 0, 1000],
        ],
      }),
    ],
  });
  imported((await t.importFile(me, file)).results[`group:${gid}`]);
  const row = await t.db.expense.findFirstOrThrow({
    where: { splitwiseExpenseId: String(t.base + 27001) },
  });
  assert.equal(row.splitwiseEdited, false, 'the import leaves it untouched');
  return { me, bo, cy, ada, swBo, swCy, gid, file, row };
};

/** Another Splitwise group of Ada and `other`, Ada paid 20, half for them. */
const otherScopeFile = (t: Setup, other: Person, gid: number, id: number) => {
  const ada = t.sw('Ada', 1);
  return buildExport({
    me: ada,
    people: [other],
    groups: [{ id: gid, name: `Other ${gid}`, memberIds: [ada.id, other.id] }],
    expenses: [
      expense({
        id,
        groupId: gid,
        users: [
          [ada.id, 2000, 1000],
          [other.id, 0, 1000],
        ],
      }),
    ],
  });
};

void test(
  "r6: an imported expense changed in SplitPro in any way counts as SplitPro history (Sol's edited-imported probes)",
  { skip: !databaseUrl },
  async () => {
    const svc = await import('~/server/api/services/splitService');
    type Imported = Awaited<ReturnType<typeof importedExpenseOf>>;
    const cases: [string, (t: Setup, i: Imported) => Promise<unknown>, 'Bo' | 'Cy'][] = [
      [
        'Bo replaced by Cy',
        (_t, i) =>
          svc.editExpense(
            i.row.id,
            i.me.id,
            'Edited',
            'general',
            20,
            'EXACT',
            'USD',
            [
              { userId: i.me.id, amount: 10 },
              { userId: i.cy.id, amount: -10 },
            ],
            i.me.id,
            DATE,
          ),
        'Cy',
      ],
      [
        'turned into a settle up',
        (_t, i) =>
          svc.editExpense(
            i.row.id,
            i.bo.id,
            'Paid',
            'general',
            10,
            'SETTLEMENT',
            'USD',
            [
              { userId: i.bo.id, amount: 10 },
              { userId: i.me.id, amount: -10 },
            ],
            i.bo.id,
            DATE,
          ),
        'Bo',
      ],
      [
        'currency changed',
        (_t, i) =>
          svc.editExpense(
            i.row.id,
            i.me.id,
            'In euros',
            'general',
            20,
            'EXACT',
            'EUR',
            [
              { userId: i.me.id, amount: 10 },
              { userId: i.bo.id, amount: -10 },
            ],
            i.me.id,
            DATE,
          ),
        'Bo',
      ],
      [
        'name changed only',
        (t, i) => t.db.expense.update({ where: { id: i.row.id }, data: { name: 'Renamed' } }),
        'Bo',
      ],
      ['deleted', (_t, i) => svc.deleteExpense(i.row.id, i.me.id), 'Bo'],
      [
        'deleted and restored',
        async (t, i) => {
          await svc.deleteExpense(i.row.id, i.me.id);
          // No restore in the app yet; any future one is an update like this.
          await t.db.expense.update({
            where: { id: i.row.id },
            data: { deletedAt: null, deletedBy: null },
          });
          await t.db.balance.updateMany({
            where: { userId: i.me.id, friendId: i.bo.id, currency: 'USD' },
            data: { amount: { increment: 1000 } },
          });
          await t.db.balance.updateMany({
            where: { userId: i.bo.id, friendId: i.me.id, currency: 'USD' },
            data: { amount: { increment: -1000 } },
          });
        },
        'Bo',
      ],
      [
        'a participant added directly',
        (t, i) =>
          t.db.expenseParticipant.create({
            data: { expenseId: i.row.id, userId: i.cy.id, amount: 0 },
          }),
        'Bo',
      ],
      [
        'a participant removed directly',
        (t, i) =>
          t.db.expenseParticipant.deleteMany({ where: { expenseId: i.row.id, userId: i.me.id } }),
        'Bo',
      ],
      [
        'a participant amount changed directly',
        (t, i) =>
          t.db.expenseParticipant.updateMany({
            where: { expenseId: i.row.id, userId: i.bo.id },
            data: { amount: -1000 },
          }),
        'Bo',
      ],
    ];
    for (const [label, change, other] of cases) {
      const run = await fresh();
      try {
        const i = await importedExpenseOf(run);
        await change(run, i);
        assert.equal(
          (await run.db.expense.findUniqueOrThrow({ where: { id: i.row.id } })).splitwiseEdited,
          true,
          label,
        );
        const otherSw = 'Bo' === other ? i.swBo : i.swCy;
        const otherId = 'Bo' === other ? i.bo.id : i.cy.id;
        const before = await run.snapshot();
        // Another Splitwise scope with the same pair: refused, it's SplitPro history now.
        const g2 = run.base + 2701;
        const result = (
          await run.importFile(i.me, otherScopeFile(run, otherSw, g2, run.base + 27002))
        ).results[`group:${g2}`];
        refused(result, new RegExp(`You and ${other} already have expenses, payments or balances`));
        // The same scope again: refused with a clear reason, not skipped.
        const again = (await run.importFile(i.me, i.file)).results[`group:${i.gid}`];
        refused(again, /(changed|deleted) in SplitPro after it was imported/);
        assert.deepEqual(await run.snapshot(), before, label);
        void otherId;
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'r6: imported expenses stay untouched through a stopped and resumed import, so the scope imports again as a no-op',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const { IMPORT_BATCH_SIZE } = await import('~/server/api/services/splitwiseImport');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [ada, swBo] = [t.sw('Ada', 1), t.sw('Bo', 2)];
    const file = buildExport({
      me: ada,
      people: [swBo],
      groups: [],
      expenses: Array.from({ length: IMPORT_BATCH_SIZE + 10 }, (_, index) =>
        expense({
          id: t.base + 28_000 + index,
          users: [
            [ada.id, 200, 100],
            [swBo.id, 0, 100],
          ],
        }),
      ),
    });
    const key = `friends:${swBo.id}`;
    // The second batch fails once; the first stays saved.
    const hook = hookTransactions(t, async (n, go) => {
      if (3 === n) {
        hook.restore();
        throw new Error('dropped connection');
      }
      return go();
    });
    try {
      assert.equal((await t.importFile(me, file)).results[key]!.status, 'partial');
    } finally {
      hook.restore();
    }
    imported((await t.importFile(me, file)).results[key]);
    const again = imported((await t.importFile(me, file)).results[key]);
    assert.equal(again.imported, 0);
    assert.equal(
      await t.db.expense.count({
        where: { splitwiseExpenseId: { startsWith: String(t.base + 28) }, splitwiseEdited: true },
      }),
      0,
    );
  }),
);

void test(
  "r6: two accounts whose emails differ only in capitals are refused, for a friend and for you (Sol's case alias)",
  { skip: !databaseUrl },
  async () => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    // A friend: invited as BO@... with a debt, then as bo@..., through the real router.
    {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const swBo = run.sw('Bo', 2);
        const upper = await run
          .callerFor(me)
          .user.inviteFriend({ email: swBo.email!.toUpperCase() });
        await addUserExpense(
          me.id,
          'Dinner',
          'general',
          20,
          'EXACT',
          'USD',
          [
            { userId: me.id, amount: 10 },
            { userId: upper.id, amount: -10 },
          ],
          me.id,
          DATE,
        );
        const lower = await run.callerFor(me).user.inviteFriend({ email: swBo.email! });
        assert.notEqual(upper.id, lower.id);
        const { file, key } = twoPeopleFile(run);
        const before = await run.snapshot();
        const result = (await run.importFile(me, file)).results[key];
        refused(result, /More than one SplitPro account uses the email address of Bo/);
        refused(result, /It isn't clear which account has the SplitPro history/);
        assert.deepEqual(await run.snapshot(), before);
      } finally {
        await run.cleanUp();
      }
    }
    // You: another account uses your email with other capitals.
    {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        await run.db.user.create({
          data: { email: ` ${me.email!.toUpperCase()} `, name: 'Ada again' },
        });
        const { file, key } = twoPeopleFile(run);
        refused(
          (await run.importFile(me, file)).results[key],
          /More than one SplitPro account uses your email address/,
        );
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'r6: a second account with the same email made after the checks stops the setup or a batch',
  { skip: !databaseUrl },
  async () => {
    const { IMPORT_BATCH_SIZE } = await import('~/server/api/services/splitwiseImport');
    for (const at of [1, 3]) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        const [ada, swBo] = [run.sw('Ada', 1), run.sw('Bo', 2)];
        const file = buildExport({
          me: ada,
          people: [swBo],
          groups: [],
          expenses: Array.from({ length: IMPORT_BATCH_SIZE + 10 }, (_, index) =>
            expense({
              id: run.base + 29_000 + index,
              users: [
                [ada.id, 200, 100],
                [swBo.id, 0, 100],
              ],
            }),
          ),
        });
        const hook = hookTransactions(run, async (n, go) => {
          if (at === n) {
            hook.restore();
            await run.db.user.create({
              data: { email: bo.email!.toUpperCase(), name: 'Bo again' },
            });
          }
          return go();
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[`friends:${swBo.id}`];
        } finally {
          hook.restore();
        }
        if (1 === at) {
          refused(result, /More than one SplitPro account uses the email address of Bo/);
        } else {
          assert.equal(result?.status, 'partial', JSON.stringify(result));
          assert.equal((result as { imported: number }).imported, IMPORT_BATCH_SIZE);
          assert.match(
            (result as { reason: string }).reason,
            /More than one SplitPro account uses the email address of Bo/,
          );
        }
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'r6: an account matched ignoring capitals and spaces is the one every rule checks',
  { skip: !databaseUrl },
  async () => {
    const { addUserExpense } = await import('~/server/api/services/splitService');
    const cases: [
      string,
      (run: Setup, me: { id: number }, bo: { id: number }) => Promise<unknown>,
      RegExp,
    ][] = [
      [
        'clean slate',
        (_run, me, bo) =>
          addUserExpense(
            me.id,
            'Dinner',
            'general',
            20,
            'EXACT',
            'USD',
            [
              { userId: me.id, amount: 10 },
              { userId: bo.id, amount: -10 },
            ],
            me.id,
            DATE,
          ),
        /You and Bo already have expenses, payments or balances/,
      ],
      [
        'person rule',
        (run, _me, bo) =>
          run.db.splitwiseImportPerson.create({ data: { userId: bo.id, mode: 'BALANCE' } }),
        /Bo has balances from an earlier Splitwise import/,
      ],
      [
        'connection rule',
        (run, me, bo) =>
          run.db.friendship.deleteMany({
            where: {
              OR: [
                { userId: me.id, friendId: bo.id },
                { userId: bo.id, friendId: me.id },
              ],
            },
          }),
        /Bo already uses SplitPro but isn't connected to you/,
      ],
    ];
    for (const [label, prepare, reason] of cases) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        // Bo's account has the email in other capitals, with spaces around it.
        const swBo = run.sw('Bo', 2);
        const bo = await run.db.user.create({
          data: { email: `  ${swBo.email!.toUpperCase()} `, name: 'Bo' },
        });
        await run.befriend(me, bo);
        await prepare(run, me, bo);
        const { file, key } = twoPeopleFile(run);
        const before = await run.snapshot();
        refused((await run.importFile(me, file)).results[key], reason);
        assert.deepEqual(await run.snapshot(), before, label);
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'r6: the setup refuses before creating anything when history appeared after the checks, or a second account with the same email',
  { skip: !databaseUrl },
  async () => {
    const variants: [
      string,
      (
        run: Setup,
        me: { id: number; name: string | null; email: string | null },
        bo: { id: number; email: string | null },
      ) => Promise<unknown>,
      RegExp,
    ][] = [
      [
        // Invisible to the row comparison: the rows are absent again afterwards.
        'history',
        async (run, me, bo) => {
          await enterAndSettle(run, me, bo);
          await run.callerFor(me).user.deleteFriend({ friendId: bo.id });
        },
        /You and Bo already have expenses, payments or balances in SplitPro/,
      ],
      [
        'same email',
        (run, _me, bo) =>
          run.db.user.create({ data: { email: bo.email!.toUpperCase(), name: 'Bo again' } }),
        /More than one SplitPro account uses the email address of Bo/,
      ],
    ];
    for (const [label, inject, reason] of variants) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        const bo = await run.createUser('Bo');
        await run.befriend(me, bo);
        // Cy has no account yet: the setup would make one, and the group.
        const [ada, swBo, swCy] = [run.sw('Ada', 1), run.sw('Bo', 2), run.sw('Cy', 3)];
        const gid = run.base + 3000;
        const file = buildExport({
          me: ada,
          people: [swBo, swCy],
          groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, swBo.id, swCy.id] }],
          expenses: [
            expense({
              id: run.base + 30_001,
              groupId: gid,
              users: [
                [ada.id, 3000, 1000],
                [swBo.id, 0, 1000],
                [swCy.id, 0, 1000],
              ],
            }),
          ],
        });
        const hook = hookTransactions(run, async (n, go) => {
          if (1 === n) {
            hook.restore();
            await inject(run, me, bo);
          }
          return go();
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[`group:${gid}`];
        } finally {
          hook.restore();
        }
        refused(result, reason);
        assert.equal(
          await run.db.group.count({ where: { splitwiseGroupId: String(gid) } }),
          0,
          `${label}: no group`,
        );
        assert.equal(
          await run.db.user.count({
            where: { email: { equals: swCy.email!, mode: 'insensitive' } },
          }),
          0,
          `${label}: no account for Cy`,
        );
      } finally {
        await run.cleanUp();
      }
    }
  },
);

void test(
  'r6: rows rewritten to the same amounts mid-import (a group that nets to zero, then deleted) stop the next batch; only row versions show it',
  { skip: !databaseUrl },
  withSetup(async (t) => {
    const svc = await import('~/server/api/services/splitService');
    const { IMPORT_BATCH_SIZE } = await import('~/server/api/services/splitwiseImport');
    const me = await t.createUser('Ada');
    const bo = await t.createUser('Bo');
    await t.befriend(me, bo);
    const [ada, swBo] = [t.sw('Ada', 1), t.sw('Bo', 2)];
    const count = IMPORT_BATCH_SIZE + 50;
    const file = buildExport({
      me: ada,
      people: [swBo],
      groups: [],
      expenses: Array.from({ length: count }, (_, index) =>
        expense({
          id: t.base + 27_000 + index,
          users: [
            [ada.id, 200, 100],
            [swBo.id, 0, 100],
          ],
        }),
      ),
    });
    const key = `friends:${swBo.id}`;

    // After the first batch: each pays 20 for both in a group, which nets to zero, and the group
    // is deleted with its expenses. No history is left and the amounts are as they were, but the
    // Balance rows were written.
    const hook = hookTransactions(t, async (n, run) => {
      if (3 === n) {
        hook.restore();
        const group = await t.callerFor(me).group.create({ name: 'Even', currency: 'USD' });
        await t.callerFor(bo).group.joinGroup({ groupId: group.publicId });
        const add = (payer: number, other: number) =>
          svc.createGroupExpense(
            group.id,
            payer,
            'Even',
            'general',
            20,
            'EXACT',
            'USD',
            [
              { userId: payer, amount: 10 },
              { userId: other, amount: -10 },
            ],
            payer,
            DATE,
          );
        const before = await t.balances([me.id, bo.id]);
        await add(me.id, bo.id);
        await add(bo.id, me.id);
        await t.callerFor(me).group.delete({ groupId: group.id });
        assert.deepEqual(await t.balances([me.id, bo.id]), before, 'same amounts');
        assert.equal(
          await t.db.expense.count({ where: { name: 'Even', paidBy: { in: [me.id, bo.id] } } }),
          0,
          'no history left',
        );
      }
      return run();
    });
    let first;
    try {
      first = (await t.importFile(me, file)).results[key];
    } finally {
      hook.restore();
    }
    assert.deepEqual(first, {
      status: 'partial',
      imported: IMPORT_BATCH_SIZE,
      remaining: 50,
      alreadyImported: 0,
      reason: 'Balances changed during the import. Please run it again.',
    });

    // Nothing of it is left, so a new import starts from a clean slate and finishes consistently.
    const second = imported((await t.importFile(me, file)).results[key]);
    assert.equal(second.imported, 50);
    assert.deepEqual(await unexplainedAmong(t, [me.id, bo.id]), []);
  }),
);

void test(
  'r6: someone who signs up between the checks and the setup is checked by the setup itself, before anything is created',
  { skip: !databaseUrl },
  async () => {
    const variants: [
      string,
      (
        run: Setup,
        me: { id: number; name: string | null; email: string | null },
      ) => Promise<unknown>,
      RegExp,
    ][] = [
      [
        // History between them, the rows gone again: the history check sees it.
        'history',
        async (run, me) => {
          const bo = await run.createUser('Bo');
          await run.befriend(me, bo);
          await enterAndSettle(run, me, bo);
          await run.callerFor(me).user.deleteFriend({ friendId: bo.id });
        },
        /You and Bo already have expenses, payments or balances in SplitPro/,
      ],
      [
        // A row with nothing behind it: the preflight snapshot has no rows for Bo, so it appeared.
        'unexplained row',
        async (run, me) => {
          const bo = await run.createUser('Bo');
          await run.db.balance.createMany({
            data: [
              { userId: me.id, friendId: bo.id, currency: 'USD', amount: 0 },
              { userId: bo.id, friendId: me.id, currency: 'USD', amount: 0 },
            ],
          });
        },
        /Balances changed during the import/,
      ],
    ];
    for (const [label, inject, reason] of variants) {
      const run = await fresh();
      try {
        const me = await run.createUser('Ada');
        // Neither Bo nor Cy has an account when the import checks.
        const [ada, swBo, swCy] = [run.sw('Ada', 1), run.sw('Bo', 2), run.sw('Cy', 3)];
        const gid = run.base + 3100;
        const file = buildExport({
          me: ada,
          people: [swBo, swCy],
          groups: [{ id: gid, name: 'Trip', memberIds: [ada.id, swBo.id, swCy.id] }],
          expenses: [
            expense({
              id: run.base + 31_001,
              groupId: gid,
              users: [
                [ada.id, 3000, 1000],
                [swBo.id, 0, 1000],
                [swCy.id, 0, 1000],
              ],
            }),
          ],
        });
        const hook = hookTransactions(run, async (n, go) => {
          if (1 === n) {
            hook.restore();
            await inject(run, me);
          }
          return go();
        });
        let result;
        try {
          result = (await run.importFile(me, file)).results[`group:${gid}`];
        } finally {
          hook.restore();
        }
        refused(result, reason);
        assert.equal(
          await run.db.group.count({ where: { splitwiseGroupId: String(gid) } }),
          0,
          `${label}: no group`,
        );
        assert.equal(
          await run.db.user.count({
            where: { email: { equals: swCy.email!, mode: 'insensitive' } },
          }),
          0,
          `${label}: no account for Cy`,
        );
        assert.equal(
          await run.db.expense.count({ where: { splitwiseExpenseId: String(run.base + 31_001) } }),
          0,
          label,
        );
      } finally {
        await run.cleanUp();
      }
    }
  },
);
