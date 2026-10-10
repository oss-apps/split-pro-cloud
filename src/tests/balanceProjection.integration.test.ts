import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

void test(
  'does not zero unrelated group balances when one overall balance settles',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ SplitType }, { db }, { addUserExpense, deleteExpense }] = await Promise.all([
      import('@prisma/client'),
      import('~/server/db'),
      import('~/server/api/services/splitService'),
    ]);

    const suffix = `${Date.now()}-${Math.random()}`;
    const [userA, userB, userC] = await Promise.all([
      db.user.create({ data: { email: `a-${suffix}@example.com`, name: 'A' } }),
      db.user.create({ data: { email: `b-${suffix}@example.com`, name: 'B' } }),
      db.user.create({ data: { email: `c-${suffix}@example.com`, name: 'C' } }),
    ]);
    const [groupOne, groupTwo] = await Promise.all([
      db.group.create({ data: { name: 'One', publicId: `one-${suffix}`, userId: userB.id } }),
      db.group.create({ data: { name: 'Two', publicId: `two-${suffix}`, userId: userB.id } }),
    ]);

    await db.groupUser.createMany({
      data: [groupOne, groupTwo].flatMap((group) =>
        [userA, userB, userC].map((user) => ({ groupId: group.id, userId: user.id })),
      ),
    });
    await db.balance.createMany({
      data: [
        { userId: userB.id, friendId: userA.id, currency: 'USD', amount: -1000 },
        { userId: userA.id, friendId: userB.id, currency: 'USD', amount: 1000 },
        { userId: userB.id, friendId: userC.id, currency: 'USD', amount: 2000 },
        { userId: userC.id, friendId: userB.id, currency: 'USD', amount: -2000 },
      ],
    });
    await db.groupBalance.createMany({
      data: [
        {
          groupId: groupOne.id,
          userId: userB.id,
          firendId: userA.id,
          currency: 'USD',
          amount: -1000,
        },
        {
          groupId: groupOne.id,
          userId: userA.id,
          firendId: userB.id,
          currency: 'USD',
          amount: 1000,
        },
        {
          groupId: groupOne.id,
          userId: userB.id,
          firendId: userC.id,
          currency: 'USD',
          amount: 2000,
        },
        {
          groupId: groupOne.id,
          userId: userC.id,
          firendId: userB.id,
          currency: 'USD',
          amount: -2000,
        },
        {
          groupId: groupTwo.id,
          userId: userB.id,
          firendId: userC.id,
          currency: 'USD',
          amount: 500,
        },
        {
          groupId: groupTwo.id,
          userId: userC.id,
          firendId: userB.id,
          currency: 'USD',
          amount: -500,
        },
      ],
    });

    const ordinaryOffset = await addUserExpense(
      userB.id,
      'Personal offset',
      'general',
      10,
      SplitType.EXACT,
      'USD',
      [
        { userId: userB.id, amount: 10 },
        { userId: userA.id, amount: -10 },
      ],
      userB.id,
      new Date('2025-12-31'),
    );
    const groupBalanceBeforeSettlement = await db.groupBalance.findUniqueOrThrow({
      where: {
        groupId_currency_firendId_userId: {
          groupId: groupOne.id,
          currency: 'USD',
          userId: userB.id,
          firendId: userA.id,
        },
      },
    });
    assert.equal(groupBalanceBeforeSettlement.amount, -1000);
    await deleteExpense(ordinaryOffset.id, userB.id);

    await addUserExpense(
      userB.id,
      'Settle up',
      'general',
      10,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: userB.id, amount: 10 },
        { userId: userA.id, amount: -10 },
      ],
      userB.id,
      new Date('2026-01-01'),
    );

    const rows = await db.groupBalance.findMany({
      where: {
        currency: 'USD',
        OR: [{ userId: userB.id }, { firendId: userB.id }],
      },
      orderBy: [{ groupId: 'asc' }, { firendId: 'asc' }],
    });
    const amounts = new Map(
      rows.map((row) => [`${row.groupId}:${row.userId}:${row.firendId}`, row.amount]),
    );

    assert.equal(amounts.get(`${groupOne.id}:${userB.id}:${userA.id}`), 0);
    assert.equal(amounts.get(`${groupOne.id}:${userA.id}:${userB.id}`), 0);
    assert.equal(amounts.get(`${groupOne.id}:${userB.id}:${userC.id}`), 2000);
    assert.equal(amounts.get(`${groupOne.id}:${userC.id}:${userB.id}`), -2000);
    assert.equal(amounts.get(`${groupTwo.id}:${userB.id}:${userC.id}`), 500);
    assert.equal(amounts.get(`${groupTwo.id}:${userC.id}:${userB.id}`), -500);

    await db.group.deleteMany({ where: { id: { in: [groupOne.id, groupTwo.id] } } });
    await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id, userC.id] } } });
    await db.$disconnect();
  },
);

void test(
  'restores group balances when a completed personal settlement becomes partial',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [
      { SplitType },
      { db },
      { addUserExpense, createGroupExpense, deleteExpense, editExpense },
    ] = await Promise.all([
      import('@prisma/client'),
      import('~/server/db'),
      import('~/server/api/services/splitService'),
    ]);
    const suffix = `${Date.now()}-${Math.random()}`;
    const [debtor, creditor] = await Promise.all([
      db.user.create({ data: { email: `debtor-${suffix}@example.com`, name: 'Debtor' } }),
      db.user.create({ data: { email: `creditor-${suffix}@example.com`, name: 'Creditor' } }),
    ]);
    const [groupOne, groupTwo] = await Promise.all([
      db.group.create({
        data: { name: 'Settlement one', publicId: `settlement-one-${suffix}`, userId: creditor.id },
      }),
      db.group.create({
        data: { name: 'Settlement two', publicId: `settlement-two-${suffix}`, userId: creditor.id },
      }),
    ]);

    await db.groupUser.createMany({
      data: [groupOne, groupTwo].flatMap((group) =>
        [debtor, creditor].map((user) => ({ groupId: group.id, userId: user.id })),
      ),
    });
    await db.balance.createMany({
      data: [
        { userId: debtor.id, friendId: creditor.id, currency: 'USD', amount: -500 },
        { userId: creditor.id, friendId: debtor.id, currency: 'USD', amount: 500 },
      ],
    });
    await db.groupBalance.createMany({
      data: [
        {
          groupId: groupOne.id,
          userId: debtor.id,
          firendId: creditor.id,
          currency: 'USD',
          amount: -300,
        },
        {
          groupId: groupOne.id,
          userId: creditor.id,
          firendId: debtor.id,
          currency: 'USD',
          amount: 300,
        },
        {
          groupId: groupTwo.id,
          userId: debtor.id,
          firendId: creditor.id,
          currency: 'USD',
          amount: -200,
        },
        {
          groupId: groupTwo.id,
          userId: creditor.id,
          firendId: debtor.id,
          currency: 'USD',
          amount: 200,
        },
        {
          groupId: groupOne.id,
          userId: debtor.id,
          firendId: creditor.id,
          currency: 'EUR',
          amount: -700,
        },
        {
          groupId: groupOne.id,
          userId: creditor.id,
          firendId: debtor.id,
          currency: 'EUR',
          amount: 700,
        },
      ],
    });

    const settlement = await addUserExpense(
      debtor.id,
      'Settle up',
      'general',
      5,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 5 },
        { userId: creditor.id, amount: -5 },
      ],
      debtor.id,
      new Date('2026-01-01'),
    );
    assert.ok(settlement);

    const [initialAllocations, settledGroupBalances, otherCurrencyBalances] = await Promise.all([
      db.settlementAllocation.findMany({ where: { settlementExpenseId: settlement.id } }),
      db.groupBalance.findMany({
        where: { groupId: { in: [groupOne.id, groupTwo.id] }, currency: 'USD' },
      }),
      db.groupBalance.findMany({
        where: { groupId: { in: [groupOne.id, groupTwo.id] }, currency: 'EUR' },
      }),
    ]);
    assert.equal(initialAllocations.length, 4);
    assert.equal(
      settledGroupBalances.every((balance) => 0 === balance.amount),
      true,
    );
    assert.deepEqual(
      otherCurrencyBalances.map((balance) => balance.amount).sort((a, b) => a - b),
      [-700, 700],
    );

    await editExpense(
      settlement.id,
      debtor.id,
      'Settle up',
      'general',
      2,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 2 },
        { userId: creditor.id, amount: -2 },
      ],
      debtor.id,
      new Date('2026-01-01'),
    );

    const [overallBalance, restoredGroupBalances, partialAllocations] = await Promise.all([
      db.balance.findUniqueOrThrow({
        where: {
          userId_currency_friendId: {
            userId: creditor.id,
            currency: 'USD',
            friendId: debtor.id,
          },
        },
      }),
      db.groupBalance.findMany({
        where: {
          groupId: { in: [groupOne.id, groupTwo.id] },
          userId: creditor.id,
          currency: 'USD',
        },
        orderBy: { groupId: 'asc' },
      }),
      db.settlementAllocation.findMany({ where: { settlementExpenseId: settlement.id } }),
    ]);

    assert.equal(overallBalance.amount, 300);
    const restoredAmounts = new Map(
      restoredGroupBalances.map((balance) => [balance.groupId, balance.amount]),
    );
    assert.equal(restoredAmounts.get(groupOne.id), 300);
    assert.equal(restoredAmounts.get(groupTwo.id), 200);
    assert.equal(partialAllocations.length, 0);

    await editExpense(
      settlement.id,
      debtor.id,
      'Settle up',
      'general',
      5,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 5 },
        { userId: creditor.id, amount: -5 },
      ],
      debtor.id,
      new Date('2026-01-01'),
    );
    await createGroupExpense(
      groupOne.id,
      creditor.id,
      'Later expense',
      'general',
      1,
      SplitType.EQUAL,
      'USD',
      [
        { userId: creditor.id, amount: 1 },
        { userId: debtor.id, amount: -1 },
      ],
      creditor.id,
      new Date('2026-02-01'),
    );
    await editExpense(
      settlement.id,
      debtor.id,
      'Updated settlement note',
      'general',
      5,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 5 },
        { userId: creditor.id, amount: -5 },
      ],
      debtor.id,
      new Date('2026-01-01'),
    );

    const [balancesAfterMetadataEdit, allocationsAfterMetadataEdit] = await Promise.all([
      db.groupBalance.findMany({
        where: {
          groupId: { in: [groupOne.id, groupTwo.id] },
          userId: creditor.id,
          currency: 'USD',
        },
      }),
      db.settlementAllocation.findMany({ where: { settlementExpenseId: settlement.id } }),
    ]);
    const metadataEditAmounts = new Map(
      balancesAfterMetadataEdit.map((balance) => [balance.groupId, balance.amount]),
    );
    assert.equal(metadataEditAmounts.get(groupOne.id), 100);
    assert.equal(metadataEditAmounts.get(groupTwo.id), 0);
    assert.equal(allocationsAfterMetadataEdit.length, 4);

    await deleteExpense(settlement.id, debtor.id);

    const [deletedOverallBalance, deletedGroupBalances, deletedAllocations] = await Promise.all([
      db.balance.findUniqueOrThrow({
        where: {
          userId_currency_friendId: {
            userId: creditor.id,
            currency: 'USD',
            friendId: debtor.id,
          },
        },
      }),
      db.groupBalance.findMany({
        where: {
          groupId: { in: [groupOne.id, groupTwo.id] },
          userId: creditor.id,
          currency: 'USD',
        },
        orderBy: { groupId: 'asc' },
      }),
      db.settlementAllocation.findMany({ where: { settlementExpenseId: settlement.id } }),
    ]);

    assert.equal(deletedOverallBalance.amount, 600);
    const deletedAmounts = new Map(
      deletedGroupBalances.map((balance) => [balance.groupId, balance.amount]),
    );
    assert.equal(deletedAmounts.get(groupOne.id), 400);
    assert.equal(deletedAmounts.get(groupTwo.id), 200);
    assert.equal(deletedAllocations.length, 0);

    const legacySettlement = await db.expense.create({
      data: {
        paidBy: debtor.id,
        addedBy: debtor.id,
        name: 'Legacy settlement',
        category: 'general',
        amount: 100,
        splitType: SplitType.SETTLEMENT,
        currency: 'USD',
        expenseParticipants: {
          create: [
            { userId: debtor.id, amount: 100 },
            { userId: creditor.id, amount: -100 },
          ],
        },
      },
    });
    const balanceBeforeLegacyEdit = await db.balance.findUniqueOrThrow({
      where: {
        userId_currency_friendId: { userId: creditor.id, currency: 'USD', friendId: debtor.id },
      },
    });
    await editExpense(
      legacySettlement.id,
      debtor.id,
      'Renamed legacy settlement',
      'general',
      1,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 1 },
        { userId: creditor.id, amount: -1 },
      ],
      debtor.id,
      new Date('2026-01-02'),
    );
    await editExpense(
      legacySettlement.id,
      debtor.id,
      'Renamed legacy settlement',
      'general',
      4,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 4 },
        { userId: creditor.id, amount: -4 },
      ],
      debtor.id,
      new Date('2026-01-02'),
    );
    const legacyAfterEdit = await db.expense.findUniqueOrThrow({
      where: { id: legacySettlement.id },
      include: { expenseParticipants: true, settlementAllocations: true },
    });
    assert.equal(legacyAfterEdit.amount, 400);
    assert.equal(legacyAfterEdit.settlementAllocationVersion, null);
    assert.equal(legacyAfterEdit.settlementAllocations.length, 0);
    await deleteExpense(legacySettlement.id, debtor.id);
    await deleteExpense(legacySettlement.id, debtor.id);
    const [balanceAfterLegacyDelete, groupBalancesAfterLegacyDelete] = await Promise.all([
      db.balance.findUniqueOrThrow({
        where: {
          userId_currency_friendId: { userId: creditor.id, currency: 'USD', friendId: debtor.id },
        },
      }),
      db.groupBalance.findMany({
        where: {
          groupId: { in: [groupOne.id, groupTwo.id] },
          userId: creditor.id,
          currency: 'USD',
        },
        orderBy: { groupId: 'asc' },
      }),
    ]);
    // The legacy settlement was never applied, so removing it moves the pair by its stored amount
    // and leaves group balances untouched.
    assert.equal(balanceAfterLegacyDelete.amount, balanceBeforeLegacyEdit.amount + 100);
    assert.deepEqual(
      groupBalancesAfterLegacyDelete.map((balance) => balance.amount),
      deletedGroupBalances.map((balance) => balance.amount),
    );
    await db.balance.updateMany({
      where: { userId: creditor.id, friendId: debtor.id, currency: 'USD' },
      data: { amount: { decrement: 100 } },
    });
    await db.balance.updateMany({
      where: { userId: debtor.id, friendId: creditor.id, currency: 'USD' },
      data: { amount: { increment: 100 } },
    });

    const detachedSettlement = await addUserExpense(
      debtor.id,
      'Settle before leaving',
      'general',
      6,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 6 },
        { userId: creditor.id, amount: -6 },
      ],
      debtor.id,
      new Date('2026-03-01'),
    );
    await db.group.delete({ where: { id: groupOne.id } });
    await db.groupUser.delete({
      where: { groupId_userId: { groupId: groupTwo.id, userId: debtor.id } },
    });
    await editExpense(
      detachedSettlement.id,
      debtor.id,
      'Partial after leaving',
      'general',
      3,
      SplitType.SETTLEMENT,
      'USD',
      [
        { userId: debtor.id, amount: 3 },
        { userId: creditor.id, amount: -3 },
      ],
      debtor.id,
      new Date('2026-03-01'),
    );

    const [detachedBalance, detachedGroupBalance, detachedAllocations] = await Promise.all([
      db.balance.findUniqueOrThrow({
        where: {
          userId_currency_friendId: {
            userId: creditor.id,
            currency: 'USD',
            friendId: debtor.id,
          },
        },
      }),
      db.groupBalance.findUniqueOrThrow({
        where: {
          groupId_currency_firendId_userId: {
            groupId: groupTwo.id,
            currency: 'USD',
            userId: creditor.id,
            firendId: debtor.id,
          },
        },
      }),
      db.settlementAllocation.findMany({
        where: { settlementExpenseId: detachedSettlement.id },
      }),
    ]);
    assert.equal(detachedBalance.amount, 300);
    assert.equal(detachedGroupBalance.amount, 0);
    assert.equal(detachedAllocations.length, 0);

    await db.group.deleteMany({ where: { id: { in: [groupOne.id, groupTwo.id] } } });
    await db.user.deleteMany({ where: { id: { in: [debtor.id, creditor.id] } } });
    await db.$disconnect();
  },
);

void test(
  'keeps old group expenses editable and deletes them exactly once',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ SplitType }, { db }, { createGroupExpense, deleteExpense, editExpense }] =
      await Promise.all([
        import('@prisma/client'),
        import('~/server/db'),
        import('~/server/api/services/splitService'),
      ]);
    const suffix = `${Date.now()}-${Math.random()}`;
    const [payer, friend, formerMember] = await Promise.all([
      db.user.create({ data: { email: `payer-${suffix}@example.com`, name: 'Payer' } }),
      db.user.create({ data: { email: `friend-${suffix}@example.com`, name: 'Friend' } }),
      db.user.create({ data: { email: `former-${suffix}@example.com`, name: 'Former' } }),
    ]);
    const group = await db.group.create({
      data: { name: 'Trip', publicId: `trip-${suffix}`, userId: payer.id },
    });
    await db.groupUser.createMany({
      data: [payer, friend, formerMember].map((user) => ({ groupId: group.id, userId: user.id })),
    });

    const getGroupBalance = async (userId: number, friendId: number) =>
      (
        await db.groupBalance.findUnique({
          where: {
            groupId_currency_firendId_userId: {
              groupId: group.id,
              currency: 'USD',
              userId,
              firendId: friendId,
            },
          },
        })
      )?.amount ?? 0;
    const getBalance = async (userId: number, friendId: number) =>
      (
        await db.balance.findUnique({
          where: { userId_currency_friendId: { userId, currency: 'USD', friendId } },
        })
      )?.amount ?? 0;

    const expense = await createGroupExpense(
      group.id,
      payer.id,
      'Dinner',
      'general',
      30,
      SplitType.EQUAL,
      'USD',
      [
        { userId: payer.id, amount: 20 },
        { userId: friend.id, amount: -10 },
        { userId: formerMember.id, amount: -10 },
      ],
      payer.id,
      new Date('2026-01-01'),
    );
    await db.groupUser.delete({
      where: { groupId_userId: { groupId: group.id, userId: formerMember.id } },
    });

    await editExpense(
      expense.id,
      payer.id,
      'Dinner with everyone',
      'food',
      30,
      SplitType.EQUAL,
      'USD',
      [
        { userId: payer.id, amount: 20 },
        { userId: friend.id, amount: -10 },
        { userId: formerMember.id, amount: -10 },
      ],
      payer.id,
      new Date('2026-01-02'),
    );
    await editExpense(
      expense.id,
      payer.id,
      'Dinner with everyone',
      'food',
      40,
      SplitType.EXACT,
      'USD',
      [
        { userId: payer.id, amount: 30 },
        { userId: friend.id, amount: -20 },
        { userId: formerMember.id, amount: -10 },
      ],
      payer.id,
      new Date('2026-01-02'),
    );
    assert.equal(await getGroupBalance(payer.id, friend.id), 2000);
    assert.equal(await getGroupBalance(friend.id, payer.id), -2000);
    assert.equal(await getGroupBalance(payer.id, formerMember.id), 1000);
    assert.equal(await getBalance(formerMember.id, payer.id), -1000);

    // An old row whose amounts no longer add up can still be renamed.
    await db.expenseParticipant.update({
      where: { expenseId_userId: { expenseId: expense.id, userId: payer.id } },
      data: { amount: 9999 },
    });
    await editExpense(
      expense.id,
      payer.id,
      'Renamed again',
      'food',
      40,
      SplitType.EXACT,
      'USD',
      [
        { userId: payer.id, amount: 99.99 },
        { userId: friend.id, amount: -20 },
        { userId: formerMember.id, amount: -10 },
      ],
      payer.id,
      new Date('2026-01-03'),
    );
    await assert.rejects(
      () =>
        editExpense(
          expense.id,
          payer.id,
          'Renamed again',
          'food',
          45,
          SplitType.EXACT,
          'USD',
          [
            { userId: payer.id, amount: 99.99 },
            { userId: friend.id, amount: -20 },
            { userId: formerMember.id, amount: -10 },
          ],
          payer.id,
          new Date('2026-01-03'),
        ),
      /must add up/,
    );

    await Promise.all([deleteExpense(expense.id, payer.id), deleteExpense(expense.id, payer.id)]);
    await deleteExpense(expense.id, payer.id);
    assert.equal(await getGroupBalance(payer.id, friend.id), 0);
    assert.equal(await getGroupBalance(friend.id, payer.id), 0);
    assert.equal(await getGroupBalance(payer.id, formerMember.id), 0);
    assert.equal(await getBalance(payer.id, friend.id), 0);
    assert.equal(await getBalance(formerMember.id, payer.id), 0);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        createGroupExpense(
          group.id,
          index % 2 ? payer.id : friend.id,
          `Concurrent ${index}`,
          'general',
          1,
          SplitType.EQUAL,
          'USD',
          [
            { userId: payer.id, amount: index % 2 ? 0.5 : -0.5 },
            { userId: friend.id, amount: index % 2 ? -0.5 : 0.5 },
          ],
          payer.id,
          new Date('2026-01-04'),
        ),
      ),
    );
    const created = results.filter((result) => 'fulfilled' === result.status).length;
    results.forEach((result) => {
      if ('rejected' === result.status) {
        assert.match(String(result.reason), /Please try again/);
      }
    });
    const liveExpenses = await db.expense.findMany({
      where: { groupId: group.id, deletedAt: null },
      include: { expenseParticipants: true },
    });
    assert.equal(liveExpenses.length, created);
    const expected = liveExpenses.reduce(
      (total, liveExpense) =>
        total +
        (liveExpense.expenseParticipants.find((participant) => participant.userId === payer.id)
          ?.amount ?? 0),
      0,
    );
    assert.equal(await getGroupBalance(payer.id, friend.id), expected);
    assert.equal(await getGroupBalance(friend.id, payer.id), 0 - expected);
    assert.equal(await getBalance(payer.id, friend.id), expected);

    await db.group.delete({ where: { id: group.id } });
    await db.user.deleteMany({ where: { id: { in: [payer.id, friend.id, formerMember.id] } } });
    await db.$disconnect();
  },
);
