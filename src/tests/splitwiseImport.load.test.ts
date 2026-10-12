import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExport, expense, person } from './splitwiseFixtures';

// A long history, timed. Opt in with SPLITWISE_IMPORT_LOAD=1 (and TEST_DATABASE_URL).
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = !!databaseUrl && '1' === process.env.SPLITWISE_IMPORT_LOAD;
const GROUP_EXPENSES = Number(process.env.SPLITWISE_IMPORT_LOAD_EXPENSES ?? 12_000);

void test(
  'imports a long group history in batches without blocking other writes',
  { skip: !enabled },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';

    const [{ db }, lib, { importSplitwiseItem }, { createGroupExpense }] = await Promise.all([
      import('~/server/db'),
      import('~/lib/splitwiseImport'),
      import('~/server/api/services/splitwiseImport'),
      import('~/server/api/services/splitService'),
    ]);
    db.pushNotification.findMany =
      (async () => []) as unknown as typeof db.pushNotification.findMany;

    const suffix = `${Date.now()}-load`;
    const base = 2_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const people = ['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map((name, index) =>
      person(base + index, name, `${name.toLowerCase()}-${suffix}@example.com`),
    );
    const [ada] = people as [ReturnType<typeof person>];
    const me = await db.user.create({ data: { email: ada.email!, name: 'Ada' } });
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

    // Someone adds an expense in another group every 100 ms while the import runs.
    const other = await db.group.create({
      data: {
        name: 'Other',
        publicId: `other-${suffix}`,
        userId: me.id,
        groupUsers: { create: [{ userId: me.id }] },
      },
    });
    const latencies: number[] = [];
    let running = true;
    const probe = (async () => {
      while (running) {
        const start = performance.now();
        await createGroupExpense(
          other.id,
          me.id,
          'Probe',
          'general',
          1,
          'EQUAL',
          'USD',
          [{ userId: me.id, amount: 0 }],
          me.id,
          new Date(),
        );
        latencies.push(performance.now() - start);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();

    try {
      const start = performance.now();
      const result = await importSplitwiseItem(
        me,
        lib.importItemRequestSchema.parse(JSON.parse(body)),
      );
      const importMs = performance.now() - start;
      running = false;
      await probe;

      assert.equal(result.status, 'imported', JSON.stringify(result));
      const again = performance.now();
      const second = await importSplitwiseItem(
        me,
        lib.importItemRequestSchema.parse(JSON.parse(body)),
      );
      const reimportMs = performance.now() - again;
      assert.equal(second.status, 'imported');

      const sorted = [...latencies].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      console.info(
        JSON.stringify(
          {
            expenses: GROUP_EXPENSES,
            imported: 'imported' === result.status ? result.imported : 0,
            skippedDeleted: 'imported' === result.status ? result.skippedDeleted : 0,
            parts: await db.expense.count({ where: { group: { splitwiseGroupId: String(gid) } } }),
            requestMb: +(body.length / 1024 / 1024).toFixed(2),
            maxBodyMb: lib.MAX_IMPORT_BODY_BYTES / 1024 / 1024,
            importSeconds: +(importMs / 1000).toFixed(1),
            reimportSeconds: +(reimportMs / 1000).toFixed(1),
            otherWrites: {
              count: sorted.length,
              p50: Math.round(p(0.5)),
              p95: Math.round(p(0.95)),
              max: Math.round(sorted.at(-1) ?? 0),
            },
          },
          null,
          2,
        ),
      );
      assert.ok(body.length < lib.MAX_IMPORT_BODY_BYTES);
    } finally {
      running = false;
      await probe.catch(() => undefined);
      await db.user.deleteMany({ where: { email: { contains: suffix } } });
    }
  },
);
