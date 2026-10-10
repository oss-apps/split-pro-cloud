import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to write to a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ SplitType }, { db }, splitService, apply, load, plan, replay] = await Promise.all([
    import('@prisma/client'),
    import('~/server/db'),
    import('~/server/api/services/splitService'),
    import('~/scripts/balanceRepair/apply'),
    import('~/scripts/balanceRepair/load'),
    import('~/scripts/balanceRepair/plan'),
    import('~/scripts/balanceRepair/replay'),
  ]);

  const suffix = `${Date.now()}-${Math.random()}`;
  const [a, b, d] = await Promise.all(
    ['a', 'b', 'd'].map((name) =>
      db.user.create({ data: { email: `${name}-${suffix}@example.com`, name } }),
    ),
  );
  const group = await db.group.create({
    data: {
      name: 'Repair',
      publicId: `repair-${suffix}`,
      userId: a!.id,
      groupUsers: { create: [a!, b!, d!].map((user) => ({ userId: user.id })) },
    },
  });

  // History written by the old code: A paid 10.00 for B in the group, then paid again with D
  // (who owed nothing) listed at zero, so the old rule zeroed A-B's group balance.
  const at = (day: number) => new Date(Date.UTC(2025, 0, day));
  const oldExpense = (day: number, participants: { userId: number; amount: number }[]) =>
    db.expense.create({
      data: {
        groupId: group.id,
        paidBy: a!.id,
        addedBy: a!.id,
        name: 'Old expense',
        category: 'general',
        amount: participants[0]!.amount,
        splitType: SplitType.EXACT,
        currency: 'USD',
        createdAt: at(day),
        updatedAt: at(day),
        expenseParticipants: { create: participants },
      },
    });
  await oldExpense(1, [
    { userId: a!.id, amount: 1000 },
    { userId: b!.id, amount: -1000 },
  ]);
  await oldExpense(2, [
    { userId: a!.id, amount: 500 },
    { userId: b!.id, amount: -500 },
    { userId: d!.id, amount: 0 },
  ]);
  // A settlement the old editor left at 0 / 0, which the script must only report.
  const brokenSettlement = await db.expense.create({
    data: {
      paidBy: d!.id,
      addedBy: d!.id,
      updatedBy: d!.id,
      name: 'Settle up',
      category: 'general',
      amount: 700,
      splitType: SplitType.SETTLEMENT,
      currency: 'USD',
      createdAt: at(3),
      updatedAt: at(3),
      expenseParticipants: {
        create: [
          { userId: d!.id, amount: 0 },
          { userId: b!.id, amount: 0 },
        ],
      },
    },
  });

  // Balance(A, B) = 15.00 (A is owed), on the lower id's row.
  const lo = Math.min(a!.id, b!.id);
  const hi = Math.max(a!.id, b!.id);
  const sign = lo === a!.id ? 1 : -1;
  await db.balance.createMany({
    data: [
      { userId: lo, friendId: hi, currency: 'USD', amount: 1500 * sign },
      { userId: hi, friendId: lo, currency: 'USD', amount: -1500 * sign },
      { userId: a!.id, friendId: d!.id, currency: 'USD', amount: 0 },
      { userId: d!.id, friendId: a!.id, currency: 'USD', amount: 0 },
      { userId: b!.id, friendId: d!.id, currency: 'USD', amount: 0 },
      { userId: d!.id, friendId: b!.id, currency: 'USD', amount: 0 },
    ],
  });
  await db.groupBalance.createMany({
    data: [
      [a!.id, b!.id],
      [b!.id, a!.id],
      [a!.id, d!.id],
      [d!.id, a!.id],
    ].map(([userId, firendId]) => ({
      groupId: group.id,
      currency: 'USD',
      userId: userId!,
      firendId: firendId!,
      amount: 0,
    })),
  });

  const key = replay.pairKey('USD', a!.id, b!.id);
  const makePlan = async () => {
    const snapshot = await load.loadSnapshot(db);
    const built = plan.buildPlan(snapshot, snapshot.expenseAmounts);
    const setId = built.setOf.get(key)!;
    const analysis = built.analyses.find((candidate) => candidate.setId === setId)!;
    const keys = built.sets.get(setId)!;
    return {
      snapshot,
      analysis,
      planned: {
        setId,
        keys,
        rows: plan.getSetRows(keys, built.stored),
        changes: analysis.changes,
        expenseIds: built.expenseIdsBySet.get(setId) ?? [],
      },
    };
  };
  const groupRowAB = async () =>
    (
      await db.groupBalance.findUniqueOrThrow({
        where: {
          groupId_currency_firendId_userId: {
            groupId: group.id,
            currency: 'USD',
            userId: a!.id,
            firendId: b!.id,
          },
        },
      })
    ).amount;
  const pay = (
    payer: number,
    receiver: number,
    amount: number,
    splitType: (typeof SplitType)[keyof typeof SplitType] = SplitType.EXACT,
  ) =>
    splitService.addUserExpense(
      payer,
      'Live',
      'general',
      amount,
      splitType,
      'USD',
      [
        { userId: payer, amount },
        { userId: receiver, amount: -amount },
      ],
      payer,
      new Date(),
    );
  const cleanup = async () => {
    await db.group.deleteMany({ where: { id: group.id } });
    await db.user.deleteMany({ where: { id: { in: [a!.id, b!.id, d!.id] } } });
  };

  return {
    db,
    apply,
    a: a!,
    b: b!,
    group,
    brokenSettlement,
    makePlan,
    groupRowAB,
    pay,
    createGroupExpense: splitService.createGroupExpense,
    SplitType,
    cleanup,
  };
};

void test(
  'repairs only GroupBalance, never settlements or Balance, and undoes exactly',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const { snapshot, analysis, planned } = await t.makePlan();
      assert.equal(analysis.verdict, 'repair');

      const balancesBefore = await t.db.balance.findMany({
        where: { OR: [{ userId: t.a.id }, { userId: t.b.id }] },
        orderBy: [{ userId: 'asc' }, { friendId: 'asc' }],
      });
      const participantsBefore = await t.db.expenseParticipant.findMany({
        where: { expenseId: t.brokenSettlement.id },
        orderBy: { userId: 'asc' },
      });

      const runId = `test-${Date.now()}`;
      const outcome = await t.apply.applySetRepair(t.db, runId, snapshot.loadedAt, planned);
      assert.equal(outcome.status, 'applied');
      assert.equal(await t.groupRowAB(), 1500);

      const logs = await t.db.balanceRepairLog.findMany({ where: { runId } });
      assert.ok(logs.length > 0);
      assert.ok(logs.every((log) => 'GroupBalance' === log.table));
      assert.deepEqual(
        await t.db.balance.findMany({
          where: { OR: [{ userId: t.a.id }, { userId: t.b.id }] },
          orderBy: [{ userId: 'asc' }, { friendId: 'asc' }],
        }),
        balancesBefore,
      );
      assert.deepEqual(
        await t.db.expenseParticipant.findMany({
          where: { expenseId: t.brokenSettlement.id },
          orderBy: { userId: 'asc' },
        }),
        participantsBefore,
      );

      const again = await t.makePlan();
      assert.equal(again.analysis.verdict, 'nothing-to-do');

      const undo = await t.apply.undoRun(t.db, `${runId}-undo`, runId);
      assert.deepEqual(
        undo.map((o) => o.status),
        ['applied'],
      );
      assert.equal(await t.groupRowAB(), 0);
    } finally {
      await t.cleanup();
    }
  },
);

void test(
  'refuses to apply when a settle-up and an offsetting expense happened after the plan',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const { snapshot, analysis, planned } = await t.makePlan();
      assert.equal(analysis.verdict, 'repair');

      // B settles in full, then A pays B the same amount: every balance amount is back to what
      // the plan saw, but the settle-up legitimately cleared the debt.
      await t.pay(t.b.id, t.a.id, 15, t.SplitType.SETTLEMENT);
      await t.pay(t.a.id, t.b.id, 15);

      const outcome = await t.apply.applySetRepair(t.db, 'test-aba', snapshot.loadedAt, planned);
      assert.equal(outcome.status, 'changed-since-plan');
      assert.equal(await t.groupRowAB(), 0);
      assert.equal(await t.db.balanceRepairLog.count({ where: { runId: 'test-aba' } }), 0);
    } finally {
      await t.cleanup();
    }
  },
);

void test(
  'refuses to undo after the pair settled and ran up the same debt again',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    try {
      const { snapshot, planned } = await t.makePlan();
      const runId = `test-undo-${Date.now()}`;
      assert.equal(
        (await t.apply.applySetRepair(t.db, runId, snapshot.loadedAt, planned)).status,
        'applied',
      );

      // Settle the repaired 15.00 away, then a new 15.00 group debt: the row reads 15.00 again.
      await t.pay(t.b.id, t.a.id, 15, t.SplitType.SETTLEMENT);
      await t.createGroupExpense(
        t.group.id,
        t.a.id,
        'New',
        'general',
        15,
        t.SplitType.EXACT,
        'USD',
        [
          { userId: t.a.id, amount: 15 },
          { userId: t.b.id, amount: -15 },
        ],
        t.a.id,
        new Date(),
      );
      assert.equal(await t.groupRowAB(), 1500);

      const undo = await t.apply.undoRun(t.db, `${runId}-undo`, runId);
      assert.deepEqual(
        undo.map((o) => o.status),
        ['changed-since-apply'],
      );
      assert.equal(await t.groupRowAB(), 1500);
    } finally {
      await t.cleanup();
    }
  },
);
