import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

void test(
  'amounts and balances that do not fit int4 are rejected as BAD_REQUEST without changes',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ SplitType }, { TRPCError }, { db }, { appRouter }, { AMOUNT_TOO_LARGE_MESSAGE }] =
      await Promise.all([
        import('@prisma/client'),
        import('@trpc/server'),
        import('~/server/db'),
        import('~/server/api/root'),
        import('~/utils/numbers'),
      ]);
    const suffix = `${Date.now()}-${Math.random()}`;
    const [alice, bob] = await Promise.all(
      ['Alice', 'Bob'].map((name) =>
        db.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name } }),
      ),
    );
    assert.ok(alice && bob);
    const group = await db.group.create({
      data: { name: 'Trip', publicId: `trip-${suffix}`, userId: alice.id },
    });
    await db.groupUser.createMany({
      data: [alice, bob].map((user) => ({ groupId: group.id, userId: user.id })),
    });

    const caller = appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: alice.id, name: alice.name, email: alice.email, currency: 'USD' },
      },
    });

    const expenseInput = (amount: number, expenseId?: string) => ({
      expenseId,
      name: 'Big one',
      category: 'general',
      amount,
      splitType: SplitType.EXACT,
      currency: 'USD',
      paidBy: alice.id,
      participants: [
        { userId: alice.id, amount },
        { userId: bob.id, amount: -amount },
      ],
    });

    const isTooLarge = (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, 'BAD_REQUEST');
      assert.equal(error.message, AMOUNT_TOO_LARGE_MESSAGE);
      return true;
    };

    const getBalance = async (userId: number, friendId: number) =>
      (
        await db.balance.findUnique({
          where: { userId_currency_friendId: { userId, currency: 'USD', friendId } },
        })
      )?.amount;

    try {
      // An amount that can never be stored.
      await assert.rejects(caller.user.addOrEditExpense(expenseInput(30_000_000)), isTooLarge);

      // A normal expense, then a running balance close to the limit.
      const expense = await caller.user.addOrEditExpense(expenseInput(10));
      assert.ok(expense);
      await db.balance.update({
        where: {
          userId_currency_friendId: { userId: alice.id, currency: 'USD', friendId: bob.id },
        },
        data: { amount: 2_147_000_000 },
      });
      await db.balance.update({
        where: {
          userId_currency_friendId: { userId: bob.id, currency: 'USD', friendId: alice.id },
        },
        data: { amount: -2_147_000_000 },
      });

      // Each amount fits, but the balance would overflow: on create and on edit.
      await assert.rejects(caller.user.addOrEditExpense(expenseInput(10_000)), isTooLarge);
      await assert.rejects(
        caller.user.addOrEditExpense(expenseInput(10_000, expense.id)),
        isTooLarge,
      );

      // A group expense that would overflow the group balance as well.
      await db.groupBalance.createMany({
        data: [
          {
            groupId: group.id,
            currency: 'USD',
            userId: alice.id,
            firendId: bob.id,
            amount: 2_147_000_000,
          },
          {
            groupId: group.id,
            currency: 'USD',
            userId: bob.id,
            firendId: alice.id,
            amount: -2_147_000_000,
          },
        ],
      });
      await assert.rejects(
        caller.group.addOrEditExpense({ ...expenseInput(10_000), groupId: group.id }),
        isTooLarge,
      );

      // Nothing changed: the failed transactions rolled back.
      assert.equal(await getBalance(alice.id, bob.id), 2_147_000_000);
      assert.equal(await getBalance(bob.id, alice.id), -2_147_000_000);
      const stored = await db.expense.findMany({
        where: { addedBy: alice.id },
        include: { expenseParticipants: true },
      });
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.amount, 1000);
      assert.deepEqual(
        stored[0]?.expenseParticipants.map((participant) => participant.amount).sort(),
        [-1000, 1000],
      );

      // An expense that keeps the balance in range still works.
      await assert.doesNotReject(caller.user.addOrEditExpense(expenseInput(-10_000)));
    } finally {
      await db.group.deleteMany({ where: { id: group.id } });
      await db.expense.deleteMany({ where: { addedBy: { in: [alice.id, bob.id] } } });
      await db.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
      await db.$disconnect();
    }
  },
);
