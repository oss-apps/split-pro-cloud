import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Prisma, type Feedback, type PrismaClient } from '@prisma/client';

import { isAdminAuthorized } from '~/server/adminAuth';

process.env.SKIP_ENV_VALIDATION = '1';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:1/unused';

const { FEEDBACK_RATE_LIMIT, isOverFeedbackLimit, submitFeedback, submitFeedbackInput } =
  await import('~/server/api/services/feedbackService');

const TOKEN = 'a'.repeat(40);

void describe('isAdminAuthorized', () => {
  void it('accepts the exact bearer token', () => {
    assert.equal(isAdminAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAdminAuthorized(`bearer ${TOKEN}`, TOKEN), true);
  });

  void it('rejects anything else', () => {
    [
      undefined,
      '',
      'Bearer',
      `Basic ${TOKEN}`,
      `Bearer ${TOKEN}b`,
      `Bearer ${TOKEN.slice(1)}`,
      `Bearer ${'b'.repeat(40)}`,
      TOKEN,
    ].forEach((header) => assert.equal(isAdminAuthorized(header, TOKEN), false, String(header)));
  });

  void it('is off without a configured token', () => {
    assert.equal(isAdminAuthorized('Bearer ', undefined), false);
    assert.equal(isAdminAuthorized('Bearer undefined', undefined), false);
    assert.equal(isAdminAuthorized(`Bearer ${TOKEN}`, ''), false);
  });
});

void describe('submitFeedbackInput', () => {
  void it('accepts what older app builds send', () => {
    const parsed = submitFeedbackInput.parse({ feedback: '  This is my feedback  ' });
    assert.deepEqual(parsed, { feedback: 'This is my feedback' });
  });

  void it('checks length after trimming, and the key format', () => {
    assert.equal(submitFeedbackInput.safeParse({ feedback: '   short    ' }).success, false);
    assert.equal(submitFeedbackInput.safeParse({ feedback: 'x'.repeat(5001) }).success, false);
    assert.equal(
      submitFeedbackInput.safeParse({ feedback: 'long enough', clientKey: 'nope' }).success,
      false,
    );
    assert.equal(
      submitFeedbackInput.safeParse({ feedback: 'long enough', source: 'import' }).success,
      false,
    );
  });
});

void describe('isOverFeedbackLimit', () => {
  void it('allows up to the limit per window', () => {
    assert.equal(isOverFeedbackLimit(FEEDBACK_RATE_LIMIT.limit - 1), false);
    assert.equal(isOverFeedbackLimit(FEEDBACK_RATE_LIMIT.limit), true);
  });
});

/** Just enough of Prisma's feedback API for `submitFeedback`, kept in memory. */
const createFakeDb = () => {
  const rows: Feedback[] = [];
  let failNextCreateWithDuplicateKey = false;

  const feedback = {
    findUnique: async ({ where }: { where: { clientKey: string } }) =>
      rows.find((row) => row.clientKey === where.clientKey) ?? null,
    findFirst: async ({
      where,
    }: {
      where: { userId: number; message: string; createdAt: { gte: Date } };
    }) =>
      rows
        .filter(
          (row) =>
            row.userId === where.userId &&
            row.message === where.message &&
            row.createdAt >= where.createdAt.gte,
        )
        .at(-1) ?? null,
    count: async ({ where }: { where: { userId: number; createdAt: { gte: Date } } }) =>
      rows.filter((row) => row.userId === where.userId && row.createdAt >= where.createdAt.gte)
        .length,
    create: async ({
      data,
    }: {
      data: Omit<Feedback, 'id' | 'status' | 'createdAt' | 'updatedAt'>;
    }) => {
      if (failNextCreateWithDuplicateKey) {
        failNextCreateWithDuplicateKey = false;
        // Another request saved the same draft first
        rows.push({ ...newRow(data), id: `fb-${rows.length + 1}` });
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['clientKey'] },
        });
      }
      const row = { ...newRow(data), id: `fb-${rows.length + 1}` };
      rows.push(row);
      return row;
    },
  };

  const newRow = (data: Omit<Feedback, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Feedback => ({
    ...data,
    id: '',
    externalId: null,
    status: 'NEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const tx = { feedback, $queryRaw: async () => [] };
  const db = {
    ...tx,
    $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx),
  } as unknown as PrismaClient;

  return {
    db,
    rows,
    failNextCreate: () => {
      failNextCreateWithDuplicateKey = true;
    },
  };
};

const alice = { id: 1, email: 'alice@example.com', name: 'Alice' };
const bob = { id: 2, email: 'bob@example.com', name: 'Bob' };

const setup = () => {
  const fake = createFakeDb();
  const emailed: string[] = [];
  const deps = {
    db: fake.db,
    notify: async ({ id }: { id: string }) => {
      emailed.push(id);
    },
  };
  return { ...fake, emailed, deps };
};

void describe('submitFeedback', () => {
  void it('saves feedback, emails once and defaults the source', async () => {
    const { rows, emailed, deps } = setup();
    const result = await submitFeedback(alice, { feedback: '  Love the app!  ' }, 'mobile', deps);

    assert.deepEqual(result, { id: 'fb-1', created: true });
    assert.equal(rows[0]?.message, 'Love the app!');
    assert.equal(rows[0]?.source, 'mobile');
    assert.equal(rows[0]?.email, alice.email);
    assert.deepEqual(emailed, ['fb-1']);
  });

  void it('returns the saved feedback for the same draft key, without emailing again', async () => {
    const { rows, emailed, deps } = setup();
    const clientKey = randomUUID();
    const input = { feedback: 'Please add dark mode', clientKey, source: 'web' as const };

    const first = await submitFeedback(alice, input, 'web', deps);
    const second = await submitFeedback(alice, input, 'web', deps);

    assert.equal(second.id, first.id);
    assert.equal(second.created, false);
    assert.equal(rows.length, 1);
    assert.equal(emailed.length, 1);
  });

  void it('refuses a draft key someone else used', async () => {
    const { deps } = setup();
    const clientKey = randomUUID();
    await submitFeedback(alice, { feedback: 'Please add dark mode', clientKey }, 'web', deps);

    await assert.rejects(
      submitFeedback(bob, { feedback: 'Something else entirely', clientKey }, 'web', deps),
      (error: Error & { code?: string }) => 'CONFLICT' === error.code,
    );
  });

  void it('treats the same message within a day as a resend, for apps without a key', async () => {
    const { rows, emailed, deps } = setup();
    const first = await submitFeedback(alice, { feedback: 'Exports are broken' }, 'mobile', deps);
    const again = await submitFeedback(alice, { feedback: ' Exports are broken ' }, 'mobile', deps);
    // A new draft with the same text is still the same feedback
    const withKey = await submitFeedback(
      alice,
      { feedback: 'Exports are broken', clientKey: randomUUID() },
      'web',
      deps,
    );

    assert.equal(again.id, first.id);
    assert.equal(withKey.id, first.id);
    assert.equal(rows.length, 1);
    assert.equal(emailed.length, 1);

    // Someone else's identical message is theirs
    await submitFeedback(bob, { feedback: 'Exports are broken' }, 'web', deps);
    assert.equal(rows.length, 2);

    // After a day it's new feedback
    rows[0]!.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const later = await submitFeedback(alice, { feedback: 'Exports are broken' }, 'web', deps);
    assert.equal(later.created, true);
    assert.equal(rows.length, 3);
  });

  void it('limits how much one person sends in an hour', async () => {
    const { rows, deps } = setup();
    await Array.from({ length: FEEDBACK_RATE_LIMIT.limit }).reduce<Promise<unknown>>(
      async (previous, _, index) => {
        await previous;
        return submitFeedback(alice, { feedback: `Feedback number ${index}` }, 'web', deps);
      },
      Promise.resolve(),
    );

    await assert.rejects(
      submitFeedback(alice, { feedback: 'One more piece of feedback' }, 'web', deps),
      (error: Error & { code?: string }) => 'TOO_MANY_REQUESTS' === error.code,
    );
    // Resends of what was saved still answer, and others aren't limited
    const resend = await submitFeedback(alice, { feedback: 'Feedback number 3' }, 'web', deps);
    assert.equal(resend.created, false);
    await submitFeedback(bob, { feedback: 'Bob has thoughts too' }, 'web', deps);
    assert.equal(rows.length, FEEDBACK_RATE_LIMIT.limit + 1);
  });

  void it('returns the other request’s feedback when both save the same draft at once', async () => {
    const { rows, emailed, deps, failNextCreate } = setup();
    failNextCreate();

    const result = await submitFeedback(
      alice,
      { feedback: 'Racing submit', clientKey: randomUUID() },
      'web',
      deps,
    );

    assert.equal(result.created, false);
    assert.equal(result.id, rows[0]?.id);
    assert.equal(emailed.length, 0);
  });

  void it('still saves when the email fails', async () => {
    const { rows, deps } = setup();
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const result = await submitFeedback(alice, { feedback: 'SMTP is down today' }, 'web', {
        ...deps,
        notify: async () => {
          throw new Error('SMTP down');
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(result.created, true);
      assert.equal(rows.length, 1);
      assert.equal(errors.length, 1);
    } finally {
      console.error = originalError;
    }
  });

  void it('needs an email address to reply to', async () => {
    const { deps } = setup();
    await assert.rejects(
      submitFeedback({ id: 3, email: null }, { feedback: 'No email here' }, 'web', deps),
      (error: Error & { code?: string }) => 'BAD_REQUEST' === error.code,
    );
  });
});
