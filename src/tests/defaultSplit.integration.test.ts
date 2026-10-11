import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

void test(
  'a default split saved unchanged from the editor is stored byte for byte the same, and only real changes notify',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ SplitType }, { TRPCError }, { db }, { appRouter }, defaultSplit] = await Promise.all([
      import('@prisma/client'),
      import('@trpc/server'),
      import('~/server/db'),
      import('~/server/api/root'),
      import('~/utils/defaultSplit'),
    ]);
    const { getEditorSplit, getEditorValues, getGroupDefaultSplit } = defaultSplit;
    const suffix = `${Date.now()}-${Math.random()}`;
    const [alice, bob, carol] = await Promise.all(
      ['Alice', 'Bob', 'Carol'].map((name) =>
        db.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name } }),
      ),
    );
    assert.ok(alice && bob && carol);
    const members = [alice, bob, carol];
    const memberIds = members.map((member) => member.id);
    const group = await db.group.create({
      data: { name: 'Trip', publicId: `trip-${suffix}`, userId: alice.id },
    });
    await db.groupUser.createMany({
      data: members.map((user) => ({ groupId: group.id, userId: user.id })),
    });

    const callerFor = (user: typeof alice) =>
      appRouter.createCaller({
        db,
        ip: 'test',
        session: {
          expires: new Date(Date.now() + 60_000).toISOString(),
          user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
        },
      });
    const caller = callerFor(alice);
    const save = (split: Parameters<typeof caller.group.setDefaultSplit>[0]['split']) =>
      caller.group.setDefaultSplit({ groupId: group.id, split });
    const stored = async () => {
      const [row] = await db.$queryRaw<
        Array<{ type: string | null; shares: string | null; byId: number | null; at: Date | null }>
      >`SELECT "defaultSplitType"::text AS type, "defaultSplitShares"::text AS shares,
          "defaultSplitById" AS "byId", "defaultSplitAt" AS at
        FROM "Group" WHERE id = ${group.id}`;
      assert.ok(row);
      return row;
    };
    /** Opens the editor on what is stored and saves it without touching anything. */
    const saveFromEditor = async () => {
      const current = getGroupDefaultSplit(
        await db.group.findUniqueOrThrow({ where: { id: group.id } }),
      );
      assert.ok(current);
      const values = getEditorValues(current, memberIds)[current.splitType];
      return save(getEditorSplit(current.splitType, values, memberIds));
    };
    const isBadRequest = (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, 'BAD_REQUEST');
      return true;
    };

    // Counts notifications without sending any.
    let notifications = 0;
    const findSubscriptions = db.pushNotification.findMany.bind(db.pushNotification);
    db.pushNotification.findMany = (async () => {
      notifications += 1;
      return [];
    }) as unknown as typeof db.pushNotification.findMany;
    const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

    try {
      const splits = [
        {
          splitType: SplitType.PERCENTAGE,
          shares: { [alice.id]: 33.33, [bob.id]: 33.33, [carol.id]: 33.34 },
        },
        { splitType: SplitType.SHARE, shares: { [alice.id]: 0.01, [bob.id]: 2.5, [carol.id]: 0 } },
        { splitType: SplitType.EQUAL, shares: { [alice.id]: 1, [bob.id]: 0, [carol.id]: 1 } },
      ] as const;

      for (const split of splits) {
        await save(split);
        const first = await stored();
        // Something else in between, so saving from the editor really writes again.
        await save({
          splitType: SplitType.SHARE,
          shares: { [alice.id]: 9, [bob.id]: 9, [carol.id]: 9 },
        });
        await save(split);
        await saveFromEditor();
        const again = await stored();
        assert.equal(again.type, first.type);
        assert.equal(again.shares, first.shares);
      }

      // Rejected at input, and nothing stored changes.
      const before = await stored();
      const rejected = [
        {
          splitType: SplitType.SHARE,
          shares: { [alice.id]: 0.006, [bob.id]: 0.004, [carol.id]: 0 },
        },
        {
          splitType: SplitType.PERCENTAGE,
          shares: { [alice.id]: 49.996, [bob.id]: 49.996, [carol.id]: 0.008 },
        },
        {
          splitType: SplitType.PERCENTAGE,
          shares: { [alice.id]: 49.996, [bob.id]: 49.996, [carol.id]: 0 },
        },
        {
          splitType: SplitType.PERCENTAGE,
          shares: { [alice.id]: 50.004, [bob.id]: 50.004, [carol.id]: 0 },
        },
        { splitType: SplitType.EQUAL, shares: { [`0${alice.id}`]: 0, [bob.id]: 1, [carol.id]: 1 } },
        { splitType: SplitType.EQUAL, shares: { [`+${alice.id}`]: 0, [bob.id]: 1, [carol.id]: 1 } },
        {
          splitType: SplitType.EQUAL,
          shares: { [`${alice.id}.0`]: 0, [bob.id]: 1, [carol.id]: 1 },
        },
        { splitType: SplitType.EQUAL, shares: { [` ${alice.id}`]: 0, [bob.id]: 1, [carol.id]: 1 } },
        {
          splitType: SplitType.EQUAL,
          shares: { [`0x${alice.id.toString(16)}`]: 0, [bob.id]: 1, [carol.id]: 1 },
        },
        {
          splitType: SplitType.EQUAL,
          shares: { [alice.id]: 1, [`0${alice.id}`]: 0, [bob.id]: 1, [carol.id]: 1 },
        },
      ];
      for (const split of rejected) {
        await assert.rejects(save(split), isBadRequest, JSON.stringify(split));
      }
      assert.deepEqual(await stored(), before);

      // A save that changes nothing keeps who set it and notifies no one, even from someone else.
      await settled();
      notifications = 0;
      const sixtyForty = {
        splitType: SplitType.PERCENTAGE,
        shares: { [alice.id]: 60, [bob.id]: 40, [carol.id]: 0 },
      };
      await save(sixtyForty);
      const set = await stored();
      await settled();
      assert.equal(notifications, 1);

      await save(sixtyForty);
      await callerFor(bob).group.setDefaultSplit({ groupId: group.id, split: sixtyForty });
      await saveFromEditor();
      await settled();
      assert.deepEqual(await stored(), set);
      assert.equal(set.byId, alice.id);
      assert.equal(notifications, 1);

      await save(null);
      await save(null);
      await settled();
      assert.equal(notifications, 2);
      assert.deepEqual(await stored(), { type: null, shares: null, byId: null, at: null });
    } finally {
      db.pushNotification.findMany = findSubscriptions;
      await db.group.delete({ where: { id: group.id } });
      await db.user.deleteMany({ where: { id: { in: memberIds } } });
    }
  },
);
