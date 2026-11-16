import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { DATA_VERSION_KEY, USER_CREATED_AT_BACKFILL_VERSION } from '~/migrations';
import { CREATED_AT_MIGRATION, getCreatedAtExactSince } from '~/server/userCreatedAt';

/**
 * Read-only growth numbers for the internal admin API (GET /api/admin/stats).
 *
 * Definitions, all in UTC:
 * - A *user* is a live account (`deletedAt` null) that has signed in at least once: it has a linked
 *   OAuth account or a verified email. Rows made when someone was invited or added to an expense,
 *   who never signed in, are counted apart as `invitedUsers`. Deleted (anonymised) rows are never
 *   counted as users.
 * - *New users* are users whose `User.createdAt` falls on that day (`newUsersMethod`). Rows from
 *   before that column existed hold an estimate (see `backfillUserCreatedAt`) once
 *   `newUsersBackfilled`, so days before `newUsersExactSince` are approximate and users without
 *   any signal are missing from them. Someone invited first and signing in later counts on the
 *   day they were invited.
 * - An *expense event* is an expense that isn't deleted and was added by a person: occurrences the
 *   recurring runner created on its own (`recurringId` set and not the rule's first date) are
 *   left out of activity and counted as `recurringCreated` instead. Its time is `Expense.createdAt`.
 * - *Active users* (`activeUsers`) are distinct users who added, paid for or took part in an expense
 *   event in the period, settlements included. `activeCreators` counts only those who added one,
 *   the stricter signal that they opened the app. Weekly and monthly numbers are distinct users in
 *   that ISO week or calendar month, not sums of days.
 * - There's no record of which app an expense was added from, so there is no per-platform split of
 *   expenses (`platforms` is null). Push devices by platform are in the totals.
 */

export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 90;
export const WEEKS = 12;
export const MONTHS = 6;
const STATEMENT_TIMEOUT_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const adminStatsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_DAYS)
    .transform((days) => Math.min(days, MAX_DAYS)),
});

type Db = Pick<PrismaClient, '$transaction'>;
type Tx = Prisma.TransactionClient;

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** `YYYY-MM-DD` of a UTC date. */
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** `YYYY-MM` of a UTC date. */
export const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/** ISO week label, like `2026-W47`. */
export const isoWeekKey = (date: Date) => {
  const day = startOfUtcDay(date);
  // The Thursday of its week decides the ISO year
  const thursday = addDays(day, 3 - ((day.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = 1 + Math.floor((thursday.getTime() - yearStart.getTime()) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/**
 * The periods the stats cover, ending today (UTC). Each list is oldest first.
 */
export const statsPeriods = (now: Date, days: number) => {
  const today = startOfUtcDay(now);
  const monday = addDays(today, -((today.getUTCDay() + 6) % 7));

  const dayStarts = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => addDays(monday, (i - WEEKS + 1) * 7));
  const monthStarts = Array.from(
    { length: MONTHS },
    (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i - MONTHS + 1, 1)),
  );

  const firstDay = dayStarts[0]!;
  const since = [firstDay, weekStarts[0]!, monthStarts[0]!].reduce((a, b) => (a < b ? a : b));

  return { dayStarts, weekStarts, monthStarts, firstDay, since, end: addDays(today, 1) };
};

/**
 * The counts for each key, in order: the matching row's `fields` as numbers, 0 where it has none.
 */
export const zeroFill = <K extends string>(
  keys: string[],
  rows: ({ key: string } & Record<string, unknown>)[],
  fields: readonly K[],
) => {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return keys.map(
    (key) =>
      Object.fromEntries(
        fields.map((field) => [field, Number(byKey.get(key)?.[field] ?? 0)]),
      ) as Record<K, number>,
  );
};

/** Timestamps are stored as UTC `timestamp(3)`, so compare against UTC wall time. */
const ts = (date: Date) => Prisma.sql`${date.toISOString().slice(0, 23)}::timestamp`;

/**
 * Users who have signed in at least once: `u` is the "User" row, joined with `SIGNED_IN_JOIN`. A join
 * on the few users with an OAuth link, so it is hashed once rather than looked up per row.
 */
const SIGNED_IN_JOIN = Prisma.sql`LEFT JOIN (SELECT DISTINCT "userId" FROM "Account") acc
  ON acc."userId" = u."id"`;
const SIGNED_IN = Prisma.sql`(u."emailVerified" IS NOT NULL OR acc."userId" IS NOT NULL)`;

/** Expenses the recurring runner created on its own: `e` is the "Expense", `r` its rule. */
const AUTO_RECURRING = Prisma.sql`(e."recurringId" IS NOT NULL
  AND e."occurrenceDate" IS DISTINCT FROM r."startDate")`;

type CountRow = Record<string, bigint | number | string | null>;
type KeyedRow = CountRow & { key: string };

const getTotals = async (tx: Tx) => {
  const [row] = await tx.$queryRaw<CountRow[]>`
    SELECT
      users.*,
      expenses.*,
      (SELECT COUNT(*) FROM "Group") AS "groups",
      (SELECT COUNT(*) FROM "RecurringExpense" WHERE "status" = 'ACTIVE') AS "activeRecurringRules",
      (SELECT COUNT(*) FROM "PushNotification" p
        JOIN "User" u ON u."id" = p."userId" WHERE u."deletedAt" IS NULL) AS "webPushUsers"
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE u."deletedAt" IS NULL AND ${SIGNED_IN}) AS "users",
        COUNT(*) FILTER (WHERE u."deletedAt" IS NULL AND NOT ${SIGNED_IN}) AS "invitedUsers",
        COUNT(*) FILTER (WHERE u."deletedAt" IS NOT NULL) AS "deletedUsers"
      FROM "User" u
      ${SIGNED_IN_JOIN}
    ) AS users, (
      SELECT
        COUNT(*) FILTER (WHERE "splitType" <> 'SETTLEMENT') AS "expenses",
        COUNT(*) FILTER (WHERE "splitType" = 'SETTLEMENT') AS "settlements"
      FROM "Expense"
      WHERE "deletedAt" IS NULL
    ) AS expenses
  `;

  const devices = await tx.$queryRaw<{ platform: string; devices: bigint; users: bigint }[]>`
    SELECT d."platform", COUNT(*) AS "devices", COUNT(DISTINCT d."userId") AS "users"
    FROM "DevicePushToken" d
    JOIN "User" u ON u."id" = d."userId"
    WHERE u."deletedAt" IS NULL
    GROUP BY d."platform"
    ORDER BY d."platform"
  `;

  const n = (key: string) => Number(row?.[key] ?? 0);
  return {
    users: n('users'),
    invitedUsers: n('invitedUsers'),
    deletedUsers: n('deletedUsers'),
    groups: n('groups'),
    expenses: n('expenses'),
    settlements: n('settlements'),
    activeRecurringRules: n('activeRecurringRules'),
    pushDevices: {
      /** Native app installs with push on, by platform (`ios`, `android`) */
      native: Object.fromEntries(
        devices.map(({ platform, devices, users }) => [
          platform,
          { devices: Number(devices), users: Number(users) },
        ]),
      ),
      /** Users with browser push on: one subscription per user */
      webPushUsers: n('webPushUsers'),
    },
  };
};

const getDailyCounts = async (tx: Tx, firstDay: Date, end: Date) => {
  const expenses = await tx.$queryRaw<KeyedRow[]>`
    SELECT
      to_char(date_trunc('day', e."createdAt"), 'YYYY-MM-DD') AS "key",
      COUNT(*) FILTER (WHERE e."splitType" <> 'SETTLEMENT' AND NOT ${AUTO_RECURRING})
        AS "expensesCreated",
      COUNT(*) FILTER (WHERE e."splitType" = 'SETTLEMENT' AND NOT ${AUTO_RECURRING})
        AS "settlements",
      COUNT(*) FILTER (WHERE ${AUTO_RECURRING}) AS "recurringCreated"
    FROM "Expense" e
    LEFT JOIN "RecurringExpense" r ON r."id" = e."recurringId"
    WHERE e."deletedAt" IS NULL AND e."createdAt" >= ${ts(firstDay)} AND e."createdAt" < ${ts(end)}
    GROUP BY 1
  `;

  const groups = await tx.$queryRaw<KeyedRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "key", COUNT(*) AS "groupsCreated"
    FROM "Group"
    WHERE "createdAt" >= ${ts(firstDay)} AND "createdAt" < ${ts(end)}
    GROUP BY 1
  `;

  const users = await tx.$queryRaw<KeyedRow[]>`
    SELECT
      to_char(date_trunc('day', u."createdAt"), 'YYYY-MM-DD') AS "key",
      COUNT(*) FILTER (WHERE ${SIGNED_IN}) AS "newUsers",
      COUNT(*) FILTER (WHERE NOT ${SIGNED_IN}) AS "newInvitedUsers"
    FROM "User" u
    ${SIGNED_IN_JOIN}
    WHERE u."deletedAt" IS NULL AND u."createdAt" >= ${ts(firstDay)} AND u."createdAt" < ${ts(end)}
    GROUP BY 1
  `;

  return { expenses, groups, users };
};

/**
 * Distinct active users per day, ISO week and month, from one scan of the expense events since
 * `since`.
 */
const getActiveUsers = async (
  tx: Tx,
  {
    since,
    firstDay,
    firstWeek,
    firstMonth,
    end,
  }: { since: Date; firstDay: Date; firstWeek: Date; firstMonth: Date; end: Date },
) =>
  tx.$queryRaw<(KeyedRow & { unit: 'day' | 'week' | 'month' })[]>`
    WITH "events" AS (
      SELECT e."id", e."createdAt", e."addedBy", e."paidBy"
      FROM "Expense" e
      LEFT JOIN "RecurringExpense" r ON r."id" = e."recurringId"
      WHERE e."deletedAt" IS NULL
        AND e."createdAt" >= ${ts(since)} AND e."createdAt" < ${ts(end)}
        AND NOT ${AUTO_RECURRING}
    ),
    "involved" AS (
      SELECT "createdAt" AS "at", "addedBy" AS "userId", TRUE AS "creator" FROM "events"
      UNION ALL SELECT "createdAt", "paidBy", FALSE FROM "events"
      UNION ALL
        SELECT ev."createdAt", ep."userId", FALSE
        FROM "events" ev
        JOIN "ExpenseParticipant" ep ON ep."expenseId" = ev."id"
    ),
    "active" AS MATERIALIZED (
      SELECT i."at", i."userId", i."creator"
      FROM "involved" i
      JOIN "User" u ON u."id" = i."userId"
      ${SIGNED_IN_JOIN}
      WHERE u."deletedAt" IS NULL AND ${SIGNED_IN}
    )
    SELECT 'day' AS "unit", to_char(date_trunc('day', "at"), 'YYYY-MM-DD') AS "key",
      COUNT(DISTINCT "userId") AS "activeUsers",
      COUNT(DISTINCT "userId") FILTER (WHERE "creator") AS "activeCreators"
    FROM "active" WHERE "at" >= ${ts(firstDay)} GROUP BY 2
    UNION ALL
    SELECT 'week', to_char(date_trunc('week', "at"), 'YYYY-MM-DD'),
      COUNT(DISTINCT "userId"), COUNT(DISTINCT "userId") FILTER (WHERE "creator")
    FROM "active" WHERE "at" >= ${ts(firstWeek)} GROUP BY 2
    UNION ALL
    SELECT 'month', to_char(date_trunc('month', "at"), 'YYYY-MM'),
      COUNT(DISTINCT "userId"), COUNT(DISTINCT "userId") FILTER (WHERE "creator")
    FROM "active" WHERE "at" >= ${ts(firstMonth)} GROUP BY 2
  `;

const ACTIVE_FIELDS = ['activeUsers', 'activeCreators'] as const;

const isBackfilled = (dataVersion: string | null) =>
  null !== dataVersion && dataVersion >= USER_CREATED_AT_BACKFILL_VERSION;

/** How `newUsers` is counted, with the date it became exact. */
export const newUsersMethod = (exactSince: Date | null) =>
  `createdAt (estimated before ${exactSince ? dayKey(exactSince) : CREATED_AT_MIGRATION})`;

export const getAdminStats = async (
  db: Db,
  { days, now = new Date() }: { days: number; now?: Date },
) => {
  const periods = statsPeriods(now, Math.min(Math.max(1, Math.trunc(days)), MAX_DAYS));
  const { firstDay, since, end } = periods;

  // One read-only snapshot, so the numbers agree with each other. Each statement is capped, and
  // nothing waits long behind a lock.
  const data = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = 1000`);

      const totals = await getTotals(tx);
      const daily = await getDailyCounts(tx, firstDay, end);
      const active = await getActiveUsers(tx, {
        since,
        firstDay,
        firstWeek: periods.weekStarts[0]!,
        firstMonth: periods.monthStarts[0]!,
        end,
      });
      const exactSince = await getCreatedAtExactSince(tx);
      const [version] = await tx.$queryRaw<{ value: string }[]>`
        SELECT "value" FROM "AppMetadata" WHERE "key" = ${DATA_VERSION_KEY}
      `;
      return { totals, daily, active, exactSince, dataVersion: version?.value ?? null };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 },
  );

  const activeOf = (unit: string) => data.active.filter((row) => unit === row.unit);
  const dayKeys = periods.dayStarts.map(dayKey);

  const newUsers = zeroFill(dayKeys, data.daily.users, ['newUsers', 'newInvitedUsers']);
  const expenses = zeroFill(dayKeys, data.daily.expenses, [
    'expensesCreated',
    'settlements',
    'recurringCreated',
  ]);
  const groups = zeroFill(dayKeys, data.daily.groups, ['groupsCreated']);
  const activeDays = zeroFill(dayKeys, activeOf('day'), ACTIVE_FIELDS);
  const activeWeeks = zeroFill(periods.weekStarts.map(dayKey), activeOf('week'), ACTIVE_FIELDS);
  const monthKeys = periods.monthStarts.map(monthKey);
  const activeMonths = zeroFill(monthKeys, activeOf('month'), ACTIVE_FIELDS);

  return {
    generatedAt: now.toISOString(),
    days: dayKeys.length,
    newUsersMethod: newUsersMethod(data.exactSince),
    /** Days before this are estimates from earliest activity; null if unknown */
    newUsersExactSince: data.exactSince?.toISOString() ?? null,
    /** Whether the estimates for users from before then have been filled in yet */
    newUsersBackfilled: isBackfilled(data.dataVersion),
    totals: data.totals,
    daily: dayKeys.map((date, i) => ({
      date,
      ...newUsers[i]!,
      ...activeDays[i]!,
      ...expenses[i]!,
      ...groups[i]!,
    })),
    weekly: periods.weekStarts.map((start, i) => ({
      week: isoWeekKey(start),
      start: dayKey(start),
      ...activeWeeks[i]!,
    })),
    monthly: monthKeys.map((month, i) => ({ month, ...activeMonths[i]! })),
    platforms: null,
  };
};

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
