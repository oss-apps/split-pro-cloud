import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ db }, feedbackService, feedbackAdmin, { MailNotSentError }] = await Promise.all([
    import('~/server/db'),
    import('~/server/api/services/feedbackService'),
    import('~/server/api/services/feedbackAdmin'),
    import('~/server/mailer'),
  ]);

  const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const emailOf = (name: string) => `${name.toLowerCase()}-${suffix}@example.com`;
  const createUser = (name: string) =>
    db.user.create({ data: { email: emailOf(name), name, currency: 'USD' } });

  return {
    db,
    suffix,
    emailOf,
    createUser,
    MailNotSentError,
    ...feedbackService,
    ...feedbackAdmin,
  };
};

void test(
  'feedback: concurrent resends save one row and email once',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const alice = await t.createUser('Alice');
    const emailed: string[] = [];
    const deps = {
      db: t.db,
      notify: async ({ id }: { id: string }) => {
        emailed.push(id);
      },
    };

    try {
      const clientKey = randomUUID();
      const withKey = await Promise.all(
        Array.from({ length: 5 }, () =>
          t.submitFeedback(alice, { feedback: 'Double tapped feedback', clientKey }, 'web', deps),
        ),
      );
      assert.equal(new Set(withKey.map(({ id }) => id)).size, 1);

      // Older apps send no key: the same text at once is still one row
      const withoutKey = await Promise.all(
        Array.from({ length: 5 }, () =>
          t.submitFeedback(alice, { feedback: 'Old app feedback' }, 'mobile', deps),
        ),
      );
      assert.equal(new Set(withoutKey.map(({ id }) => id)).size, 1);

      const rows = await t.db.feedback.findMany({ where: { userId: alice.id } });
      assert.equal(rows.length, 2);
      assert.equal(emailed.length, 2);
      assert.deepEqual(rows.map((row) => row.source).sort(), ['mobile', 'web']);
    } finally {
      await t.db.user.delete({ where: { id: alice.id } });
    }

    assert.equal(await t.db.feedback.count({ where: { userId: alice.id } }), 0);
  },
);

void test(
  'feedback: replies are sent once per key and only recorded when sent',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const bob = await t.createUser('Bob');
    const sent: { to: string; reply: string; original: string }[] = [];
    const send = async (email: { to: string; reply: string; original: string }) => {
      sent.push(email);
    };

    try {
      const { id } = await t.submitFeedback(bob, { feedback: 'Can you add CSV export?' }, 'web', {
        db: t.db,
        notify: async () => undefined,
      });

      // A failed email records nothing
      await assert.rejects(
        t.replyToFeedback(
          id,
          { message: 'Yes!', idempotencyKey: `k1-${t.suffix}` },
          {
            db: t.db,
            send: async () => {
              throw new t.MailNotSentError('SMTP server not configured');
            },
          },
        ),
        t.MailNotSentError,
      );
      assert.equal(await t.db.feedbackReply.count({ where: { feedbackId: id } }), 0);
      assert.equal((await t.db.feedback.findUniqueOrThrow({ where: { id } })).status, 'NEW');

      const replies = await Promise.all(
        Array.from({ length: 3 }, () =>
          t.replyToFeedback(
            id,
            { message: 'Yes, coming soon', idempotencyKey: `k1-${t.suffix}` },
            { db: t.db, send },
          ),
        ),
      );
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], {
        to: bob.email,
        reply: 'Yes, coming soon',
        original: 'Can you add CSV export?',
      });
      assert.equal(replies.filter(({ created }) => created).length, 1);
      assert.equal(new Set(replies.map(({ reply }) => reply.id)).size, 1);

      const page = await t.listFeedback({ limit: 200, status: 'REPLIED' });
      const listed = page.items.find((item) => item.id === id);
      assert.equal(listed?.replies.length, 1);
      assert.equal(listed?.user?.id, bob.id);

      // The key belongs to that feedback
      const other = await t.submitFeedback(bob, { feedback: 'Another idea for you' }, 'web', {
        db: t.db,
        notify: async () => undefined,
      });
      await assert.rejects(
        t.replyToFeedback(
          other.id,
          { message: 'Thanks', idempotencyKey: `k1-${t.suffix}` },
          { db: t.db, send },
        ),
        t.IdempotencyConflictError,
      );
      await assert.rejects(
        t.replyToFeedback(
          'missing',
          { message: 'Thanks', idempotencyKey: `k2-${t.suffix}` },
          { db: t.db, send },
        ),
        t.FeedbackNotFoundError,
      );

      const closed = await t.setFeedbackStatus(other.id, 'CLOSED', t.db);
      assert.equal(closed.status, 'CLOSED');
    } finally {
      await t.db.user.delete({ where: { id: bob.id } });
    }
  },
);

void test('feedback: importing twice skips what was imported', { skip: !databaseUrl }, async () => {
  const t = await setup();
  const carol = await t.createUser('Carol');
  const items = [
    {
      externalId: `ext-1-${t.suffix}`,
      email: carol.email!.toUpperCase(),
      message: 'Imported feedback with a reply',
      createdAt: '2026-01-02T03:04:05.000Z',
      replies: [
        {
          message: 'Thanks!',
          sentAt: '2026-01-03T03:04:05.000Z',
          idempotencyKey: `ext-1-reply-${t.suffix}`,
        },
      ],
    },
    {
      externalId: `ext-2-${t.suffix}`,
      email: t.emailOf('nobody'),
      message: 'Imported feedback from someone without an account',
      createdAt: '2026-01-04T03:04:05.000Z',
    },
  ];

  try {
    assert.deepEqual(await t.importFeedback({ items }, t.db), {
      created: 2,
      skipped: 0,
      linked: 1,
    });
    assert.deepEqual(await t.importFeedback({ items }, t.db), {
      created: 0,
      skipped: 2,
      linked: 0,
    });

    const imported = await t.db.feedback.findMany({
      where: { externalId: { in: items.map((item) => item.externalId) } },
      include: { replies: true },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(imported[0]?.userId, carol.id);
    assert.equal(imported[0]?.status, 'REPLIED');
    assert.equal(imported[0]?.source, 'import');
    assert.equal(imported[0]?.replies.length, 1);
    assert.equal(imported[0]?.createdAt.toISOString(), '2026-01-02T03:04:05.000Z');
    assert.equal(imported[1]?.userId, null);
    assert.equal(imported[1]?.status, 'NEW');

    // Paging with `since` and a cursor
    const first = await t.listFeedback({ limit: 1, since: '2026-01-01T00:00:00Z' }, t.db);
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = await t.listFeedback(
      { limit: 1, since: '2026-01-01T00:00:00Z', cursor: first.nextCursor },
      t.db,
    );
    assert.notEqual(second.items[0]?.id, first.items[0]?.id);
  } finally {
    await t.db.feedback.deleteMany({
      where: { externalId: { in: items.map((item) => item.externalId) } },
    });
    await t.db.user.delete({ where: { id: carol.id } });
  }
});
