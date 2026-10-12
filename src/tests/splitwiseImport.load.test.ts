import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExport, expense, person } from './splitwiseFixtures';

// A long history, timed. Opt in with SPLITWISE_IMPORT_LOAD=1 (and TEST_DATABASE_URL).
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = !!databaseUrl && '1' === process.env.SPLITWISE_IMPORT_LOAD;
const GROUP_EXPENSES = Number(process.env.SPLITWISE_IMPORT_LOAD_EXPENSES ?? 12_000);
/**
 * Expenses Ada and Bo already have, imported from another Splitwise scope (clean slate allows only
 * those), and as many manual ones Ada has with Kim, which the history check looks through.
 */
const EXISTING_EXPENSES = Number(process.env.SPLITWISE_IMPORT_LOAD_EXISTING ?? 10_000);

void test(
  'imports a long group history in batches without blocking other writes',
  { skip: !enabled },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ db }, lib, { importSplitwiseItem }, { createGroupExpense }, guard] = await Promise.all(
      [
        import('~/server/db'),
        import('~/lib/splitwiseImport'),
        import('~/server/api/services/splitwiseImport'),
        import('~/server/api/services/splitService'),
        import('~/server/api/services/balanceConsistency'),
      ],
    );
    db.pushNotification.findMany =
      (async () => []) as unknown as typeof db.pushNotification.findMany;
    await db.appMetadata.upsert({
      where: { key: 'splitwise_history_import_enabled' },
      update: { value: 'true' },
      create: { key: 'splitwise_history_import_enabled', value: 'true' },
    });

    const suffix = `${Date.now()}-load`;
    const base = 2_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const people = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map((name, index) =>
      person(base + index, name, `${name.toLowerCase()}-${suffix}@example.com`),
    );
    const [ada] = people as [ReturnType<typeof person>];
    const me = await db.user.create({ data: { email: ada.email!, name: 'Ada' } });
    const bo = await db.user.create({ data: { email: people[1]!.email!, name: 'Bo' } });
    await db.friendship.createMany({
      data: [
        { userId: me.id, friendId: bo.id },
        { userId: bo.id, friendId: me.id },
      ],
    });
    // Their imported expenses outside groups, in all three currencies, with matching balances.
    await db.$executeRaw`
      INSERT INTO "Expense" (id, "paidBy", "addedBy", name, category, amount, "splitType",
        "expenseDate", "createdAt", "updatedAt", currency, "splitwiseExpenseId",
        "splitwiseScope", "splitwisePart")
      SELECT ${suffix} || '-' || g, CASE WHEN 0 = g % 3 THEN ${bo.id} ELSE ${me.id} END, ${me.id},
        'Existing', 'general', 2 * (100 + g % 1000), 'EXACT', now(), now(), now(),
        (ARRAY['USD', 'EUR', 'JPY'])[1 + g % 3], 'seed-' || g, 'users:seed', 0
      FROM generate_series(1, ${EXISTING_EXPENSES}) g`;
    await db.$executeRaw`
      INSERT INTO "ExpenseParticipant" ("expenseId", "userId", amount)
      SELECT id, "paidBy", amount / 2 FROM "Expense" WHERE id LIKE ${suffix} || '-%'
      UNION ALL
      SELECT id, CASE WHEN "paidBy" = ${me.id} THEN ${bo.id} ELSE ${me.id} END, -amount / 2
      FROM "Expense" WHERE id LIKE ${suffix} || '-%'`;
    await db.$executeRaw`
      INSERT INTO "Balance" ("userId", "friendId", currency, amount, "updatedAt")
      SELECT u, f, currency, SUM(a), now() FROM (
        SELECT "paidBy" AS u, CASE WHEN "paidBy" = ${me.id} THEN ${bo.id} ELSE ${me.id} END AS f,
               currency, amount / 2 AS a FROM "Expense" WHERE id LIKE ${suffix} || '-%'
        UNION ALL
        SELECT CASE WHEN "paidBy" = ${me.id} THEN ${bo.id} ELSE ${me.id} END, "paidBy",
               currency, -amount / 2 FROM "Expense" WHERE id LIKE ${suffix} || '-%'
      ) rows GROUP BY u, f, currency`;
    // Ada's manual expenses with Kim, with matching balances.
    const kim = await db.user.create({ data: { email: `kim-${suffix}@example.com`, name: 'Kim' } });
    await db.$executeRaw`
      INSERT INTO "Expense" (id, "paidBy", "addedBy", name, category, amount, "splitType",
        "expenseDate", "createdAt", "updatedAt", currency)
      SELECT 'm' || ${suffix} || '-' || g, ${me.id}, ${me.id}, 'Manual', 'general', 200, 'EXACT',
        now(), now(), now(), 'USD'
      FROM generate_series(1, ${EXISTING_EXPENSES}) g`;
    await db.$executeRaw`
      INSERT INTO "ExpenseParticipant" ("expenseId", "userId", amount)
      SELECT id, ${me.id}, 100 FROM "Expense" WHERE id LIKE 'm' || ${suffix} || '-%'
      UNION ALL
      SELECT id, ${kim.id}, -100 FROM "Expense" WHERE id LIKE 'm' || ${suffix} || '-%'`;
    await db.$executeRaw`
      INSERT INTO "Balance" ("userId", "friendId", currency, amount, "updatedAt")
      VALUES (${me.id}, ${kim.id}, 'USD', ${100 * EXISTING_EXPENSES}, now()),
             (${kim.id}, ${me.id}, 'USD', ${-100 * EXISTING_EXPENSES}, now())`;
    const gid = base + 100;
    const currencies = ['USD', 'EUR', 'JPY'];

    let seed = 7;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    const expenses = Array.from({ length: GROUP_EXPENSES }, (_, index) => {
      const ids = people.map((p) => p.id).filter(() => 0 < random(3));
      const users = (2 > ids.length ? people.slice(0, 2).map((p) => p.id) : ids).map(
        (id) => [id, 0, 0] as [number, number, number],
      );
      const cost = 100 + random(500_000);
      const share = Math.floor(cost / users.length);
      users.forEach((user, i) => (user[2] = share + (i < cost - share * users.length ? 1 : 0)));
      const payer = random(users.length);
      if (0 === index % 10 && 2 < users.length) {
        // Two payers, matched like Splitwise would.
        const half = Math.floor(cost / 2);
        users[0]![1] = half;
        users[1]![1] = cost - half;
        const nets = users.map(([id, paid, owed]) => [id, paid - owed] as [number, number]);
        const creditors = nets.filter(([, n]) => 0 < n);
        const repayments: [number, number, number][] = [];
        nets
          .filter(([, n]) => 0 > n)
          .forEach(([id, n]) => {
            let owes = -n;
            creditors.forEach((creditor) => {
              const amount = Math.min(owes, creditor[1]);
              if (0 < amount) {
                repayments.push([id, creditor[0], amount]);
                creditor[1] -= amount;
                owes -= amount;
              }
            });
          });
        return expense({ id: base + 1000 + index, groupId: gid, users, repayments });
      }
      users[payer]![1] = cost;
      return expense({
        id: base + 1000 + index,
        groupId: gid,
        currency: currencies[index % 3],
        deleted: 0 === index % 50,
        users,
      });
    });
    const file = buildExport({
      me: ada,
      people: people.slice(1),
      groups: [{ id: gid, name: 'Big house', memberIds: people.map((p) => p.id) }],
      expenses,
    });

    const plan = lib.buildImportPlan(lib.exportFileSchema.parse(JSON.parse(JSON.stringify(file))));
    const item = plan.items.find((i) => i.key === `group:${gid}`)!;
    const body = JSON.stringify(item.request);

    // While the import runs, every 100 ms: Ada adds an expense in another group, and two people
    // with nothing to do with the import add one between them. Failed writes are counted.
    const other = await db.group.create({
      data: {
        name: 'Other',
        publicId: `other-${suffix}`,
        userId: me.id,
        groupUsers: { create: [{ userId: me.id }] },
      },
    });
    const [gus, hal] = await Promise.all(
      ['gus', 'hal'].map((name) =>
        db.user.create({ data: { email: `${name}-${suffix}@example.com`, name } }),
      ),
    );
    const unrelated = await db.group.create({
      data: {
        name: 'Unrelated',
        publicId: `unrelated-${suffix}`,
        userId: gus!.id,
        groupUsers: { create: [{ userId: gus!.id }, { userId: hal!.id }] },
      },
    });
    let running = true;
    const writer = (write: () => Promise<unknown>) => {
      const stats = { latencies: [] as number[], failed: 0 };
      const done = (async () => {
        while (running) {
          const start = performance.now();
          try {
            await write();
            stats.latencies.push(performance.now() - start);
          } catch {
            stats.failed++;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      return { stats, done };
    };
    const date = new Date();
    const writers = {
      adaElsewhere: writer(() =>
        createGroupExpense(
          other.id,
          me.id,
          'Probe',
          'general',
          1,
          'EQUAL',
          'USD',
          [{ userId: me.id, amount: 0 }],
          me.id,
          date,
        ),
      ),
      unrelatedUsers: writer(() =>
        createGroupExpense(
          unrelated.id,
          gus!.id,
          'Probe',
          'general',
          2,
          'EQUAL',
          'USD',
          [
            { userId: gus!.id, amount: 1 },
            { userId: hal!.id, amount: -1 },
          ],
          gus!.id,
          date,
        ),
      ),
    };
    const stopWriters = async () => {
      running = false;
      await Promise.all(Object.values(writers).map((w) => w.done));
    };
    const summary = ({ stats }: ReturnType<typeof writer>) => {
      const sorted = [...stats.latencies].sort((a, b) => a - b);
      const p = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      return {
        ok: sorted.length,
        failed: stats.failed,
        p50: Math.round(p(0.5)),
        p95: Math.round(p(0.95)),
        max: Math.round(sorted.at(-1) ?? 0),
      };
    };

    try {
      const start = performance.now();
      const result = await importSplitwiseItem(
        me,
        lib.importItemRequestSchema.parse(JSON.parse(body)),
      );
      const importMs = performance.now() - start;
      await stopWriters();

      assert.equal(result.status, 'imported', JSON.stringify(result));
      const again = performance.now();
      const second = await importSplitwiseItem(
        me,
        lib.importItemRequestSchema.parse(JSON.parse(body)),
      );
      const reimportMs = performance.now() - again;
      assert.equal(second.status, 'imported');

      // The balance guard on its own: preflight's check for every pair, currency and the group,
      // and a batch's lock, compare and read back for the same rows, which a batch of this group
      // touches.
      const userIds = (
        await db.user.findMany({
          where: { email: { contains: suffix }, id: { notIn: [gus!.id, hal!.id, kim.id] } },
          select: { id: true },
        })
      ).map((u) => u.id);
      const groupId = 'imported' === result.status ? result.groupId : null;
      const keys = userIds.flatMap((a) =>
        userIds
          .filter((b) => a < b)
          .flatMap((b) =>
            currencies.flatMap((currency) => [
              { userId: a, friendId: b, currency, groupId },
              { userId: a, friendId: b, currency, groupId: null },
            ]),
          ),
      );
      const time = async (run: () => Promise<unknown>) => {
        const ms: number[] = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          await run();
          ms.push(performance.now() - start);
        }
        ms.sort((a, b) => a - b);
        return { p50: +ms[10]!.toFixed(1), max: +ms[19]!.toFixed(1) };
      };
      const { unexplained, snapshot } = await guard.checkBalances(db, keys);
      assert.deepEqual(unexplained, []);
      const adaBoKeys = keys.filter((k) =>
        [k.userId, k.friendId].every((id) => [me.id, bo.id].includes(id)),
      );
      const guardMs = {
        pairs: keys.length / 2,
        expensesPaidByAdaOrBo: await db.expense.count({
          where: { OR: [{ paidBy: me.id }, { paidBy: bo.id }], deletedAt: null },
        }),
        preflightAllPairs: await time(() => guard.checkBalances(db, keys)),
        preflightAdaAndBo: await time(() => guard.checkBalances(db, adaBoKeys)),
        // What each batch runs before writing: the history check, then lock and compare the rows.
        batchCheckAndReadBack: await time(() =>
          db.$transaction(
            async (tx) => {
              await guard.assertCleanSlate(tx, keys, snapshot);
              return guard.readBalances(tx, keys);
            },
            { isolationLevel: 'Serializable' },
          ),
        ),
        // The same without the history check, to show what it adds.
        batchRowsOnly: await time(() =>
          db.$transaction(
            async (tx) => {
              await guard.assertBalancesUnchanged(tx, keys, snapshot);
              return guard.readBalances(tx, keys);
            },
            { isolationLevel: 'Serializable' },
          ),
        ),
      };

      console.info(
        JSON.stringify(
          {
            expenses: GROUP_EXPENSES,
            imported: 'imported' === result.status ? result.imported : 0,
            skippedDeleted: 'imported' === result.status ? result.skippedDeleted : 0,
            parts: await db.expense.count({ where: { group: { splitwiseGroupId: String(gid) } } }),
            requestMb: +(body.length / 1024 / 1024).toFixed(2),
            maxBodyMb: lib.MAX_IMPORT_BODY_BYTES / 1024 / 1024,
            existingAdaAndBoExpenses: EXISTING_EXPENSES,
            importSeconds: +(importMs / 1000).toFixed(1),
            reimportSeconds: +(reimportMs / 1000).toFixed(1),
            otherWrites: {
              adaElsewhere: summary(writers.adaElsewhere),
              unrelatedUsers: summary(writers.unrelatedUsers),
            },
            guard: guardMs,
          },
          null,
          2,
        ),
      );
      assert.ok(body.length < lib.MAX_IMPORT_BODY_BYTES);
    } finally {
      await stopWriters();
      await db.user.deleteMany({ where: { email: { contains: suffix } } });
    }
  },
);
