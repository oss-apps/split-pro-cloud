import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ SplitType }, { db }, splitService, { appRouter }, { hasShareWithFriend }] =
    await Promise.all([
      import('@prisma/client'),
      import('~/server/db'),
      import('~/server/api/services/splitService'),
      import('~/server/api/root'),
      import('~/utils/expenseLabels'),
    ]);
  const suffix = `${Date.now()}-${Math.random()}`;

  const createUser = (name: string, currency = 'USD') =>
    db.user.create({
      data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name, currency },
    });

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
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });

  return { SplitType, db, ...splitService, createUser, createGroup, callerFor, hasShareWithFriend };
};

void test(
  'quick wins: group currency, zero shares and settlement dates',
  { skip: !databaseUrl },
  async () => {
    const {
      SplitType,
      db,
      createGroupExpense,
      createUser,
      createGroup,
      callerFor,
      hasShareWithFriend,
    } = await setup();
    const [alice, bob, carol] = await Promise.all([
      createUser('Alice', 'EUR'),
      createUser('Bob'),
      createUser('Carol', 'INR'),
    ]);
    const userIds = [alice.id, bob.id, carol.id];
    const groupIds: number[] = [];

    try {
      // A new group keeps the currency it was created with, and an unknown one is refused.
      const created = await callerFor(alice).group.create({ name: 'Lisbon', currency: 'EUR' });
      groupIds.push(created.id);
      assert.equal(created.defaultCurrency, 'EUR');
      await assert.rejects(callerFor(alice).group.create({ name: 'Bad', currency: 'XYZ' }));

      // Existing groups were all stored as USD: the backfill uses their expenses, else the creator.
      const [trip, empty] = await Promise.all([
        createGroup('Trip', bob.id, userIds),
        createGroup('Empty', carol.id, [carol.id]),
      ]);
      groupIds.push(trip.id, empty.id);
      const addTripExpense = (
        currency: string,
        payer: number,
        amount: number,
        participants: number[][],
      ) =>
        createGroupExpense(
          trip.id,
          payer,
          'Dinner',
          'food',
          amount,
          SplitType.EXACT,
          currency,
          participants.map(([userId, amount]) => ({ userId: userId!, amount: amount! })),
          payer,
          new Date('2026-01-01'),
        );
      await addTripExpense('GBP', alice.id, 40, [
        [alice.id, 20],
        [bob.id, -20],
      ]);
      await addTripExpense('GBP', alice.id, 20, [
        [alice.id, 10],
        [bob.id, -10],
      ]);
      // Bob pays 30 for himself and Alice, and Carol's share is zero.
      const dinner = await addTripExpense('EUR', bob.id, 30, [
        [bob.id, 15],
        [alice.id, -15],
        [carol.id, 0],
      ]);

      const migration = await readFile(
        new URL(
          '../../prisma/migrations/20261013120000_backfill_group_currency/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      // Limited to this test's groups, as other tests share the database.
      await db.$executeRawUnsafe(
        `${migration.trim().replace(/;$/, '')} AND g."id" IN (${[trip.id, empty.id].join(',')})`,
      );
      const backfilled = await db.group.findMany({ where: { id: { in: [trip.id, empty.id] } } });
      assert.equal(backfilled.find((g) => g.id === trip.id)?.defaultCurrency, 'GBP');
      assert.equal(backfilled.find((g) => g.id === empty.id)?.defaultCurrency, 'INR');

      // Carol owes Bob nothing for the dinner. The friend page data, which the CSV export uses
      // as is, still has it (both ways), and only the list hides it.
      const withFriend = async (viewer: typeof alice, friend: typeof alice) => {
        const expenses = await callerFor(viewer).user.getExpensesWithFriend({
          friendId: friend.id,
        });
        const row = expenses.find((e) => e.id === dinner.id);
        return { exported: !!row, listed: !!row && hasShareWithFriend(row, viewer.id, friend.id) };
      };
      assert.deepEqual(await withFriend(carol, bob), { exported: true, listed: false });
      assert.deepEqual(await withFriend(bob, carol), { exported: true, listed: false });
      assert.deepEqual(await withFriend(alice, bob), { exported: true, listed: true });
      assert.deepEqual(await withFriend(bob, alice), { exported: true, listed: true });

      // A settlement keeps the day it was paid.
      const paidOn = new Date(2026, 8, 30, 12);
      const settlement = await callerFor(bob).group.addOrEditExpense({
        groupId: trip.id,
        name: 'Settle up',
        category: 'general',
        amount: 30,
        splitType: SplitType.SETTLEMENT,
        currency: 'GBP',
        paidBy: bob.id,
        participants: [
          { userId: bob.id, amount: 30 },
          { userId: alice.id, amount: -30 },
        ],
        expenseDate: paidOn,
      });
      const stored = await db.expense.findUniqueOrThrow({ where: { id: settlement.id } });
      assert.deepEqual(stored.expenseDate, paidOn);
    } finally {
      await db.group.deleteMany({ where: { id: { in: groupIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }
  },
);
