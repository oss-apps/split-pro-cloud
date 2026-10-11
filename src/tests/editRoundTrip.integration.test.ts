import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

void test(
  'opening a saved expense and saving it unchanged keeps its cents and every balance',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ SplitType }, { db }, { appRouter }, store] = await Promise.all([
      import('@prisma/client'),
      import('~/server/db'),
      import('~/server/api/root'),
      import('~/store/addStore'),
    ]);
    const { calculateParticipantSplit, getEditFormState, useAddExpenseStore } = store;
    const suffix = `${Date.now()}-${Math.random()}`;
    const users = await Promise.all(
      ['Alice', 'Bob', 'Carol'].map((name) =>
        db.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name } }),
      ),
    );
    const [alice, bob, carol] = users;
    assert.ok(alice && bob && carol);
    const group = await db.group.create({
      data: { name: 'Trip', publicId: `trip-${suffix}`, userId: alice.id },
    });
    await db.groupUser.createMany({
      data: users.map((user) => ({ groupId: group.id, userId: user.id })),
    });

    const caller = appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: alice.id, name: alice.name, email: alice.email, currency: 'USD' },
      },
    });

    const userIds = users.map((user) => user.id);
    const snapshotBalances = async () => {
      const [balances, groupBalances] = await Promise.all([
        db.balance.findMany({ where: { userId: { in: userIds } } }),
        db.groupBalance.findMany({ where: { groupId: group.id } }),
      ]);
      return [
        ...balances.map((b) => `${b.userId}>${b.friendId} ${b.currency} ${b.amount}`),
        ...groupBalances.map((b) => `g ${b.userId}>${b.firendId} ${b.currency} ${b.amount}`),
      ].sort();
    };
    const participantCents = async (expenseId: string) =>
      (await db.expenseParticipant.findMany({ where: { expenseId }, orderBy: { userId: 'asc' } }))
        .map((p) => `${p.userId}:${p.amount}`)
        .join(' ');

    const cases = [
      { splitType: SplitType.SHARE, shares: [3, 7, 0], amount: 100, payer: alice, inGroup: true },
      { splitType: SplitType.SHARE, shares: [3, 7, 0], amount: -100, payer: alice, inGroup: false },
      { splitType: SplitType.EQUAL, shares: [1, 1, 1], amount: 1000, payer: bob, inGroup: true },
      { splitType: SplitType.EQUAL, shares: [1, 1, 1], amount: -10, payer: carol, inGroup: false },
      {
        splitType: SplitType.PERCENTAGE,
        shares: [33.33, 33.33, 33.34],
        amount: 12.34,
        payer: alice,
        inGroup: true,
      },
      {
        splitType: SplitType.EXACT,
        shares: [1.01, 2.02, 7.08],
        amount: -10.11,
        payer: bob,
        inGroup: true,
      },
      {
        splitType: SplitType.ADJUSTMENT,
        shares: [0, 1.5, 0.01],
        amount: 7,
        payer: carol,
        inGroup: false,
      },
    ];

    try {
      for (const testCase of cases) {
        const label = `${testCase.splitType} ${testCase.amount}`;
        const { participants, canSplitScreenClosed } = calculateParticipantSplit(
          testCase.amount,
          users.map((user, index) => ({ ...user, splitShare: testCase.shares[index] })),
          testCase.splitType,
          testCase.payer,
        );
        assert.equal(canSplitScreenClosed, true, label);

        const input = {
          name: label,
          category: 'general',
          amount: testCase.amount,
          splitType: testCase.splitType,
          currency: 'USD',
          paidBy: testCase.payer.id,
          participants: participants.map((p) => ({ userId: p.id, amount: p.amount ?? 0 })),
        };
        const expense = testCase.inGroup
          ? await caller.group.addOrEditExpense({ ...input, groupId: group.id })
          : await caller.user.addOrEditExpense(input);
        assert.ok(expense, label);

        const savedCents = await participantCents(expense.id);
        const savedBalances = await snapshotBalances();

        // What the edit page does: load the expense, then pick the same payer, open the split
        // screen and switch split type there and back.
        const details = await caller.user.getExpenseDetails({ expenseId: expense.id });
        const { actions } = useAddExpenseStore.getState();
        actions.resetState();
        useAddExpenseStore.setState({ ...getEditFormState(details), currentUser: alice });
        actions.setPaidBy(testCase.payer);
        actions.setSplitScreenOpen(true);
        actions.setSplitType(SplitType.EQUAL);
        actions.setSplitType(SplitType.SHARE);
        actions.setSplitType(testCase.splitType);
        actions.setSplitScreenOpen(false);

        const form = useAddExpenseStore.getState();
        const editInput = {
          ...input,
          expenseId: expense.id,
          amount: form.amount,
          paidBy: form.paidBy!.id,
          splitType: form.splitType,
          participants: form.participants.map((p) => ({ userId: p.id, amount: p.amount ?? 0 })),
        };
        if (testCase.inGroup) {
          await caller.group.addOrEditExpense({ ...editInput, groupId: group.id });
        } else {
          await caller.user.addOrEditExpense(editInput);
        }

        assert.equal(await participantCents(expense.id), savedCents, label);
        assert.deepEqual(await snapshotBalances(), savedBalances, label);
      }

      // A payer who is not a participant would get a balance from an expense they are not in.
      await assert.rejects(
        caller.user.addOrEditExpense({
          name: 'No payer',
          category: 'general',
          amount: 30,
          splitType: SplitType.EQUAL,
          currency: 'USD',
          paidBy: bob.id,
          participants: [
            { userId: alice.id, amount: 15 },
            { userId: carol.id, amount: -15 },
          ],
        }),
        (error: { code?: string; message?: string }) =>
          'BAD_REQUEST' === error.code &&
          /payer must be one of the participants/.test(error.message ?? ''),
      );
    } finally {
      useAddExpenseStore.getState().actions.resetState();
      await db.expense.deleteMany({ where: { addedBy: { in: userIds } } });
      await db.group.delete({ where: { id: group.id } });
      await db.balance.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  },
);
