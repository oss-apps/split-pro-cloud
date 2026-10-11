import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** Who notifications were looked up for, without sending any. */
const notifiedUserIds: number[] = [];
/** Lets notifications sent after a save look up who gets them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [
    prisma,
    { TRPCError },
    { db },
    splitService,
    { appRouter },
    runner,
    recurrence,
    health,
    recurringService,
  ] = await Promise.all([
    import('@prisma/client'),
    import('@trpc/server'),
    import('~/server/db'),
    import('~/server/api/services/splitService'),
    import('~/server/api/root'),
    import('~/server/api/services/recurringRunner'),
    import('~/utils/recurrence'),
    import('~/pages/api/healthz'),
    import('~/server/api/services/recurringService'),
  ]);

  db.pushNotification.findMany = (async (args: {
    where: { userId: number | { in: number[] } };
  }) => {
    const { userId } = args.where;
    notifiedUserIds.push(...('number' === typeof userId ? [userId] : userId.in));
    return [];
  }) as unknown as typeof db.pushNotification.findMany;

  const suffix = `${Date.now()}-${Math.random()}`;
  const userIds: number[] = [];
  const createUser = async (name: string) => {
    const user = await db.user.create({
      data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name, currency: 'USD' },
    });
    userIds.push(user.id);
    return user;
  };

  const createGroup = async (name: string, ownerId: number, memberIds: number[]) => {
    const group = await db.group.create({
      data: { name, publicId: `${name.toLowerCase()}-${suffix}`, userId: ownerId },
    });
    await db.groupUser.createMany({
      data: memberIds.map((userId) => ({ groupId: group.id, userId })),
    });
    return group;
  };

  type TestUser = { id: number; name: string | null; email: string | null };
  const callerFor = (user: TestUser) =>
    appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });

  const d = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return { year: year!, month: month!, day: day! };
  };

  /** Adds an expense split equally between everyone, through the API like the app does. */
  const addEqualExpense = (
    user: TestUser,
    {
      groupId,
      amount,
      userIds: participantIds,
      date,
      frequency,
      timezone = 'UTC',
    }: {
      groupId?: number;
      amount: number;
      userIds: number[];
      date: string;
      frequency?: (typeof recurrence.RECURRING_FREQUENCIES)[number];
      timezone?: string;
    },
  ) => {
    const share = Math.round((amount * 100) / participantIds.length) / 100;
    const input = {
      paidBy: user.id,
      name: 'Rent',
      category: 'rent',
      amount,
      splitType: prisma.SplitType.EQUAL,
      currency: 'USD',
      participants: participantIds.map((id) => ({
        userId: id,
        amount: id === user.id ? amount - share : -share,
      })),
      expenseDate: new Date(`${date}T12:00:00Z`),
      recurrence: frequency ? { frequency, timezone } : undefined,
    };
    return groupId
      ? callerFor(user).group.addOrEditExpense({ ...input, groupId })
      : callerFor(user).user.addOrEditExpense(input);
  };

  const getRule = async (expenseId: string) => {
    const expense = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
    assert.ok(expense.recurringId);
    return db.recurringExpense.findUniqueOrThrow({ where: { id: expense.recurringId } });
  };

  /** Moves a rule's next date, as if time had passed. */
  const setNext = (ruleId: number, date: string, timezone = 'UTC') =>
    db.recurringExpense.update({
      where: { id: ruleId },
      data: {
        nextOccurrenceDate: recurrence.toDbDate(d(date)),
        nextOccurrenceAt: recurrence.getDueAt(d(date), timezone),
      },
    });

  const occurrences = (ruleId: number) =>
    db.expense.findMany({
      where: { recurringId: ruleId },
      orderBy: { occurrenceDate: 'asc' },
      include: { expenseParticipants: { orderBy: { userId: 'asc' } } },
    });

  const dates = async (ruleId: number) =>
    (await occurrences(ruleId)).map((e) =>
      recurrence.formatLocalDate(recurrence.fromDbDate(e.occurrenceDate!)),
    );

  /** Balance and GroupBalance hold exactly what the expenses of these users add up to. */
  const assertBalancesMatchExpenses = async (ids: number[]) => {
    const expenses = await db.expense.findMany({
      where: { deletedAt: null, expenseParticipants: { some: { userId: { in: ids } } } },
      include: { expenseParticipants: true },
    });
    const expected = new Map<string, number>();
    const add = (key: string, amount: number) =>
      expected.set(key, (expected.get(key) ?? 0) + amount);
    expenses.forEach((e) =>
      e.expenseParticipants
        .filter((p) => p.userId !== e.paidBy)
        .forEach((p) => {
          // Every expense moves `Balance`, a group expense also its `GroupBalance`.
          (null === e.groupId ? [null] : [null, e.groupId]).forEach((groupId) => {
            add(`${groupId}:${e.paidBy}:${p.userId}:${e.currency}`, -p.amount);
            add(`${groupId}:${p.userId}:${e.paidBy}:${e.currency}`, p.amount);
          });
        }),
    );

    const [balances, groupBalances] = await Promise.all([
      db.balance.findMany({ where: { userId: { in: ids } } }),
      db.groupBalance.findMany({ where: { userId: { in: ids } } }),
    ]);
    const actual = new Map<string, number>([
      ...balances.map((b) => [`null:${b.userId}:${b.friendId}:${b.currency}`, b.amount] as const),
      ...groupBalances.map(
        (b) => [`${b.groupId}:${b.userId}:${b.firendId}:${b.currency}`, b.amount] as const,
      ),
    ]);
    const nonZero = (map: Map<string, number>) =>
      Object.fromEntries([...map].filter(([, amount]) => 0 !== amount).sort());
    assert.deepEqual(nonZero(actual), nonZero(expected));
  };

  const cleanUp = () => db.user.deleteMany({ where: { id: { in: userIds } } });

  const isTrpcError = (code: string, message?: RegExp) => (error: unknown) => {
    assert.ok(error instanceof TRPCError, String(error));
    assert.equal(error.code, code);
    if (message) {
      assert.match(error.message, message);
    }
    return true;
  };

  return {
    ...prisma,
    db,
    ...splitService,
    ...runner,
    ...recurrence,
    ...recurringService,
    health: health.default,
    createUser,
    createGroup,
    callerFor,
    d,
    addEqualExpense,
    getRule,
    setNext,
    occurrences,
    dates,
    assertBalancesMatchExpenses,
    cleanUp,
    isTrpcError,
  };
};

void test(
  'occurrences copy the latest one through the add path, from the 31st to each month end',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Flat', alice.id, [alice.id, bob.id]);

      const source = await t.addEqualExpense(alice, {
        groupId: group.id,
        amount: 100,
        userIds: [alice.id, bob.id],
        date: '2026-01-31',
        frequency: 'MONTHLY',
      });
      const rule = await t.getRule(source.id);
      assert.equal(rule.status, 'ACTIVE');
      assert.equal(rule.groupId, group.id);
      assert.equal(rule.createdById, alice.id);
      assert.deepEqual(t.fromDbDate(rule.startDate), t.d('2026-01-31'));
      // Nothing is added for the months before it was set up.
      assert.ok(rule.nextOccurrenceAt >= t.getDueAt(t.getLocalDate(new Date(), 'UTC'), 'UTC'));

      await t.setNext(rule.id, '2026-02-28');
      assert.deepEqual(await t.runRecurringTick({ now: new Date('2026-02-27T23:59:59Z') }), {
        skipped: false,
        created: 0,
        paused: 0,
        deferred: 0,
        failed: 0,
      });

      await settle();
      notifiedUserIds.length = 0;
      const tick = await t.runRecurringTick({ now: new Date('2026-03-01T00:00:00Z') });
      assert.equal(tick.created, 1);
      assert.deepEqual(await t.dates(rule.id), ['2026-01-31', '2026-02-28']);
      const [, february] = await t.occurrences(rule.id);
      assert.ok(february);
      assert.equal(february.amount, 10_000);
      assert.equal(february.addedBy, alice.id);
      assert.equal(february.paidBy, alice.id);
      assert.equal(february.groupId, group.id);
      assert.equal(february.expenseDate.toISOString(), '2026-02-28T12:00:00.000Z');
      assert.deepEqual(
        february.expenseParticipants.map((p) => [p.userId, p.amount]),
        [
          [alice.id, 5000],
          [bob.id, -5000],
        ],
      );
      await settle();
      // Like a manual add: everyone but who added it.
      assert.deepEqual(notifiedUserIds, [bob.id]);
      await t.assertBalancesMatchExpenses([alice.id, bob.id]);
      assert.equal(
        (await t.db.balance.findFirst({ where: { userId: bob.id, friendId: alice.id } }))?.amount,
        -10_000,
      );

      // Bob edits the latest one. The next copies it.
      await t.callerFor(bob).group.addOrEditExpense({
        groupId: group.id,
        expenseId: february.id,
        paidBy: alice.id,
        name: 'Rent',
        category: 'rent',
        amount: 90,
        splitType: t.SplitType.EQUAL,
        currency: 'USD',
        participants: [
          { userId: alice.id, amount: 45 },
          { userId: bob.id, amount: -45 },
        ],
        expenseDate: february.expenseDate,
      });
      await t.runRecurringTick({ now: new Date('2026-04-01T00:00:00Z') });
      const latest = (await t.occurrences(rule.id)).at(-1);
      assert.deepEqual(await t.dates(rule.id), ['2026-01-31', '2026-02-28', '2026-03-31']);
      assert.equal(latest?.amount, 9000);
      assert.deepEqual(
        latest?.expenseParticipants.map((p) => p.amount),
        [4500, -4500],
      );
      const after = await t.db.recurringExpense.findUniqueOrThrow({ where: { id: rule.id } });
      assert.deepEqual(t.fromDbDate(after.nextOccurrenceDate), t.d('2026-04-30'));
      await t.assertBalancesMatchExpenses([alice.id, bob.id]);

      // Each runner tick records when it finished, for the health check.
      let body: unknown;
      await t.health(
        {} as never,
        {
          setHeader: () => undefined,
          status: () => ({ json: (value: unknown) => (body = value) }),
        } as never,
      );
      assert.equal((body as { ok: boolean }).ok, true);
      assert.ok(
        Date.now() -
          Date.parse((body as { recurringRunnerLastTickAt: string }).recurringRunnerLastTickAt) <
          60_000,
      );
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'occurrences follow local days across daylight saving changes',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Trip', alice.id, [alice.id, bob.id]);
      const source = await t.addEqualExpense(alice, {
        groupId: group.id,
        amount: 30,
        userIds: [alice.id, bob.id],
        date: '2026-03-06',
        frequency: 'DAILY',
        timezone: 'America/New_York',
      });
      const rule = await t.getRule(source.id);
      await t.setNext(rule.id, '2026-03-07', 'America/New_York');

      // 9 March starts at 04:00 UTC in New York, an hour earlier than the days before.
      await t.runRecurringTick({ now: new Date('2026-03-09T03:59:59Z') });
      assert.deepEqual(await t.dates(rule.id), ['2026-03-06', '2026-03-07', '2026-03-08']);
      await t.runRecurringTick({ now: new Date('2026-03-09T04:00:00Z') });
      const all = await t.occurrences(rule.id);
      assert.deepEqual(
        all.slice(1).map((e) => e.expenseDate.toISOString()),
        ['2026-03-07T17:00:00.000Z', '2026-03-08T16:00:00.000Z', '2026-03-09T16:00:00.000Z'],
      );
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'two runners at once add every occurrence exactly once and keep balances right',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const [alice, bob, carol] = await Promise.all(
        ['Alice', 'Bob', 'Carol'].map((name) => t.createUser(name)),
      );
      const big = await t.createGroup('Big', alice!.id, [alice!.id, bob!.id, carol!.id]);
      const small = await t.createGroup('Small', alice!.id, [alice!.id, bob!.id]);

      const ruleIds: number[] = [];
      for (const [index, payer] of [alice!, bob!, carol!, alice!].entries()) {
        const group = 2 < index && payer !== carol ? small : big;
        const members = group === small ? [alice!.id, bob!.id] : [alice!.id, bob!.id, carol!.id];
        const source = await t.addEqualExpense(payer, {
          groupId: group.id,
          amount: 10 + index,
          userIds: members,
          date: '2025-12-31',
          frequency: 'DAILY',
        });
        const rule = await t.getRule(source.id);
        await t.setNext(rule.id, '2026-01-01');
        ruleIds.push(rule.id);
      }
      // And one without a group.
      const personal = await t.addEqualExpense(alice!, {
        amount: 7,
        userIds: [alice!.id, carol!.id],
        date: '2025-12-31',
        frequency: 'DAILY',
      });
      const personalRule = await t.getRule(personal.id);
      await t.setNext(personalRule.id, '2026-01-01');
      ruleIds.push(personalRule.id);

      const now = new Date('2026-01-03T01:00:00Z');
      let created = 0;
      for (let round = 0; round < 10; round++) {
        const results = await Promise.all([
          t.runRecurringTick({ now }),
          t.runRecurringTick({ now }),
        ]);
        created += results.reduce((sum, result) => sum + result.created, 0);
        const due = await t.db.recurringExpense.count({
          where: { id: { in: ruleIds }, nextOccurrenceAt: { lte: now } },
        });
        if (0 === due) {
          break;
        }
      }

      assert.equal(created, 3 * ruleIds.length);
      for (const ruleId of ruleIds) {
        assert.deepEqual(await t.dates(ruleId), [
          '2025-12-31',
          '2026-01-01',
          '2026-01-02',
          '2026-01-03',
        ]);
      }
      await t.assertBalancesMatchExpenses([alice!.id, bob!.id, carol!.id]);
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'after downtime only the latest missed occurrences are added',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Flat', alice.id, [alice.id, bob.id]);
      const source = await t.addEqualExpense(alice, {
        groupId: group.id,
        amount: 20,
        userIds: [alice.id, bob.id],
        date: '2025-12-31',
        frequency: 'DAILY',
      });
      const rule = await t.getRule(source.id);
      await t.setNext(rule.id, '2026-01-01');

      const tick = await t.runRecurringTick({ now: new Date('2026-01-11T00:30:00Z') });
      assert.equal(tick.created, t.MAX_CATCH_UP_OCCURRENCES);
      assert.deepEqual(await t.dates(rule.id), [
        '2025-12-31',
        '2026-01-09',
        '2026-01-10',
        '2026-01-11',
      ]);
      const after = await t.db.recurringExpense.findUniqueOrThrow({ where: { id: rule.id } });
      assert.deepEqual(t.fromDbDate(after.nextOccurrenceDate), t.d('2026-01-12'));
      assert.equal(
        (await t.runRecurringTick({ now: new Date('2026-01-11T23:00:00Z') })).created,
        0,
      );
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'someone leaving pauses the rule and tells its creator, also when found by the runner',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const [alice, bob, carol] = await Promise.all(
        ['Alice', 'Bob', 'Carol'].map((name) => t.createUser(name)),
      );
      const group = await t.createGroup('Flat', alice!.id, [alice!.id, bob!.id, carol!.id]);
      const source = await t.addEqualExpense(alice!, {
        groupId: group.id,
        amount: 100,
        userIds: [alice!.id, bob!.id],
        date: '2026-01-01',
        frequency: 'WEEKLY',
      });
      const rule = await t.getRule(source.id);

      // Carol isn't in it: leaving changes nothing.
      await t.callerFor(carol!).group.leaveGroup({ groupId: group.id });
      assert.equal((await t.getRule(source.id)).status, 'ACTIVE');

      // Bob settles up and leaves.
      await t.callerFor(bob!).group.addOrEditExpense({
        groupId: group.id,
        paidBy: bob!.id,
        name: 'Settle up',
        category: 'general',
        amount: 50,
        splitType: t.SplitType.SETTLEMENT,
        currency: 'USD',
        participants: [
          { userId: bob!.id, amount: 50 },
          { userId: alice!.id, amount: -50 },
        ],
      });
      await settle();
      notifiedUserIds.length = 0;
      await t.callerFor(bob!).group.leaveGroup({ groupId: group.id });
      await settle();
      const paused = await t.getRule(source.id);
      assert.equal(paused.status, 'PAUSED');
      assert.equal(paused.statusReason, 'Bob left the group');
      assert.deepEqual(notifiedUserIds, [alice!.id]);

      await t.setNext(rule.id, '2026-01-08');
      assert.equal(
        (await t.runRecurringTick({ now: new Date('2026-02-01T00:00:00Z') })).created,
        0,
      );
      await assert.rejects(
        t.callerFor(alice!).recurring.setPaused({ ruleId: rule.id, paused: false }),
        t.isTrpcError('BAD_REQUEST', /Bob left the group/),
      );

      // Back in the group, it resumes from today on, without the weeks missed.
      await t.db.groupUser.create({ data: { groupId: group.id, userId: bob!.id } });
      const resumed = await t
        .callerFor(alice!)
        .recurring.setPaused({ ruleId: rule.id, paused: false });
      assert.equal(resumed.status, 'ACTIVE');
      assert.ok(resumed.nextOccurrenceAt >= t.getDueAt(t.getLocalDate(new Date(), 'UTC'), 'UTC'));

      // Removed some other way: the runner finds it before adding anything.
      await t.db.groupUser.delete({
        where: { groupId_userId: { groupId: group.id, userId: bob!.id } },
      });
      await t.setNext(rule.id, '2026-01-08');
      await settle();
      notifiedUserIds.length = 0;
      const tick = await t.runRecurringTick({ now: new Date('2026-01-09T00:00:00Z') });
      await settle();
      assert.deepEqual([tick.created, tick.paused], [0, 1]);
      assert.equal((await t.getRule(source.id)).statusReason, 'Bob left the group');
      assert.deepEqual(notifiedUserIds, [alice!.id]);
      assert.equal((await t.occurrences(rule.id)).length, 1);
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  "deleting the first expense stops the rule, and a deleted occurrence isn't added again",
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Flat', alice.id, [alice.id, bob.id]);
      const source = await t.addEqualExpense(alice, {
        groupId: group.id,
        amount: 100,
        userIds: [alice.id, bob.id],
        date: '2026-01-01',
        frequency: 'DAILY',
      });
      const rule = await t.getRule(source.id);
      await t.setNext(rule.id, '2026-01-02');
      await t.runRecurringTick({ now: new Date('2026-01-03T01:00:00Z') });
      const [, second, third] = await t.occurrences(rule.id);
      assert.ok(second && third);

      // Deleting the latest: the next copies the one before, and the deleted date stays taken.
      await t.callerFor(bob).user.deleteExpense({ expenseId: third.id });
      await t.setNext(rule.id, '2026-01-03');
      const retry = await t.runRecurringTick({ now: new Date('2026-01-03T02:00:00Z') });
      assert.equal(retry.created, 0);
      assert.deepEqual(await t.dates(rule.id), ['2026-01-01', '2026-01-02', '2026-01-03']);
      assert.equal(
        await t.db.expense.count({ where: { recurringId: rule.id, deletedAt: null } }),
        2,
      );

      // Pausing and resuming on that day never goes back to it either.
      await t.callerFor(bob).recurring.setPaused({ ruleId: rule.id, paused: true });
      const resumed = await t.setRulePaused(
        rule.id,
        false,
        bob.id,
        new Date('2026-01-03T05:00:00Z'),
      );
      assert.deepEqual(t.fromDbDate(resumed.nextOccurrenceDate), t.d('2026-01-04'));

      await t.callerFor(bob).user.deleteExpense({ expenseId: source.id });
      const stopped = await t.getRule(second.id);
      assert.equal(stopped.status, 'STOPPED');
      assert.equal(stopped.statusReason, 'The first expense was deleted');
      await t.setNext(rule.id, '2026-01-04');
      assert.equal(
        (await t.runRecurringTick({ now: new Date('2026-02-01T00:00:00Z') })).created,
        0,
      );
      await assert.rejects(
        t.callerFor(bob).recurring.setPaused({ ruleId: rule.id, paused: false }),
        t.isTrpcError('BAD_REQUEST'),
      );
      // What it added stays.
      assert.equal(
        (await t.db.expense.findUniqueOrThrow({ where: { id: second.id } })).deletedAt,
        null,
      );
      await t.assertBalancesMatchExpenses([alice.id, bob.id]);
    } finally {
      await t.cleanUp();
    }
  },
);

void test('the kill switch stops ticks without a deploy', { skip: !databaseUrl }, async () => {
  const t = await setup();
  try {
    const alice = await t.createUser('Alice');
    const bob = await t.createUser('Bob');
    const group = await t.createGroup('Flat', alice.id, [alice.id, bob.id]);
    const source = await t.addEqualExpense(alice, {
      groupId: group.id,
      amount: 100,
      userIds: [alice.id, bob.id],
      date: '2026-01-01',
      frequency: 'DAILY',
    });
    const rule = await t.getRule(source.id);
    await t.setNext(rule.id, '2026-01-02');

    await t.db.appMetadata.create({
      data: { key: t.RECURRING_RUNNER_ENABLED_KEY, value: 'false' },
    });
    const off = await t.runRecurringTick({ now: new Date('2026-01-02T01:00:00Z') });
    assert.equal(off.skipped, true);
    assert.equal((await t.occurrences(rule.id)).length, 1);

    await t.db.appMetadata.update({
      where: { key: t.RECURRING_RUNNER_ENABLED_KEY },
      data: { value: 'true' },
    });
    assert.equal((await t.runRecurringTick({ now: new Date('2026-01-02T01:00:00Z') })).created, 1);
  } finally {
    await t.db.appMetadata.deleteMany({ where: { key: t.RECURRING_RUNNER_ENABLED_KEY } });
    await t.cleanUp();
  }
});

void test(
  'only people in the expense can pause, resume or stop it',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const [alice, bob, carol, dave] = await Promise.all(
        ['Alice', 'Bob', 'Carol', 'Dave'].map((name) => t.createUser(name)),
      );
      const group = await t.createGroup('Flat', alice!.id, [alice!.id, bob!.id, carol!.id]);
      const source = await t.addEqualExpense(alice!, {
        groupId: group.id,
        amount: 100,
        userIds: [alice!.id, bob!.id],
        date: '2026-01-01',
        frequency: 'MONTHLY',
      });
      const { id: ruleId } = await t.getRule(source.id);

      // Carol is in the group but not in the expense; Dave in neither.
      for (const user of [carol!, dave!]) {
        await assert.rejects(
          t.callerFor(user).recurring.setPaused({ ruleId, paused: true }),
          t.isTrpcError('FORBIDDEN'),
        );
        await assert.rejects(
          t.callerFor(user).recurring.delete({ ruleId }),
          t.isTrpcError('FORBIDDEN'),
        );
      }
      await assert.rejects(
        t.callerFor(dave!).recurring.getRule({ ruleId }),
        t.isTrpcError('NOT_FOUND'),
      );
      await assert.rejects(
        t.callerFor(dave!).recurring.getGroupRules({ groupId: group.id }),
        t.isTrpcError('FORBIDDEN'),
      );
      const [listed] = await t.callerFor(carol!).recurring.getGroupRules({ groupId: group.id });
      assert.equal(listed?.canManage, false);
      assert.equal((await t.callerFor(bob!).recurring.getRule({ ruleId })).canManage, true);

      await t.callerFor(bob!).recurring.setPaused({ ruleId, paused: true });
      assert.equal((await t.getRule(source.id)).statusReason, 'Paused by Bob');
      await t.callerFor(alice!).recurring.setPaused({ ruleId, paused: false });
      await t.callerFor(bob!).recurring.delete({ ruleId });
      // The expenses stay, no longer repeating.
      const kept = await t.db.expense.findUniqueOrThrow({ where: { id: source.id } });
      assert.equal(kept.recurringId, null);
      assert.equal(kept.deletedAt, null);
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'repeat is set, changed and removed on edit; payments and unknown time zones are rejected',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Flat', alice.id, [alice.id, bob.id]);
      const expense = await t.addEqualExpense(alice, {
        groupId: group.id,
        amount: 100,
        userIds: [alice.id, bob.id],
        date: '2026-01-15',
      });
      assert.equal(
        (await t.db.expense.findUniqueOrThrow({ where: { id: expense.id } })).recurringId,
        null,
      );

      const edit = (
        recurrence:
          | { frequency: 'MONTHLY' | 'LAST_DAY_OF_MONTH'; timezone: string }
          | null
          | undefined,
        amount = 100,
      ) =>
        t.callerFor(bob).group.addOrEditExpense({
          groupId: group.id,
          expenseId: expense.id,
          paidBy: alice.id,
          name: 'Rent',
          category: 'rent',
          amount,
          splitType: t.SplitType.EQUAL,
          currency: 'USD',
          participants: [
            { userId: alice.id, amount: amount / 2 },
            { userId: bob.id, amount: -amount / 2 },
          ],
          expenseDate: new Date('2026-01-15T12:00:00Z'),
          recurrence,
        });

      await assert.rejects(edit({ frequency: 'MONTHLY', timezone: 'Mars/Olympus' }));
      await edit({ frequency: 'MONTHLY', timezone: 'Europe/Berlin' });
      const rule = await t.getRule(expense.id);
      assert.equal(rule.createdById, bob.id);
      assert.equal(rule.timezone, 'Europe/Berlin');
      assert.deepEqual(t.fromDbDate(rule.startDate), t.d('2026-01-15'));

      // Occurrences are added by whoever set up the repeat, here not the payer.
      await t.setNext(rule.id, '2026-02-15', 'Europe/Berlin');
      await t.runRecurringTick({ now: new Date('2026-02-15T12:00:00Z') });
      const [, added] = await t.occurrences(rule.id);
      assert.equal(added?.addedBy, bob.id);
      assert.equal(added?.paidBy, alice.id);
      assert.equal(added?.expenseDate.toISOString(), '2026-02-15T11:00:00.000Z');

      // An edit without a repeat leaves it alone, a changed one keeps the rule.
      await edit(undefined, 80);
      await edit({ frequency: 'LAST_DAY_OF_MONTH', timezone: 'UTC' });
      const changed = await t.getRule(expense.id);
      assert.equal(changed.id, rule.id);
      assert.equal(changed.frequency, 'LAST_DAY_OF_MONTH');
      assert.equal(changed.timezone, 'Europe/Berlin');
      assert.equal(
        t.fromDbDate(changed.nextOccurrenceDate).day,
        t.daysInMonth(
          t.fromDbDate(changed.nextOccurrenceDate).year,
          t.fromDbDate(changed.nextOccurrenceDate).month,
        ),
      );

      await edit(null);
      assert.equal(await t.db.recurringExpense.count({ where: { id: rule.id } }), 0);
      assert.equal(
        (await t.db.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount,
        10_000,
      );

      await assert.rejects(
        t.callerFor(bob).group.addOrEditExpense({
          groupId: group.id,
          paidBy: bob.id,
          name: 'Settle up',
          category: 'general',
          amount: 50,
          splitType: t.SplitType.SETTLEMENT,
          currency: 'USD',
          participants: [
            { userId: bob.id, amount: 50 },
            { userId: alice.id, amount: -50 },
          ],
          recurrence: { frequency: 'MONTHLY', timezone: 'UTC' },
        }),
        t.isTrpcError('BAD_REQUEST', /Payments can't repeat/),
      );
      // Nothing of the rejected payment was saved.
      assert.equal(
        await t.db.expense.count({ where: { groupId: group.id, splitType: 'SETTLEMENT' } }),
        0,
      );
      await t.assertBalancesMatchExpenses([alice.id, bob.id]);
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'personal recurring expenses pause when the two stop being friends',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      await t.db.friendship.createMany({
        data: [
          { userId: alice.id, friendId: bob.id },
          { userId: bob.id, friendId: alice.id },
        ],
      });
      const source = await t.addEqualExpense(alice, {
        amount: 100,
        userIds: [alice.id, bob.id],
        date: '2026-01-01',
        frequency: 'MONTHLY',
      });
      const rule = await t.getRule(source.id);
      assert.equal(rule.groupId, null);

      // Bob pays back, then they remove each other.
      await t.callerFor(bob).user.addOrEditExpense({
        paidBy: bob.id,
        name: 'Settle up',
        category: 'general',
        amount: 50,
        splitType: t.SplitType.SETTLEMENT,
        currency: 'USD',
        participants: [
          { userId: bob.id, amount: 50 },
          { userId: alice.id, amount: -50 },
        ],
      });
      await t.callerFor(bob).user.deleteFriend({ friendId: alice.id });
      const paused = await t.getRule(source.id);
      assert.equal(paused.status, 'PAUSED');
      assert.equal(paused.statusReason, "Bob and Alice aren't friends anymore");
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  'deleting a group removes its rules and tells their creators',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const alice = await t.createUser('Alice');
      const bob = await t.createUser('Bob');
      const group = await t.createGroup('Trip', alice.id, [alice.id, bob.id]);
      const source = await t.addEqualExpense(bob, {
        groupId: group.id,
        amount: 0.02,
        userIds: [bob.id],
        date: '2026-01-01',
        frequency: 'MONTHLY',
      });
      const { id: ruleId } = await t.getRule(source.id);
      await settle();
      notifiedUserIds.length = 0;
      await t.callerFor(alice).group.delete({ groupId: group.id });
      await settle();
      assert.equal(await t.db.recurringExpense.count({ where: { id: ruleId } }), 0);
      assert.deepEqual(notifiedUserIds, [bob.id]);
    } finally {
      await t.cleanUp();
    }
  },
);

void test(
  "a participant's account being removed pauses the rule instead of adding a partial copy",
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const [alice, bob, carol] = await Promise.all(
        ['Alice', 'Bob', 'Carol'].map((name) => t.createUser(name)),
      );
      const group = await t.createGroup('Flat', alice!.id, [alice!.id, bob!.id, carol!.id]);
      const source = await t.addEqualExpense(alice!, {
        groupId: group.id,
        amount: 90,
        userIds: [alice!.id, bob!.id, carol!.id],
        date: '2026-01-01',
        frequency: 'DAILY',
      });
      const rule = await t.getRule(source.id);
      await t.setNext(rule.id, '2026-01-02');

      await t.db.user.delete({ where: { id: carol!.id } });
      const tick = await t.runRecurringTick({ now: new Date('2026-01-02T01:00:00Z') });
      assert.deepEqual([tick.created, tick.paused], [0, 1]);
      const paused = await t.getRule(source.id);
      assert.equal(paused.status, 'PAUSED');
      assert.equal(paused.statusReason, t.ACCOUNT_GONE_REASON);
    } finally {
      await t.cleanUp();
    }
  },
);
