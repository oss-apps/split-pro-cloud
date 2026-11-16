import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { type PrismaClient } from '@prisma/client';

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

  [{ db }, stats] = await Promise.all([
    import('~/server/db'),
    import('~/server/api/services/adminStats'),
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
      "PushNotification" RESTART IDENTITY CASCADE`,
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

/** The backfill statement of the createdAt migration, run again on rows without one. */
const backfillSql = () => {
  const sql = readFileSync(
    'prisma/migrations/20261117120000_add_user_created_at/migration.sql',
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statement = sql.split(';').find((part) => part.trim().startsWith('WITH'));
  assert.ok(statement, 'backfill statement');
  return statement;
};

void test(
  'admin stats: the createdAt backfill estimates from earliest activity',
  { skip: !databaseUrl },
  async () => {
    await clearAll();
    const make = (id: number, data: Record<string, unknown> = {}) =>
      db.user.create({ data: { id, email: `b${id}@example.com`, ...data } });

    const payer = await make(1, { emailVerified: at('2026-09-01T00:00:00') });
    const participant = await make(2);
    const sessionOnly = await make(3);
    // Nothing tied to them
    await make(4);
    const friendOnly = await make(5);
    const renewed = await make(6);

    await db.expense.create({
      data: {
        id: 'x1',
        addedBy: payer.id,
        paidBy: payer.id,
        name: 'x1',
        category: 'general',
        amount: 100,
        currency: 'USD',
        createdAt: at('2026-03-01T10:00:00'),
        // Before the user existed: the expense date must not be used
        expenseDate: at('2020-01-01T00:00:00'),
        expenseParticipants: {
          create: [
            { userId: payer.id, amount: 0 },
            { userId: participant.id, amount: 0 },
          ],
        },
      },
    });
    await db.friendship.create({
      data: { userId: payer.id, friendId: friendOnly.id, createdAt: at('2026-02-01T00:00:00') },
    });
    await db.session.create({
      data: { sessionToken: 's1', userId: sessionOnly.id, expires: at('2026-07-31T00:00:00') },
    });
    // A session renewed today, which expires after the backfill runs: capped at now
    await db.session.create({
      data: {
        sessionToken: 's2',
        userId: renewed.id,
        expires: new Date(Date.now() + 180 * 86400e3),
      },
    });

    await db.$executeRawUnsafe(`UPDATE "User" SET "createdAt" = NULL`);
    await db.$executeRawUnsafe(backfillSql());

    const rows = await db.user.findMany({ select: { id: true, createdAt: true } });
    const renewedAt = rows.find(({ id }) => renewed.id === id)?.createdAt?.getTime() ?? 0;
    assert.ok(Math.abs(Date.now() - renewedAt) < 60_000, 'capped at now');

    const createdAt = Object.fromEntries(
      rows
        .filter(({ id }) => renewed.id !== id)
        .map((row) => [row.id, row.createdAt?.toISOString() ?? null]),
    );
    assert.deepEqual(createdAt, {
      // Friendship (Feb) is earlier than the expense and emailVerified
      1: '2026-02-01T00:00:00.000Z',
      2: '2026-03-01T10:00:00.000Z',
      3: '2026-07-01T00:00:00.000Z',
      // Nothing tied to them: left null
      4: null,
      5: '2026-02-01T00:00:00.000Z',
    });
  },
);
