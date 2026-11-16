import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.SKIP_ENV_VALIDATION = '1';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:1/unused';
const TOKEN = 'b'.repeat(40);
process.env.ADMIN_API_TOKEN = TOKEN;

const { adminStatsQuery, isoWeekKey, newUsersMethod, statsPeriods, zeroFill } = await import(
  '~/server/api/services/adminStats'
);
const { default: statsRoute } = await import('~/pages/api/admin/stats');
const { env } = await import('~/env');

void describe('adminStatsQuery', () => {
  void it('defaults to 90 days and caps at 365', () => {
    assert.equal(adminStatsQuery.parse({}).days, 90);
    assert.equal(adminStatsQuery.parse({ days: '30' }).days, 30);
    assert.equal(adminStatsQuery.parse({ days: '9999' }).days, 365);
  });

  void it('rejects days that are not a positive whole number', () => {
    ['0', '-1', '1.5', 'abc'].forEach((days) => {
      assert.equal(adminStatsQuery.safeParse({ days }).success, false, days);
    });
  });
});

void describe('statsPeriods', () => {
  // A Wednesday, late in the day
  const now = new Date('2026-11-18T23:30:00Z');

  void it('covers the last `days` UTC days, ending today', () => {
    const { dayStarts, end } = statsPeriods(now, 3);
    assert.deepEqual(
      dayStarts.map((day) => day.toISOString()),
      ['2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z', '2026-11-18T00:00:00.000Z'],
    );
    assert.equal(end.toISOString(), '2026-11-19T00:00:00.000Z');
  });

  void it('covers 12 ISO weeks from Monday and 6 calendar months', () => {
    const { weekStarts, monthStarts, since } = statsPeriods(now, 1);
    assert.equal(weekStarts.length, 12);
    assert.equal(weekStarts.at(-1)!.toISOString(), '2026-11-16T00:00:00.000Z');
    assert.equal(weekStarts[0]!.toISOString(), '2026-08-31T00:00:00.000Z');
    assert.deepEqual(
      monthStarts.map((month) => month.toISOString().slice(0, 7)),
      ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
    );
    // Data is read from the earliest of the three
    assert.equal(since.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  void it('crosses year ends', () => {
    const { monthStarts } = statsPeriods(new Date('2027-02-10T00:00:00Z'), 1);
    assert.equal(monthStarts[0]!.toISOString().slice(0, 7), '2026-09');
  });
});

void describe('isoWeekKey', () => {
  void it('uses the ISO year of the week', () => {
    assert.equal(isoWeekKey(new Date('2026-11-16T00:00:00Z')), '2026-W47');
    // Thursday 1 January 2026 starts week 1
    assert.equal(isoWeekKey(new Date('2025-12-29T00:00:00Z')), '2026-W01');
    // Friday 1 January 2027 is still in 2026's last week
    assert.equal(isoWeekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  });
});

void describe('zeroFill', () => {
  void it('keeps every key, in order, with zeros where there is no row', () => {
    const filled = zeroFill(
      ['2026-11-16', '2026-11-17', '2026-11-18'],
      [
        { key: '2026-11-17', newUsers: 3n, extra: 'ignored' },
        { key: '2026-11-01', newUsers: 9n },
      ],
      ['newUsers', 'groupsCreated'] as const,
    );
    assert.deepEqual(filled, [
      { newUsers: 0, groupsCreated: 0 },
      { newUsers: 3, groupsCreated: 0 },
      { newUsers: 0, groupsCreated: 0 },
    ]);
  });
});

void describe('newUsersMethod', () => {
  void it('says from when createdAt is exact', () => {
    assert.equal(
      newUsersMethod(new Date('2026-11-20T08:00:00Z')),
      'createdAt (estimated before 2026-11-20)',
    );
    assert.match(newUsersMethod(null), /^createdAt \(estimated before 20261117120000_/);
  });
});

void describe('GET /api/admin/stats', () => {
  const call = async (authorization?: string, method = 'GET') => {
    const sent = { status: 0, body: undefined as unknown };
    const res = {
      setHeader: () => res,
      status: (status: number) => {
        sent.status = status;
        return res;
      },
      json: (value: unknown) => {
        sent.body = value;
        return res;
      },
    };
    const req = { method, query: {}, headers: { authorization } };
    await statsRoute(req as never, res as never);
    return sent;
  };

  void it('needs the admin token', async () => {
    assert.equal((await call()).status, 401);
    assert.equal((await call('Bearer wrong')).status, 401);
    assert.equal((await call(`Bearer ${TOKEN}`, 'POST')).status, 405);
  });

  void it('is not found when no admin token is set', async () => {
    const mutableEnv = env as { ADMIN_API_TOKEN?: string };
    mutableEnv.ADMIN_API_TOKEN = undefined;
    try {
      assert.equal((await call(`Bearer ${TOKEN}`)).status, 404);
    } finally {
      mutableEnv.ADMIN_API_TOKEN = TOKEN;
    }
  });

  void it('rejects bad query params before touching the db', async () => {
    const sent = { status: 0 };
    const res = {
      setHeader: () => res,
      status: (status: number) => {
        sent.status = status;
        return res;
      },
      json: () => res,
    };
    const req = {
      method: 'GET',
      query: { days: 'lots' },
      headers: { authorization: `Bearer ${TOKEN}` },
    };
    await statsRoute(req as never, res as never);
    assert.equal(sent.status, 400);
  });
});
