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

/** How account deletion leaves the user row; see `anonymiseAccount`. */
const anonymised = () => ({ deletedAt: new Date(), email: null, name: 'Deleted user' });

void test(
  'feedback: a deleted account can’t send feedback with its old session',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const dora = await t.createUser('Dora');
    const erin = await t.createUser('Erin');
    const deps = { db: t.db, notify: async () => undefined };
    const isUnauthorized = (error: Error & { code?: string }) => 'UNAUTHORIZED' === error.code;

    try {
      // Already deleted: the session still has the old email and name
      const staleDora = { id: dora.id, email: dora.email, name: dora.name };
      await t.db.user.update({
        where: { id: dora.id },
        data: anonymised(),
      });
      await assert.rejects(
        t.submitFeedback(staleDora, { feedback: 'Sent after deleting' }, 'web', deps),
        isUnauthorized,
      );

      // Deleted while the submit waits for the account
      let release!: () => void;
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const deletion = t.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${erin.id} FOR UPDATE`;
        locked();
        await new Promise<void>((resolve) => (release = resolve));
        await tx.user.update({
          where: { id: erin.id },
          data: anonymised(),
        });
      });
      await isLocked;
      const submit = t.submitFeedback(erin, { feedback: 'Sent while deleting' }, 'web', deps);
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await deletion;
      await assert.rejects(submit, isUnauthorized);

      assert.equal(await t.db.feedback.count({ where: { userId: { in: [dora.id, erin.id] } } }), 0);
    } finally {
      await t.db.user.deleteMany({ where: { id: { in: [dora.id, erin.id] } } });
    }
  },
);

type ReplyEmail = { to: string; reply: string; original: string };

void test(
  'feedback: replies are sent once per key and recorded with their delivery',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const bob = await t.createUser('Bob');
    const sent: ReplyEmail[] = [];
    const send = async (email: ReplyEmail) => {
      sent.push(email);
    };
    const quiet = { db: t.db, notify: async () => undefined };
    const key = (name: string) => `${name}-${t.suffix}`;

    try {
      const { id } = await t.submitFeedback(
        bob,
        { feedback: 'Can you add CSV export?' },
        'web',
        quiet,
      );

      // A definite failure is recorded as FAILED, and the same key sends again
      await assert.rejects(
        t.replyToFeedback(
          id,
          { message: 'Yes!', idempotencyKey: key('k1') },
          {
            db: t.db,
            send: async () => {
              throw new t.MailNotSentError({ code: 'ENOTCONFIGURED' });
            },
          },
        ),
        (error: Error & { definite?: boolean }) => true === error.definite,
      );
      const failed = await t.db.feedbackReply.findUniqueOrThrow({
        where: { idempotencyKey: key('k1') },
      });
      assert.equal(failed.deliveryStatus, 'FAILED');
      assert.equal(failed.sentAt, null);
      assert.equal((await t.db.feedback.findUniqueOrThrow({ where: { id } })).status, 'NEW');

      const settled = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          t.replyToFeedback(
            id,
            { message: 'Yes, coming soon', idempotencyKey: key('k1') },
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
      const created = settled.filter(
        (result) => 'fulfilled' === result.status && result.value.created,
      );
      assert.equal(created.length, 1);
      // The others found it sent, or still sending
      settled.forEach((result) => {
        if ('rejected' === result.status) {
          assert.ok(result.reason instanceof t.ReplyInProgressError);
        }
      });

      const again = await t.replyToFeedback(
        id,
        { message: 'Yes, coming soon', idempotencyKey: key('k1') },
        { db: t.db, send },
      );
      assert.equal(again.created, false);
      assert.equal(again.reply.deliveryStatus, 'SENT');
      assert.ok(again.reply.sentAt);
      assert.equal(sent.length, 1);

      const page = await t.listFeedback({ limit: 200, status: 'REPLIED' });
      const listed = page.items.find((item) => item.id === id);
      assert.equal(listed?.replies.length, 1);
      assert.equal(listed?.replies[0]?.deliveryStatus, 'SENT');
      assert.equal(listed?.user?.id, bob.id);

      // The key belongs to that feedback
      const other = await t.submitFeedback(bob, { feedback: 'Another idea for you' }, 'web', quiet);
      await assert.rejects(
        t.replyToFeedback(
          other.id,
          { message: 'Thanks', idempotencyKey: key('k1') },
          { db: t.db, send },
        ),
        t.IdempotencyConflictError,
      );
      await assert.rejects(
        t.replyToFeedback(
          'missing',
          { message: 'Thanks', idempotencyKey: key('k2') },
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

void test(
  'feedback: one key used on two feedback at once sends one email',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const fay = await t.createUser('Fay');
    const sent: ReplyEmail[] = [];
    const quiet = { db: t.db, notify: async () => undefined };

    try {
      const first = await t.submitFeedback(fay, { feedback: 'First feedback here' }, 'web', quiet);
      const second = await t.submitFeedback(
        fay,
        { feedback: 'Second feedback here' },
        'web',
        quiet,
      );
      const idempotencyKey = `shared-${t.suffix}`;

      const settled = await Promise.allSettled(
        [first.id, second.id, first.id, second.id].map((id) =>
          t.replyToFeedback(
            id,
            { message: 'Thanks!', idempotencyKey },
            {
              db: t.db,
              send: async (email) => {
                sent.push(email);
              },
            },
          ),
        ),
      );

      assert.equal(sent.length, 1);
      assert.equal(settled.filter((r) => 'fulfilled' === r.status && r.value.created).length, 1);
      settled.forEach((result) => {
        if ('rejected' === result.status) {
          assert.ok(
            result.reason instanceof t.IdempotencyConflictError ||
              result.reason instanceof t.ReplyInProgressError,
          );
        }
      });
      assert.equal(await t.db.feedbackReply.count({ where: { idempotencyKey } }), 1);
    } finally {
      await t.db.user.delete({ where: { id: fay.id } });
    }
  },
);

void test(
  'feedback: a reply that may have gone out is never sent again',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const gus = await t.createUser('Gus');
    let sends = 0;
    const quiet = { db: t.db, notify: async () => undefined };
    const idempotencyKey = `uncertain-${t.suffix}`;

    try {
      const { id } = await t.submitFeedback(
        gus,
        { feedback: 'Feedback for an uncertain reply' },
        'web',
        quiet,
      );

      // The connection dropped once the message was on its way
      await assert.rejects(
        t.replyToFeedback(
          id,
          { message: 'Thanks!', idempotencyKey },
          {
            db: t.db,
            send: async () => {
              sends += 1;
              throw new t.MailNotSentError({ code: 'ECONNECTION' });
            },
          },
        ),
        (error: Error & { definite?: boolean }) => false === error.definite,
      );
      const reply = await t.db.feedbackReply.findUniqueOrThrow({ where: { idempotencyKey } });
      assert.equal(reply.deliveryStatus, 'SENDING');

      // Retrying while SENDING doesn't send
      await assert.rejects(
        t.replyToFeedback(
          id,
          { message: 'Thanks!', idempotencyKey },
          {
            db: t.db,
            send: async () => {
              sends += 1;
            },
          },
        ),
        t.ReplyInProgressError,
      );
      assert.equal(sends, 1);
    } finally {
      await t.db.user.delete({ where: { id: gus.id } });
    }
  },
);

void test(
  'feedback: import stores only live accounts’ feedback, once',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const carol = await t.createUser('Carol');
    const hank = await t.createUser('Hank');
    await t.db.user.update({
      where: { id: hank.id },
      data: anonymised(),
    });
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
        email: carol.email!,
        message: 'Imported feedback without a reply',
        createdAt: '2026-01-04T03:04:05.000Z',
      },
      {
        externalId: `ext-3-${t.suffix}`,
        email: t.emailOf('nobody'),
        message: 'Imported feedback from someone without an account',
        createdAt: '2026-01-04T03:04:05.000Z',
      },
      {
        externalId: `ext-4-${t.suffix}`,
        // The deleted account's old address
        email: hank.email!,
        message: 'Imported feedback from a deleted account',
        createdAt: '2026-01-05T03:04:05.000Z',
      },
    ];
    const externalIds = items.map((item) => item.externalId);

    try {
      assert.deepEqual(await t.importFeedback({ items }, t.db), {
        created: 2,
        skipped: 0,
        unmatched: 2,
      });
      assert.deepEqual(await t.importFeedback({ items }, t.db), {
        created: 0,
        skipped: 2,
        unmatched: 2,
      });

      const imported = await t.db.feedback.findMany({
        where: { externalId: { in: externalIds } },
        include: { replies: true },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(imported.length, 2);
      assert.ok(imported.every((feedback) => feedback.userId === carol.id));
      assert.equal(imported[0]?.status, 'REPLIED');
      assert.equal(imported[0]?.source, 'import');
      assert.equal(imported[0]?.replies[0]?.deliveryStatus, 'SENT');
      assert.equal(imported[0]?.replies[0]?.sentAt?.toISOString(), '2026-01-03T03:04:05.000Z');
      assert.equal(imported[0]?.createdAt.toISOString(), '2026-01-02T03:04:05.000Z');
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
      await t.db.feedback.deleteMany({ where: { externalId: { in: externalIds } } });
      await t.db.user.deleteMany({ where: { id: { in: [carol.id, hank.id] } } });
    }
  },
);
