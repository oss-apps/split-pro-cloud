import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { type PrismaClient } from '@prisma/client';

import type * as Migrations from '~/migrations';
import type * as Backfill from '~/migrations/backfillUserCreatedAt';
import type * as AdminStats from '~/server/api/services/adminStats';

const databaseUrl = process.env.TEST_DATABASE_URL;

/**
 * Totals cover the whole database, so these tests get a schema of their own, migrated from
 * scratch, and drop it at the end.
 */
const schema = `admin_stats_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
const schemaUrl = () => {
  const url = new URL(databaseUrl!);
  url.searchParams.set('schema', schema);
  return url.toString();
};

let db: PrismaClient;
let stats: typeof AdminStats;
let migrations: typeof Migrations;
let backfill: typeof Backfill;

before(async () => {
  if (!databaseUrl) {
    return;
  }
  assert.match(new URL(databaseUrl).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = schemaUrl();
  process.env.SKIP_ENV_VALIDATION = '1';

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: schemaUrl() },
    stdio: 'ignore',
  });

  [{ db }, stats, migrations, backfill] = await Promise.all([
    import('~/server/db'),
    import('~/server/api/services/adminStats'),
    import('~/migrations'),
    import('~/migrations/backfillUserCreatedAt'),
  ]);
});

after(async () => {
  if (!databaseUrl) {
    return;
  }
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
});

const clearAll = () =>
  db.$executeRawUnsafe(
    `TRUNCATE "User", "Account", "Session", "Group", "Expense", "RecurringExpense",
      "PushNotification", "Feedback", "AppMetadata" RESTART IDENTITY CASCADE`,
  );

// A Wednesday
const NOW = new Date('2026-11-18T12:00:00Z');
const at = (iso: string) => new Date(`${iso}Z`);

void test('admin stats: an empty database', { skip: !databaseUrl }, async () => {
  await clearAll();
  const result = await stats.getAdminStats(db, { days: 7, now: NOW });

  assert.equal(result.totals.users, 0);
  assert.equal(result.totals.expenses, 0);
  assert.deepEqual(result.totals.pushDevices, { native: {}, webPushUsers: 0 });
  assert.equal(result.daily.length, 7);
  assert.equal(result.daily[0]!.date, '2026-11-12');
  assert.equal(result.daily.at(-1)!.date, '2026-11-18');
  assert.ok(
    result.daily.every(({ date: _date, ...counts }) =>
      Object.values(counts).every((count) => 0 === count),
    ),
  );
  assert.equal(result.weekly.length, 12);
  assert.equal(result.weekly.at(-1)!.week, '2026-W47');
  assert.deepEqual(
    result.monthly.map(({ month }) => month),
    ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
  );
  assert.ok(result.weekly.every(({ activeUsers }) => 0 === activeUsers));
  assert.equal(result.platforms, null);
  assert.match(result.newUsersMethod, /^createdAt \(estimated before \d{4}-\d{2}-\d{2}\)$/);
  assert.equal(result.newUsersBackfilled, false);
});

void test(
  'admin stats: counts, deleted users, dedup and zero-filling',
  { skip: !databaseUrl },
  async () => {
    await clearAll();

    const user = (id: number, data: Record<string, unknown>) =>
      db.user.create({ data: { id, email: `u${id}@example.com`, name: `U${id}`, ...data } });
    // Signed in by email, by OAuth, never signed in (invited), deleted, and one from before
    // createdAt existed that the backfill had no estimate for
    const alice = await user(1, { emailVerified: NOW, createdAt: at('2026-11-16T10:00:00') });
    const bob = await user(2, { createdAt: at('2026-11-16T11:00:00') });
    await db.account.create({
      data: { userId: bob.id, type: 'oauth', provider: 'google', providerAccountId: 'bob' },
    });
    const ivy = await user(3, { createdAt: at('2026-11-17T09:00:00') });
    const dan = await user(4, {
      email: null,
      name: 'Deleted user',
      deletedAt: NOW,
      createdAt: at('2026-11-17T10:00:00'),
    });
    const old = await user(5, { emailVerified: at('2025-01-01T00:00:00'), createdAt: null });

    const expense = (
      id: string,
      createdAt: Date,
      addedBy: number,
      paidBy: number,
      participants: number[],
      extra: Record<string, unknown> = {},
    ) =>
      db.expense.create({
        data: {
          id,
          addedBy,
          paidBy,
          name: id,
          category: 'general',
          amount: 100,
          currency: 'USD',
          createdAt,
          expenseDate: createdAt,
          expenseParticipants: {
            create: participants.map((userId) => ({ userId, amount: 0 })),
          },
          ...extra,
        },
      });

    await expense('e1', at('2026-11-16T09:00:00'), alice.id, alice.id, [alice.id, bob.id, ivy.id]);
    await expense('settle', at('2026-11-17T09:00:00'), bob.id, bob.id, [bob.id, alice.id], {
      splitType: 'SETTLEMENT',
    });
    await expense('gone', at('2026-11-17T10:00:00'), old.id, old.id, [old.id], { deletedAt: NOW });
    await expense('e2', at('2026-11-18T08:00:00'), alice.id, bob.id, [alice.id, bob.id, dan.id]);
    await expense('october', at('2026-10-05T08:00:00'), bob.id, bob.id, [bob.id]);

    // An occurrence the recurring runner added on its own isn't activity
    const rule = await db.recurringExpense.create({
      data: {
        frequency: 'DAILY',
        timezone: 'UTC',
        startDate: at('2026-11-01T00:00:00'),
        nextOccurrenceDate: at('2026-11-19T00:00:00'),
        nextOccurrenceAt: at('2026-11-19T00:00:00'),
        createdById: old.id,
      },
    });
    await expense('auto', at('2026-11-18T00:05:00'), old.id, old.id, [old.id], {
      recurringId: rule.id,
      occurrenceDate: at('2026-11-18T00:00:00'),
    });

    await db.group.create({
      data: {
        publicId: 'g1',
        name: 'Trip',
        userId: alice.id,
        createdAt: at('2026-11-17T12:00:00'),
      },
    });
    await db.devicePushToken.createMany({
      data: [
        { userId: alice.id, token: 't1', platform: 'ios' },
        { userId: bob.id, token: 't2', platform: 'android' },
        { userId: dan.id, token: 't3', platform: 'ios' },
      ],
    });
    await db.pushNotification.create({ data: { userId: alice.id, subscription: '{}' } });

    const result = await stats.getAdminStats(db, { days: 3, now: NOW });

    assert.deepEqual(result.totals, {
      users: 3,
      invitedUsers: 1,
      deletedUsers: 1,
      groups: 1,
      expenses: 4,
      settlements: 1,
      activeRecurringRules: 1,
      pushDevices: {
        native: { android: { devices: 1, users: 1 }, ios: { devices: 1, users: 1 } },
        webPushUsers: 1,
      },
    });

    const zeros = { settlements: 0, recurringCreated: 0, groupsCreated: 0, newInvitedUsers: 0 };
    assert.deepEqual(result.daily, [
      // Ivy took part but never signed in, so isn't an active user
      {
        ...zeros,
        date: '2026-11-16',
        newUsers: 2,
        activeUsers: 2,
        activeCreators: 1,
        expensesCreated: 1,
      },
      // The deleted user doesn't count as new, the deleted expense isn't counted
      {
        ...zeros,
        date: '2026-11-17',
        newUsers: 0,
        newInvitedUsers: 1,
        activeUsers: 2,
        activeCreators: 1,
        expensesCreated: 0,
        settlements: 1,
        groupsCreated: 1,
      },
      // Dan is deleted, and the recurring occurrence doesn't make its creator active
      {
        ...zeros,
        date: '2026-11-18',
        newUsers: 0,
        activeUsers: 2,
        activeCreators: 1,
        expensesCreated: 1,
        recurringCreated: 1,
      },
    ]);

    // Six active user-days in the week, but two people
    const thisWeek = result.weekly.at(-1)!;
    assert.deepEqual(thisWeek, {
      week: '2026-W47',
      start: '2026-11-16',
      activeUsers: 2,
      activeCreators: 2,
    });
    assert.equal(result.weekly.find(({ week }) => '2026-W41' === week)?.activeUsers, 1);
    assert.equal(
      result.weekly.reduce((sum, { activeUsers }) => sum + activeUsers, 0),
      3,
    );
    assert.deepEqual(result.monthly.slice(-2), [
      { month: '2026-10', activeUsers: 1, activeCreators: 1 },
      { month: '2026-11', activeUsers: 2, activeCreators: 2 },
    ]);
  },
);

void test(
  'admin stats: every way a user is created sets createdAt',
  { skip: !databaseUrl },
  async () => {
    await clearAll();
    const { authAdapter } = await import('~/server/auth');
    const startedAt = Date.now() - 60_000;

    // Invites and adding someone to an expense by email
    const invited = await db.user.create({
      data: { email: 'invited@example.com', name: 'invited' },
    });
    // The Splitwise import
    await db.user.createMany({ data: [{ email: 'imported@example.com', name: 'Imported' }] });
    // NextAuth sign-ups on the web, and the app's email, Google and Apple sign-ins
    // next-auth types the adapter as `any` here, see mobileAuth.ts
    const createUser = authAdapter.createUser as unknown as (user: {
      email: string;
      emailVerified: Date;
      name: null;
      image: null;
    }) => Promise<{ createdAt: Date | null }>;
    const signedUp = await createUser({
      email: 'signedup@example.com',
      emailVerified: new Date(),
      name: null,
      image: null,
    });

    const rows = await db.user.findMany({
      where: {
        email: { in: ['invited@example.com', 'imported@example.com', 'signedup@example.com'] },
      },
    });
    assert.equal(rows.length, 3);
    rows.forEach(({ email, createdAt }) => {
      assert.ok(createdAt, email ?? '');
      assert.ok(createdAt.getTime() >= startedAt, email ?? '');
      assert.ok(createdAt.getTime() <= Date.now() + 60_000, email ?? '');
    });
    assert.ok(invited.createdAt);
    assert.ok(signedUp.createdAt);
  },
);

const expenseBy = (
  id: string,
  addedBy: number,
  createdAt: Date,
  { paidBy = addedBy, participants = [addedBy] }: { paidBy?: number; participants?: number[] } = {},
) =>
  db.expense.create({
    data: {
      id,
      addedBy,
      paidBy,
      name: id,
      category: 'general',
      amount: 100,
      currency: 'USD',
      createdAt,
      expenseDate: createdAt,
      expenseParticipants: { create: participants.map((userId) => ({ userId, amount: 0 })) },
    },
  });

/** A user from before `createdAt` existed: no value until the backfill fills one in. */
const legacyUser = (id: number, data: Record<string, unknown> = {}) =>
  db.user.create({ data: { id, email: `b${id}@example.com`, createdAt: null, ...data } });

const createdAtById = async () =>
  Object.fromEntries(
    (await db.user.findMany({ select: { id: true, createdAt: true }, orderBy: { id: 'asc' } })).map(
      (row) => [row.id, row.createdAt?.toISOString() ?? null],
    ),
  );

void test(
  'createdAt backfill: estimates only from times the user already existed at',
  { skip: !databaseUrl },
  async () => {
    await clearAll();
    const cap = (
      await db.$queryRaw<{ finished_at: Date }[]>`
      SELECT "finished_at" FROM "_prisma_migrations"
      WHERE "migration_name" = '20261117120000_add_user_created_at'
    `
    )[0]!.finished_at;

    const alice = await legacyUser(1, { emailVerified: at('2026-09-01T00:00:00') });
    // Invited recently, then added as payer and participant to an expense from 2020
    const invited = await legacyUser(2);
    const appUser = await legacyUser(3);
    const sessionOnly = await legacyUser(4);
    const renewed = await legacyUser(5);
    const groupOwner = await legacyUser(6);
    const deviceUser = await legacyUser(7);

    await expenseBy('old', alice.id, at('2020-01-01T00:00:00'), {
      paidBy: invited.id,
      participants: [alice.id, invited.id],
    });
    await db.balance.create({
      data: {
        userId: invited.id,
        friendId: alice.id,
        currency: 'USD',
        amount: 0,
        createdAt: at('2026-11-10T00:00:00'),
      },
    });

    // Imported feedback carries an external time; feedback sent from the app counts
    await db.feedback.createMany({
      data: [
        {
          userId: appUser.id,
          email: 'x@example.com',
          message: 'old',
          source: 'import',
          createdAt: at('2019-05-01T00:00:00'),
        },
        {
          userId: appUser.id,
          email: 'x@example.com',
          message: 'new',
          source: 'ios',
          createdAt: at('2026-04-01T00:00:00'),
        },
      ],
    });

    await db.session.createMany({
      data: [
        { sessionToken: 's1', userId: sessionOnly.id, expires: at('2026-07-31T00:00:00') },
        // Renewed now by the app, expiring months after the column was added: capped
        { sessionToken: 's2', userId: renewed.id, expires: new Date(Date.now() + 180 * 86400e3) },
      ],
    });

    // Groups change owner when one leaves, so owning an old group says nothing
    await db.group.create({
      data: {
        publicId: 'old-group',
        name: 'Old',
        userId: groupOwner.id,
        createdAt: at('2019-01-01T00:00:00'),
      },
    });

    // A token registered by someone else long ago, now moved to this user
    await db.devicePushToken.create({
      data: {
        userId: deviceUser.id,
        token: 'tok',
        platform: 'ios',
        createdAt: at('2018-01-01T00:00:00'),
      },
    });
    const { updatedAt: movedAt } = await db.devicePushToken.update({
      where: { token: 'tok' },
      data: { updatedAt: at('2026-10-01T00:00:00') },
    });

    const result = await backfill.backfillUserCreatedAt(db);
    assert.deepEqual(result, { batches: 1, updated: 6 });

    const createdAt = await createdAtById();
    assert.deepEqual(createdAt, {
      // Added the 2020 expense themselves
      1: '2020-01-01T00:00:00.000Z',
      // Their balance, not the old expense they were added to
      2: '2026-11-10T00:00:00.000Z',
      3: '2026-04-01T00:00:00.000Z',
      4: '2026-07-01T00:00:00.000Z',
      5: cap.toISOString(),
      6: null,
      7: movedAt.toISOString(),
    });
  },
);

void test(
  'createdAt backfill: keeps exact times, changes nothing when run again, covers every batch',
  { skip: !databaseUrl },
  async () => {
    await clearAll();

    // Created after the column was added: its exact time stays, despite older activity
    const exact = await db.user.create({ data: { id: 1, email: 'exact@example.com' } });
    assert.ok(exact.createdAt);
    await expenseBy('older', exact.id, at('2020-01-01T00:00:00'));

    // Seven legacy users with a signal, one without, across batches of two
    await Promise.all(
      [2, 3, 4, 5, 6, 7, 8].map((id) =>
        legacyUser(id, { emailVerified: at(`2026-0${id}-01T00:00:00`) }),
      ),
    );
    await legacyUser(9);

    const first = await backfill.backfillUserCreatedAt(db, { batchSize: 2 });
    assert.deepEqual(first, { batches: 4, updated: 7 });

    const after = await createdAtById();
    assert.equal(after[1], exact.createdAt.toISOString());
    [2, 3, 4, 5, 6, 7, 8].forEach((id) => {
      assert.equal(after[id], `2026-0${id}-01T00:00:00.000Z`, `user ${id}`);
    });
    assert.equal(after[9], null);

    // Only user 9 is left to look at, and it still has nothing
    const second = await backfill.backfillUserCreatedAt(db, { batchSize: 2 });
    assert.deepEqual(second, { batches: 1, updated: 0 });
    assert.deepEqual(await createdAtById(), after);
  },
);

void test(
  'data migrations: run once, and a failure is logged without stopping startup',
  { skip: !databaseUrl },
  async () => {
    await clearAll();
    const runs: string[] = [];
    const errors: unknown[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => errors.push(args);
    console.log = () => undefined;

    try {
      const ok = { version: '1.0.0', name: 'ok', run: async () => runs.push('ok') };
      const failing = {
        version: '1.1.0',
        name: 'failing',
        run: async () => {
          runs.push('failing');
          throw new Error('boom user@example.com');
        },
      };

      assert.equal(await migrations.runDataMigrations(db, [ok, failing]), false);
      const version = () =>
        db.appMetadata.findUnique({ where: { key: migrations.DATA_VERSION_KEY } });
      assert.equal((await version())?.value, '1.0.0');
      assert.ok(!JSON.stringify(errors).includes('user@example.com'));

      // Next start: only the failed one runs again
      assert.equal(
        await migrations.runDataMigrations(db, [
          ok,
          { ...failing, run: async () => runs.push('fixed') },
        ]),
        true,
      );
      assert.deepEqual(runs, ['ok', 'failing', 'fixed']);
      assert.equal((await version())?.value, '1.1.0');

      // The real list marks the backfill done for the stats
      await db.appMetadata.deleteMany();
      assert.equal(await migrations.runDataMigrations(db), true);
      const result = await stats.getAdminStats(db, { days: 1, now: NOW });
      assert.equal(result.newUsersBackfilled, true);
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
  },
);
