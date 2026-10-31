import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ SplitType }, { db }, { appRouter }, store] = await Promise.all([
    import('@prisma/client'),
    import('~/server/db'),
    import('~/server/api/root'),
    import('~/store/addStore'),
  ]);
  const suffix = `${Date.now()}-${Math.random()}`;
  // One at a time, so ids follow the order of `names`. Today's rounding puts the remainder on the
  // lowest ids, and the legacy case needs it to differ from the stored distribution.
  const createUsers = async (names: string[]) => {
    const users: Awaited<ReturnType<typeof db.user.create>>[] = [];
    for (const name of names) {
      users.push(
        await db.user.create({
          data: { name, email: `${name.toLowerCase()}-${suffix}@example.com` },
        }),
      );
    }
    return users;
  };
  const callerFor = (user: { id: number; name: string | null; email: string | null }) =>
    appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });
  const snapshotBalances = async (userIds: number[]) =>
    (
      await db.balance.findMany({
        where: { userId: { in: userIds } },
        orderBy: [{ userId: 'asc' }, { friendId: 'asc' }, { currency: 'asc' }],
      })
    ).map(({ userId, friendId, currency, amount }) => ({ userId, friendId, currency, amount }));
  const getRows = async (expenseId: string) =>
    (
      await db.expenseParticipant.findMany({ where: { expenseId }, orderBy: { userId: 'asc' } })
    ).map(({ userId, amount }) => ({ userId, amount }));
  const cleanUp = async (userIds: number[], groupIds: number[]) => {
    store.useAddExpenseStore.getState().actions.resetState();
    await db.expense.deleteMany({ where: { addedBy: { in: userIds } } });
    await db.group.deleteMany({ where: { id: { in: groupIds } } });
    await db.balance.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  };
  // What the add page sends when Save is pressed.
  const getSaveInput = () => {
    const state = store.useAddExpenseStore.getState();
    return {
      paidBy: state.paidBy!.id,
      name: state.description,
      category: state.category,
      amount: state.amount,
      splitType: state.splitType,
      currency: state.currency,
      participants: store
        .getParticipantsToSave(state)
        .map((participant) => ({ userId: participant.id, amount: participant.amount ?? 0 })),
    };
  };

  return {
    SplitType,
    db,
    store,
    suffix,
    createUsers,
    callerFor,
    snapshotBalances,
    getRows,
    cleanUp,
    getSaveInput,
  };
};

void test(
  'an expense saved with an older cent distribution keeps its cents after split type switches',
  { skip: !databaseUrl },
  async () => {
    const {
      db,
      store,
      suffix,
      createUsers,
      callerFor,
      snapshotBalances,
      getRows,
      cleanUp,
      getSaveInput,
    } = await setup();
    const users = await createUsers(['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = users;
    assert.ok(alice && bob && carol);
    const userIds = users.map((user) => user.id);
    const caller = callerFor(alice);
    const groupIds: number[] = [];

    const load = async (expenseId: string) => {
      store.useAddExpenseStore.getState().actions.resetState();
      store.useAddExpenseStore.setState({
        ...store.getEditFormState(await caller.user.getExpenseDetails({ expenseId })),
        currentUser: alice,
      });
    };

    try {
      // 10.00 split equally, with the payer's extra cent where an older client put it.
      const legacy = await db.expense.create({
        data: {
          name: 'Legacy thirds',
          category: 'general',
          currency: 'USD',
          amount: 1000,
          paidBy: carol.id,
          addedBy: alice.id,
          expenseDate: new Date(),
          splitType: 'EQUAL',
          expenseParticipants: {
            create: [
              { userId: alice.id, amount: -333 },
              { userId: bob.id, amount: -333 },
              { userId: carol.id, amount: 666 },
            ],
          },
        },
      });
      await db.balance.createMany({
        data: [
          { userId: alice.id, friendId: carol.id, currency: 'USD', amount: -333 },
          { userId: carol.id, friendId: alice.id, currency: 'USD', amount: 333 },
          { userId: bob.id, friendId: carol.id, currency: 'USD', amount: -333 },
          { userId: carol.id, friendId: bob.id, currency: 'USD', amount: 333 },
        ],
      });
      const before = await snapshotBalances(userIds);
      const legacyRows = await getRows(legacy.id);

      await load(legacy.id);
      await caller.user.addOrEditExpense({ ...getSaveInput(), expenseId: legacy.id });
      assert.deepEqual(await getRows(legacy.id), legacyRows, 'saved unchanged');
      assert.deepEqual(await snapshotBalances(userIds), before, 'saved unchanged');

      await load(legacy.id);
      const { setSplitType, setPaidBy } = store.useAddExpenseStore.getState().actions;
      setSplitType('SHARE');
      setSplitType('EQUAL');
      setPaidBy(carol);
      await caller.user.addOrEditExpense({ ...getSaveInput(), expenseId: legacy.id });
      assert.deepEqual(await getRows(legacy.id), legacyRows, 'equal -> share -> equal');
      assert.deepEqual(await snapshotBalances(userIds), before, 'equal -> share -> equal');

      // An old group expense without the payer's row, paid by someone who has left the group.
      const group = await db.group.create({
        data: {
          name: 'Old group',
          publicId: `old-${suffix}`,
          userId: alice.id,
          groupUsers: { create: [{ userId: alice.id }, { userId: bob.id }] },
        },
      });
      groupIds.push(group.id);
      const old = await db.expense.create({
        data: {
          groupId: group.id,
          name: 'Missing departed payer',
          category: 'general',
          currency: 'EUR',
          amount: 3000,
          paidBy: carol.id,
          addedBy: alice.id,
          expenseDate: new Date(),
          splitType: 'EQUAL',
          expenseParticipants: {
            create: [
              { userId: alice.id, amount: -1000 },
              { userId: bob.id, amount: -1000 },
            ],
          },
        },
      });
      const eurBalances = [alice, bob].flatMap((user) => [
        { userId: user.id, friendId: carol.id, currency: 'EUR', amount: -1000 },
        { userId: carol.id, friendId: user.id, currency: 'EUR', amount: 1000 },
      ]);
      await db.balance.createMany({ data: eurBalances });
      await db.groupBalance.createMany({
        data: eurBalances.map(({ userId, friendId, currency, amount }) => ({
          groupId: group.id,
          userId,
          firendId: friendId,
          currency,
          amount,
        })),
      });
      const oldBefore = await snapshotBalances(userIds);

      await load(old.id);
      await caller.group.addOrEditExpense({
        ...getSaveInput(),
        expenseId: old.id,
        groupId: group.id,
        name: 'Renamed',
      });
      assert.deepEqual(await snapshotBalances(userIds), oldBefore, 'missing payer row');
      assert.deepEqual(
        await getRows(old.id),
        [
          { userId: alice.id, amount: -1000 },
          { userId: bob.id, amount: -1000 },
          { userId: carol.id, amount: 2000 },
        ].sort((a, b) => a.userId - b.userId),
      );
    } finally {
      await cleanUp(userIds, groupIds);
    }
  },
);

void test(
  'a friend picked as payer while their invite is pending is saved as the payer',
  { skip: !databaseUrl },
  async () => {
    const { db, store, createUsers, callerFor, cleanUp, getSaveInput } = await setup();
    const users = await createUsers(['Alice', 'Bob']);
    const [alice, bob] = users;
    assert.ok(alice && bob);
    const caller = callerFor(alice);
    const { actions } = store.useAddExpenseStore.getState();

    try {
      actions.setCurrentUser(alice);
      actions.resetState();
      let finish!: () => Promise<void>;
      const pending = store.inviteParticipant(
        bob.email!,
        (email) =>
          new Promise((resolve) => {
            finish = async () => resolve(await caller.user.inviteFriend({ email }));
          }),
      );
      actions.setNameOrEmail('');
      actions.setDescription('Bob paid dinner');
      actions.setAmount(100);
      actions.setPaidBy(
        store.useAddExpenseStore.getState().participants.find(store.isPendingInvite)!,
      );
      await finish();
      await pending;

      const saved = await caller.user.addOrEditExpense(getSaveInput());
      const expense = await db.expense.findUnique({ where: { id: saved.id } });
      assert.equal(expense?.paidBy, bob.id);
      const balance = await db.balance.findUnique({
        where: {
          userId_currency_friendId: { userId: alice.id, currency: 'USD', friendId: bob.id },
        },
      });
      assert.equal(balance?.amount, -5000);
    } finally {
      await cleanUp(
        users.map((user) => user.id),
        [],
      );
    }
  },
);

void test(
  'two overlapping invites both end up in the saved expense, whichever returns first',
  { skip: !databaseUrl },
  async () => {
    const { db, store, createUsers, callerFor, cleanUp, getSaveInput } = await setup();
    const users = await createUsers(['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = users;
    assert.ok(alice && bob && carol);
    const caller = callerFor(alice);
    const { actions } = store.useAddExpenseStore.getState();
    // An invite that only reaches the server when `finish` is called.
    const startInvite = (email: string) => {
      let finish!: () => Promise<void>;
      const pending = store.inviteParticipant(
        email,
        (input) =>
          new Promise((resolve) => {
            finish = async () => resolve(await caller.user.inviteFriend({ email: input }));
          }),
      );
      return { pending, finish: () => finish() };
    };

    try {
      actions.setCurrentUser(alice);
      actions.resetState();
      // Bob with Enter, then Carol with "Add to Split Pro" while Bob is pending. Carol returns first.
      const bobInvite = startInvite(bob.email!);
      const carolInvite = startInvite(carol.email!);
      await carolInvite.finish();
      await carolInvite.pending;
      assert.ok(store.useAddExpenseStore.getState().participants.some(store.isPendingInvite));
      await bobInvite.finish();
      await bobInvite.pending;

      actions.setAmount(100);
      actions.setDescription('Bob and Carol should both share');
      const state = store.useAddExpenseStore.getState();
      assert.equal(state.participants.some(store.isPendingInvite), false);

      const saved = await caller.user.addOrEditExpense(getSaveInput());
      const rows = await db.expenseParticipant.findMany({
        where: { expenseId: saved.id },
        orderBy: { userId: 'asc' },
      });
      assert.deepEqual(
        rows.map(({ userId, amount }) => ({ userId, amount })),
        [
          { userId: alice.id, amount: 6666 },
          { userId: bob.id, amount: -3333 },
          { userId: carol.id, amount: -3333 },
        ],
      );
      const balances = await db.balance.findMany({
        where: { userId: alice.id },
        orderBy: { friendId: 'asc' },
      });
      assert.deepEqual(
        balances.map(({ friendId, amount }) => ({ friendId, amount })),
        [
          { friendId: bob.id, amount: 3333 },
          { friendId: carol.id, amount: 3333 },
        ],
      );
    } finally {
      await cleanUp(
        users.map((user) => user.id),
        [],
      );
    }
  },
);

void test(
  'renaming an expense with a deleted account at no share keeps their row and the balances',
  { skip: !databaseUrl },
  async () => {
    const { db, store, createUsers, callerFor, snapshotBalances, getRows, cleanUp, getSaveInput } =
      await setup();
    const users = await createUsers(['Alice', 'Bob', 'Carol', 'Dave']);
    const [alice, bob, carol, dave] = users;
    assert.ok(alice && bob && carol && dave);
    const userIds = users.map((user) => user.id);
    const caller = callerFor(alice);

    const load = async (expenseId: string) => {
      store.useAddExpenseStore.getState().actions.resetState();
      store.useAddExpenseStore.setState({
        ...store.getEditFormState(await caller.user.getExpenseDetails({ expenseId })),
        currentUser: alice,
      });
    };
    const createExpense = async (name: string, currency: string, shares: [number, number][]) => {
      const expense = await db.expense.create({
        data: {
          name,
          category: 'general',
          currency,
          amount: 1000,
          paidBy: alice.id,
          addedBy: alice.id,
          expenseDate: new Date(),
          splitType: 'EXACT',
          expenseParticipants: {
            create: shares.map(([userId, amount]) => ({ userId, amount })),
          },
        },
      });
      await db.balance.createMany({
        data: shares
          .filter(([userId, amount]) => userId !== alice.id && 0 !== amount)
          .flatMap(([userId, amount]) => [
            { userId, friendId: alice.id, currency, amount },
            { userId: alice.id, friendId: userId, currency, amount: -amount },
          ]),
      });
      return expense;
    };

    try {
      // Dave was in both with nothing to pay, then deleted his account
      const current = await createExpense('Current', 'USD', [
        [alice.id, 500],
        [bob.id, -500],
        [dave.id, 0],
      ]);
      // An old client's rounding put 4 cents too many on the payer: fine across four rows, more
      // than today's validation allows across the three left without Dave's
      const legacy = await createExpense('Legacy', 'EUR', [
        [alice.id, 670],
        [bob.id, -333],
        [carol.id, -333],
        [dave.id, 0],
      ]);
      await db.user.update({
        where: { id: dave.id },
        data: { name: 'Deleted user', email: null, deletedAt: new Date() },
      });
      const before = await snapshotBalances(userIds);

      for (const expense of [current, legacy]) {
        const rows = await getRows(expense.id);
        await load(expense.id);
        await caller.user.addOrEditExpense({
          ...getSaveInput(),
          expenseId: expense.id,
          name: 'Renamed',
        });

        assert.deepEqual(await getRows(expense.id), rows, expense.name);
        assert.equal(
          (await db.expense.findUniqueOrThrow({ where: { id: expense.id } })).name,
          'Renamed',
        );
      }
      assert.deepEqual(await snapshotBalances(userIds), before);
    } finally {
      await cleanUp(userIds, []);
    }
  },
);
