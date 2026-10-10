import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ SplitType }, { db }, splitService, { appRouter }] = await Promise.all([
    import('@prisma/client'),
    import('~/server/db'),
    import('~/server/api/services/splitService'),
    import('~/server/api/root'),
  ]);
  const suffix = `${Date.now()}-${Math.random()}`;

  const createUser = (name: string) =>
    db.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name } });

  const createGroup = async (name: string, ownerId: number, memberIds: number[]) => {
    const group = await db.group.create({
      data: { name, publicId: `${name.toLowerCase()}-${suffix}`, userId: ownerId },
    });
    await db.groupUser.createMany({
      data: memberIds.map((userId) => ({ groupId: group.id, userId })),
    });
    return group;
  };

  const callerFor = (user: { id: number; name: string | null; email: string | null }) =>
    appRouter.createCaller({
      db,
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });

  const getBalance = async (userId: number, friendId: number, currency = 'USD') =>
    (
      await db.balance.findUnique({
        where: { userId_currency_friendId: { userId, currency, friendId } },
      })
    )?.amount ?? 0;

  const getGroupBalance = async (
    groupId: number,
    userId: number,
    friendId: number,
    currency = 'USD',
  ) =>
    (
      await db.groupBalance.findUnique({
        where: {
          groupId_currency_firendId_userId: { groupId, currency, userId, firendId: friendId },
        },
      })
    )?.amount ?? 0;

  /** Every Balance and GroupBalance row of these users has an exact mirror. */
  const assertMirrored = async (userIds: number[]) => {
    const [balances, groupBalances] = await Promise.all([
      db.balance.findMany({
        where: { OR: [{ userId: { in: userIds } }, { friendId: { in: userIds } }] },
      }),
      db.groupBalance.findMany({
        where: { OR: [{ userId: { in: userIds } }, { firendId: { in: userIds } }] },
      }),
    ]);
    const balanceAmounts = new Map(
      balances.map((b) => [`${b.currency}:${b.userId}:${b.friendId}`, b.amount]),
    );
    balances.forEach((b) => {
      assert.equal(
        balanceAmounts.get(`${b.currency}:${b.friendId}:${b.userId}`) ?? 0,
        0 - b.amount,
        `Balance ${b.userId}->${b.friendId} is not mirrored`,
      );
    });
    const groupAmounts = new Map(
      groupBalances.map((b) => [`${b.groupId}:${b.currency}:${b.userId}:${b.firendId}`, b.amount]),
    );
    groupBalances.forEach((b) => {
      assert.equal(
        groupAmounts.get(`${b.groupId}:${b.currency}:${b.firendId}:${b.userId}`) ?? 0,
        0 - b.amount,
        `GroupBalance ${b.userId}->${b.firendId} in group ${b.groupId} is not mirrored`,
      );
    });
  };

  const cleanUp = async (groupIds: number[], userIds: number[]) => {
    await db.group.deleteMany({ where: { id: { in: groupIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  };

  return {
    SplitType,
    db,
    ...splitService,
    createUser,
    createGroup,
    callerFor,
    getBalance,
    getGroupBalance,
    assertMirrored,
    cleanUp,
  };
};

void test(
  'group settlements move Balance and GroupBalance together, and edit and delete reverse them',
  { skip: !databaseUrl },
  async () => {
    const {
      SplitType,
      db,
      addUserExpense,
      createGroupExpense,
      deleteExpense,
      createUser,
      createGroup,
      callerFor,
      getBalance,
      getGroupBalance,
      assertMirrored,
      cleanUp,
    } = await setup();
    const [alice, bob, carol] = await Promise.all([
      createUser('Alice'),
      createUser('Bob'),
      createUser('Carol'),
    ]);
    const userIds = [alice.id, bob.id, carol.id];
    const trip = await createGroup('Trip', alice.id, userIds);

    // Bob owes Alice 10 in the trip and 20 outside any group.
    await createGroupExpense(
      trip.id,
      alice.id,
      'Dinner',
      'food',
      30,
      SplitType.EQUAL,
      'USD',
      [
        { userId: alice.id, amount: 20 },
        { userId: bob.id, amount: -10 },
        { userId: carol.id, amount: -10 },
      ],
      alice.id,
      new Date('2026-01-01'),
    );
    await addUserExpense(
      alice.id,
      'Tickets',
      'general',
      20,
      SplitType.EXACT,
      'USD',
      [
        { userId: alice.id, amount: 20 },
        { userId: bob.id, amount: -20 },
      ],
      alice.id,
      new Date('2026-01-01'),
    );
    assert.equal(await getBalance(alice.id, bob.id), 3000);
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), 1000);

    const settle = (amount: number, expenseId?: string) =>
      callerFor(bob).group.addOrEditExpense({
        groupId: trip.id,
        expenseId,
        name: 'Settle up',
        category: 'general',
        amount,
        splitType: SplitType.SETTLEMENT,
        currency: 'USD',
        paidBy: bob.id,
        participants: [
          { userId: bob.id, amount },
          { userId: alice.id, amount: -amount },
        ],
      });

    // A partial payment only reduces the trip part, on both tables.
    const settlement = await settle(4);
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), 600);
    assert.equal(await getGroupBalance(trip.id, bob.id, alice.id), -600);
    assert.equal(await getBalance(alice.id, bob.id), 2600);
    assert.equal(await getGroupBalance(trip.id, alice.id, carol.id), 1000);
    await assertMirrored(userIds);

    const stored = await db.expense.findUniqueOrThrow({
      where: { id: settlement.id },
      include: { expenseParticipants: true },
    });
    assert.equal(stored.groupId, trip.id);
    assert.equal(stored.settlementAllocationVersion, null);
    assert.equal(
      await db.settlementAllocation.count({ where: { settlementExpenseId: settlement.id } }),
      0,
    );

    // Editing to the full amount clears the trip without touching the rest.
    await settle(10, settlement.id);
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), 0);
    assert.equal(await getBalance(alice.id, bob.id), 2000);
    await assertMirrored(userIds);

    // Paying too much flips the trip balance.
    await settle(15, settlement.id);
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), -500);
    assert.equal(await getGroupBalance(trip.id, bob.id, alice.id), 500);
    assert.equal(await getBalance(alice.id, bob.id), 1500);
    assert.equal(
      await db.settlementAllocation.count({ where: { settlementExpenseId: settlement.id } }),
      0,
    );
    await assertMirrored(userIds);

    // Renaming keeps the balances.
    await callerFor(bob).group.addOrEditExpense({
      groupId: trip.id,
      expenseId: settlement.id,
      name: 'Paid back',
      category: 'general',
      amount: 15,
      splitType: SplitType.SETTLEMENT,
      currency: 'USD',
      paidBy: bob.id,
      participants: [
        { userId: bob.id, amount: 15 },
        { userId: alice.id, amount: -15 },
      ],
    });
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), -500);

    await deleteExpense(settlement.id, alice.id);
    await deleteExpense(settlement.id, alice.id);
    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), 1000);
    assert.equal(await getBalance(alice.id, bob.id), 3000);
    assert.equal(await getBalance(bob.id, alice.id), -3000);
    await assertMirrored(userIds);

    // Whoever is owed can record a payment too.
    await settle(3);
    const reverse = await callerFor(alice).group.addOrEditExpense({
      groupId: trip.id,
      name: 'Settle up',
      category: 'general',
      amount: 2.5,
      splitType: SplitType.SETTLEMENT,
      currency: 'USD',
      paidBy: alice.id,
      participants: [
        { userId: alice.id, amount: 2.5 },
        { userId: carol.id, amount: -2.5 },
      ],
    });
    assert.equal(await getGroupBalance(trip.id, alice.id, carol.id), 1250);
    assert.equal(await getBalance(carol.id, alice.id), -1250);
    await deleteExpense(reverse.id, alice.id);
    await assertMirrored(userIds);

    // Leaving needs a zero group balance, which a group settlement now makes possible.
    await settle(7);
    assert.equal(await getGroupBalance(trip.id, bob.id, alice.id), 0);
    await callerFor(bob).group.leaveGroup({ groupId: trip.id });

    await cleanUp([trip.id], userIds);
  },
);

void test(
  'rejects group settlements that are not a payment between two members',
  {
    skip: !databaseUrl,
  },
  async () => {
    const {
      SplitType,
      createGroupExpense,
      editExpense,
      createUser,
      createGroup,
      callerFor,
      getBalance,
      getGroupBalance,
      cleanUp,
    } = await setup();
    const [alice, bob, carol, dave] = await Promise.all([
      createUser('Alice'),
      createUser('Bob'),
      createUser('Carol'),
      createUser('Dave'),
    ]);
    const userIds = [alice.id, bob.id, carol.id, dave.id];
    const trip = await createGroup('Trip', alice.id, [alice.id, bob.id, carol.id]);

    await createGroupExpense(
      trip.id,
      alice.id,
      'Dinner',
      'food',
      20,
      SplitType.EQUAL,
      'USD',
      [
        { userId: alice.id, amount: 10 },
        { userId: bob.id, amount: -10 },
      ],
      alice.id,
      new Date('2026-01-01'),
    );

    const settle = (
      participants: { userId: number; amount: number }[],
      amount = 10,
      paidBy = bob.id,
      expenseId?: string,
    ) =>
      callerFor(bob).group.addOrEditExpense({
        groupId: trip.id,
        expenseId,
        name: 'Settle up',
        category: 'general',
        amount,
        splitType: SplitType.SETTLEMENT,
        currency: 'USD',
        paidBy,
        participants,
      });

    await assert.rejects(
      () =>
        settle([
          { userId: bob.id, amount: 10 },
          { userId: alice.id, amount: -5 },
          { userId: carol.id, amount: -5 },
        ]),
      /between the payer and one other member/,
    );
    await assert.rejects(
      () =>
        settle([
          { userId: bob.id, amount: -10 },
          { userId: alice.id, amount: 10 },
        ]),
      /full amount/,
    );
    await assert.rejects(
      () =>
        settle(
          [
            { userId: bob.id, amount: -10 },
            { userId: alice.id, amount: 10 },
          ],
          -10,
        ),
      /more than zero/,
    );
    await assert.rejects(() => settle([{ userId: alice.id, amount: -10 }]), /one other member/);
    await assert.rejects(
      () =>
        settle([
          { userId: bob.id, amount: 10 },
          { userId: dave.id, amount: -10 },
        ]),
      /Only group members/,
    );
    // Someone outside the group cannot record a payment in it.
    await assert.rejects(
      () =>
        callerFor(dave).group.addOrEditExpense({
          groupId: trip.id,
          name: 'Settle up',
          category: 'general',
          amount: 10,
          splitType: SplitType.SETTLEMENT,
          currency: 'USD',
          paidBy: bob.id,
          participants: [
            { userId: bob.id, amount: 10 },
            { userId: alice.id, amount: -10 },
          ],
        }),
      /Not a group member/,
    );

    // Edits are checked too.
    const settlement = await settle(
      [
        { userId: bob.id, amount: 4 },
        { userId: alice.id, amount: -4 },
      ],
      4,
    );
    await assert.rejects(
      () =>
        editExpense(
          settlement.id,
          bob.id,
          'Settle up',
          'general',
          6,
          SplitType.SETTLEMENT,
          'USD',
          [
            { userId: bob.id, amount: 6 },
            { userId: alice.id, amount: -3 },
            { userId: carol.id, amount: -3 },
          ],
          bob.id,
          new Date('2026-01-02'),
        ),
      /between the payer and one other member/,
    );

    assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), 600);
    assert.equal(await getBalance(alice.id, bob.id), 600);
    assert.equal(await getGroupBalance(trip.id, alice.id, carol.id), 0);

    await cleanUp([trip.id], userIds);
  },
);

void test(
  'paying everything from the friend page after a group settlement stays consistent',
  { skip: !databaseUrl },
  async () => {
    const {
      SplitType,
      db,
      addUserExpense,
      createGroupExpense,
      deleteExpense,
      createUser,
      createGroup,
      getBalance,
      getGroupBalance,
      assertMirrored,
      cleanUp,
    } = await setup();
    const [alice, bob] = await Promise.all([createUser('Alice'), createUser('Bob')]);
    const userIds = [alice.id, bob.id];
    const [trip, flat] = await Promise.all([
      createGroup('Trip', alice.id, userIds),
      createGroup('Flat', alice.id, userIds),
    ]);
    const owe = (groupId: number | null, amount: number) =>
      (groupId ? createGroupExpense.bind(null, groupId) : addUserExpense)(
        alice.id,
        'Owed',
        'general',
        amount,
        SplitType.EXACT,
        'USD',
        [
          { userId: alice.id, amount },
          { userId: bob.id, amount: -amount },
        ],
        alice.id,
        new Date('2026-01-01'),
      );
    await owe(trip.id, 10);
    await owe(flat.id, 5);
    await owe(null, 3);
    const initial = {
      total: 1800,
      trip: 1000,
      flat: 500,
    };
    const assertState = async (expected: typeof initial) => {
      assert.equal(await getBalance(alice.id, bob.id), expected.total);
      assert.equal(await getGroupBalance(trip.id, alice.id, bob.id), expected.trip);
      assert.equal(await getGroupBalance(flat.id, alice.id, bob.id), expected.flat);
      await assertMirrored(userIds);
    };
    await assertState(initial);

    const groupSettlement = await createGroupExpense(
      trip.id,
      bob.id,
      'Settle up',
      'general',
      4,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: bob.id, amount: 4 },
        { userId: alice.id, amount: -4 },
      ],
      bob.id,
      new Date('2026-01-02'),
    );
    await assertState({ total: 1400, trip: 600, flat: 500 });

    const everything = await addUserExpense(
      bob.id,
      'Settle up',
      'general',
      14,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: bob.id, amount: 14 },
        { userId: alice.id, amount: -14 },
      ],
      bob.id,
      new Date('2026-01-03'),
    );
    await assertState({ total: 0, trip: 0, flat: 0 });
    assert.equal(
      await db.settlementAllocation.count({ where: { settlementExpenseId: everything.id } }),
      4,
    );

    // Deleting the group payment after everything was settled only brings back that payment.
    await deleteExpense(groupSettlement.id, alice.id);
    await assertState({ total: 400, trip: 400, flat: 0 });

    // Deleting the full payment restores what it cleared, which adds up to the start.
    await deleteExpense(everything.id, alice.id);
    await assertState(initial);

    // The other order: delete the full payment first, then the group payment.
    const second = await createGroupExpense(
      trip.id,
      bob.id,
      'Settle up',
      'general',
      4,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: bob.id, amount: 4 },
        { userId: alice.id, amount: -4 },
      ],
      bob.id,
      new Date('2026-01-04'),
    );
    const secondEverything = await addUserExpense(
      bob.id,
      'Settle up',
      'general',
      14,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: bob.id, amount: 14 },
        { userId: alice.id, amount: -14 },
      ],
      bob.id,
      new Date('2026-01-05'),
    );
    await assertState({ total: 0, trip: 0, flat: 0 });
    await deleteExpense(secondEverything.id, alice.id);
    await assertState({ total: 1400, trip: 600, flat: 500 });
    await deleteExpense(second.id, alice.id);
    await assertState(initial);

    await cleanUp([trip.id, flat.id], userIds);
  },
);

void test(
  'breaks a friend balance down by group for the caller only',
  {
    skip: !databaseUrl,
  },
  async () => {
    const {
      SplitType,
      db,
      addUserExpense,
      createGroupExpense,
      createUser,
      createGroup,
      callerFor,
      assertMirrored,
      cleanUp,
    } = await setup();
    const [alice, bob, carol, mallory] = await Promise.all([
      createUser('Alice'),
      createUser('Bob'),
      createUser('Carol'),
      createUser('Mallory'),
    ]);
    const userIds = [alice.id, bob.id, carol.id, mallory.id];
    // Created one by one so the group ids, and the breakdown order, are predictable.
    const trip = await createGroup('Trip', alice.id, [alice.id, bob.id, carol.id]);
    const flat = await createGroup('Flat', alice.id, [alice.id, bob.id]);
    const old = await createGroup('Old', alice.id, [alice.id, bob.id]);
    const add = (
      groupId: number | null,
      paidBy: number,
      owedBy: number,
      amount: number,
      currency = 'USD',
    ) =>
      (groupId ? createGroupExpense.bind(null, groupId) : addUserExpense)(
        paidBy,
        'Owed',
        'general',
        amount,
        SplitType.EXACT,
        currency,
        [
          { userId: paidBy, amount },
          { userId: owedBy, amount: -amount },
        ],
        paidBy,
        new Date('2026-01-01'),
      );

    await add(trip.id, alice.id, bob.id, 10);
    await add(flat.id, bob.id, alice.id, 4);
    await add(null, alice.id, bob.id, 3);
    await add(old.id, alice.id, bob.id, 2);
    await add(trip.id, alice.id, bob.id, 7, 'EUR');
    // Balances between other people never show up.
    await add(trip.id, carol.id, bob.id, 50);
    await add(null, carol.id, alice.id, 1);
    // Bob leaves "Old" without settling, as some older data does.
    await db.groupUser.delete({ where: { groupId_userId: { groupId: old.id, userId: bob.id } } });
    await assertMirrored(userIds);

    const aliceView = await callerFor(alice).user.getBalanceBreakdownWithFriend({
      friendId: bob.id,
    });
    assert.deepEqual(aliceView, [
      {
        currency: 'USD',
        total: 1100,
        nonGroup: 300,
        groups: [
          { groupId: trip.id, name: 'Trip', amount: 1000, canSettle: true },
          { groupId: flat.id, name: 'Flat', amount: -400, canSettle: true },
          { groupId: old.id, name: 'Old', amount: 200, canSettle: false },
        ],
      },
      {
        currency: 'EUR',
        total: 700,
        nonGroup: 0,
        groups: [{ groupId: trip.id, name: 'Trip', amount: 700, canSettle: true }],
      },
    ]);

    const bobView = await callerFor(bob).user.getBalanceBreakdownWithFriend({
      friendId: alice.id,
    });
    const bobUsd = bobView.find((b) => 'USD' === b.currency);
    assert.equal(bobUsd?.total, -1100);
    assert.equal(bobUsd?.nonGroup, -300);
    assert.deepEqual(
      bobUsd?.groups.map((g) => [g.name, g.amount, g.canSettle]),
      [
        ['Trip', -1000, true],
        ['Flat', 400, true],
        [null, -200, false],
      ],
    );

    // Someone with no balances with either of them sees nothing.
    assert.deepEqual(
      await callerFor(mallory).user.getBalanceBreakdownWithFriend({ friendId: bob.id }),
      [],
    );
    assert.deepEqual(
      await callerFor(mallory).user.getBalanceBreakdownWithFriend({ friendId: alice.id }),
      [],
    );

    // Every bucket adds up to the total.
    aliceView.forEach((b) => {
      assert.equal(b.nonGroup + b.groups.reduce((sum, g) => sum + g.amount, 0), b.total);
    });

    await cleanUp([trip.id, flat.id, old.id], userIds);
  },
);
