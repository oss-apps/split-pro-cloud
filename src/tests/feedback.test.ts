import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Prisma, type Feedback, type PrismaClient } from '@prisma/client';

import { isAdminAuthorized } from '~/server/adminAuth';
import { isDefiniteSendFailure, safeMailErrorDetails } from '~/server/mailErrors';
import { keyForDraft } from '~/utils/draftKey';

process.env.SKIP_ENV_VALIDATION = '1';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:1/unused';
const TOKEN = 'a'.repeat(40);
process.env.ADMIN_API_TOKEN = TOKEN;

const { FEEDBACK_RATE_LIMIT, isOverFeedbackLimit, submitFeedback, submitFeedbackInput } =
  await import('~/server/api/services/feedbackService');

const { adminApiRoute } = await import('~/server/adminApi');
const { MailNotSentError, sendFeedbackEmail } = await import('~/server/mailer');
const { env } = await import('~/env');

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

  // Live accounts, as the sender lock reads them
  const users = new Map<number, { email: string | null; name: string | null }>([
    [1, { email: 'alice@example.com', name: 'Alice' }],
    [2, { email: 'bob@example.com', name: 'Bob' }],
    [3, { email: null, name: 'No Email' }],
  ]);
  const tx = {
    feedback,
    $queryRaw: async (_query: TemplateStringsArray, userId: number) => {
      const user = users.get(userId);
      return user ? [user] : [];
    },
  };
  const db = {
    ...tx,
    $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx),
  } as unknown as PrismaClient;

  return {
    db,
    rows,
    users,
    failNextCreate: () => {
      failNextCreateWithDuplicateKey = true;
    },
  };
};

// Stale sessions on purpose: the email and name come from the account when it's saved
const alice = { id: 1, email: 'old-alice@example.com', name: 'Old Alice' };
const bob = { id: 2, email: 'old-bob@example.com', name: 'Old Bob' };

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
    assert.equal(rows[0]?.email, 'alice@example.com');
    assert.equal(rows[0]?.name, 'Alice');
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

  void it('refuses a draft key sent again with different text', async () => {
    const { rows, emailed, deps } = setup();
    const clientKey = randomUUID();
    await submitFeedback(alice, { feedback: 'First version of my idea', clientKey }, 'web', deps);

    await assert.rejects(
      submitFeedback(alice, { feedback: 'Edited version of my idea', clientKey }, 'web', deps),
      (error: Error & { code?: string }) => 'CONFLICT' === error.code,
    );
    assert.equal(rows.length, 1);
    assert.equal(emailed.length, 1);
  });

  void it('refuses a deleted account, whatever its session says', async () => {
    const { rows, users, emailed, deps } = setup();
    users.delete(alice.id);

    await assert.rejects(
      submitFeedback(alice, { feedback: 'Sent after deleting' }, 'web', deps),
      (error: Error & { code?: string }) => 'UNAUTHORIZED' === error.code,
    );
    assert.equal(rows.length, 0);
    assert.equal(emailed.length, 0);
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
          throw Object.assign(new Error('SMTP down for alice@example.com'), {
            code: 'EENVELOPE',
            responseCode: 550,
          });
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(result.created, true);
      assert.equal(rows.length, 1);
      assert.equal(errors.length, 1);
      // Only the id and codes are logged, never the message, recipient or feedback
      const logged = JSON.stringify(errors);
      assert.ok(!logged.includes('SMTP down'));
      assert.ok(logged.includes('EENVELOPE'));
      assert.ok(!logged.includes('alice@example.com'));
      assert.ok(!logged.includes('SMTP is down today'));
    } finally {
      console.error = originalError;
    }
  });

  void it('needs an email address to reply to', async () => {
    const { deps } = setup();
    await assert.rejects(
      submitFeedback({ id: 3 }, { feedback: 'No email here' }, 'web', deps),
      (error: Error & { code?: string }) => 'BAD_REQUEST' === error.code,
    );
  });
});

void describe('keyForDraft', () => {
  let count = 0;
  const newKey = () => `key-${++count}`;

  void it('keeps the key while the text is unchanged and changes it with the text', () => {
    const first = keyForDraft(null, 'Some feedback', newKey);
    const retry = keyForDraft(first, 'Some feedback', newKey);
    const edited = keyForDraft(retry, 'Some feedback, edited', newKey);
    const editedRetry = keyForDraft(edited, 'Some feedback, edited', newKey);

    assert.equal(retry.key, first.key);
    assert.notEqual(edited.key, first.key);
    assert.equal(editedRetry.key, edited.key);
    // Back to the first text is a new attempt too
    assert.notEqual(keyForDraft(editedRetry, 'Some feedback', newKey).key, first.key);
  });
});

void describe('SMTP send errors', () => {
  const smtpError = (fields: Record<string, unknown>) =>
    Object.assign(new Error('550 rejected for someone@example.com'), fields);

  void it('only treats failures before the server could accept the message as definite', () => {
    // Refused by the server, or never reached it
    [
      { code: 'ENOTCONFIGURED' },
      { code: 'EAUTH', responseCode: 535 },
      { code: 'EENVELOPE', responseCode: 550 },
      { code: 'EMESSAGE', responseCode: 554 },
      { code: 'EDNS' },
      { code: 'ESOCKET', originalCode: 'ECONNREFUSED' },
      { code: 'ETIMEDOUT', timeoutType: 'CONNECT_TIMEOUT' },
      { code: 'ETIMEDOUT', timeoutType: 'GREETING_TIMEOUT' },
    ].forEach((fields) =>
      assert.equal(isDefiniteSendFailure(smtpError(fields)), true, JSON.stringify(fields)),
    );

    // Could have been accepted before the connection went
    [
      { code: 'ECONNECTION' },
      { code: 'ESOCKET', originalCode: 'ECONNRESET' },
      { code: 'ETIMEDOUT', timeoutType: 'SOCKET_TIMEOUT' },
      { code: 'EPROTOCOL' },
      {},
    ].forEach((fields) =>
      assert.equal(isDefiniteSendFailure(smtpError(fields)), false, JSON.stringify(fields)),
    );
    assert.equal(isDefiniteSendFailure('boom'), false);
  });

  void it('keeps only the error code and reply code', () => {
    assert.deepEqual(safeMailErrorDetails(smtpError({ code: 'EENVELOPE', responseCode: 550 })), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    assert.deepEqual(
      safeMailErrorDetails(smtpError({ code: 'someone@example.com', responseCode: '550' })),
      { code: undefined, responseCode: undefined },
    );
  });
});

void describe('adminApiRoute', () => {
  type Sent = { status: number; body: unknown; headers: Record<string, string> };

  const call = async (
    route: ReturnType<typeof adminApiRoute>,
    {
      method = 'POST',
      authorization = `Bearer ${TOKEN}`,
      body = '',
      onRead,
    }: { method?: string; authorization?: string; body?: string; onRead?: () => void },
  ) => {
    const sent: Sent = { status: 0, body: undefined, headers: {} };
    const req = {
      method,
      query: {},
      headers: { authorization, 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() {
        onRead?.();
        yield Buffer.from(body);
      },
    };
    const res = {
      setHeader: (name: string, value: string) => {
        sent.headers[name] = value;
      },
      status: (status: number) => {
        sent.status = status;
        return res;
      },
      json: (value: unknown) => {
        sent.body = value;
        return res;
      },
    };
    await route(req as never, res as never);
    return sent;
  };

  const echo = adminApiRoute(
    ['POST'],
    async (_req, res, body) => {
      res.status(200).json({ body });
    },
    { maxBodyBytes: 32 },
  );

  void it('rejects a bad token without reading the body', async () => {
    let read = false;
    const sent = await call(echo, {
      authorization: 'Bearer wrong',
      body: '{}',
      onRead: () => {
        read = true;
      },
    });
    assert.equal(sent.status, 401);
    assert.equal(read, false);
  });

  void it('parses JSON bodies up to the limit', async () => {
    assert.deepEqual(await call(echo, { body: '{"a":1}' }), {
      status: 200,
      body: { body: { a: 1 } },
      headers: { 'Cache-Control': 'no-store' },
    });
    assert.equal((await call(echo, { body: `{"a":"${'x'.repeat(40)}"}` })).status, 413);
    assert.equal((await call(echo, { body: '{nope' })).status, 400);
    assert.equal((await call(echo, { method: 'GET' })).status, 405);
  });

  void it('logs no message for unexpected errors', async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const failing = adminApiRoute(['POST'], async () => {
        throw new Error('secret@example.com');
      });
      assert.equal((await call(failing, { body: '{}' })).status, 500);
    } finally {
      console.error = originalError;
    }
    assert.ok(!JSON.stringify(errors).includes('secret@example.com'));
  });
});

void describe('sendFeedbackEmail', () => {
  const feedback = {
    id: 'fb-123',
    message: 'The feedback itself',
    email: 'sender@example.com',
    name: 'Sender',
    source: 'web',
    appVersion: null,
  };
  const smtpRejection = () =>
    Object.assign(new Error('550 5.1.1 <feedback-inbox@example.com>: Recipient address rejected'), {
      code: 'EENVELOPE',
      responseCode: 550,
      response: '550 5.1.1 <feedback-inbox@example.com>: Recipient address rejected',
    });

  /** Runs `run` with console output and Discord posts captured. */
  const capture = async (run: () => Promise<unknown>) => {
    const mutableEnv = env as { -readonly [Key in keyof typeof env]: (typeof env)[Key] };
    const originalEnv = { ...env };
    const original = { error: console.error, log: console.log, warn: console.warn };
    const originalFetch = globalThis.fetch;
    const output: unknown[] = [];
    const record = (...args: unknown[]) => {
      output.push(args);
    };
    mutableEnv.FEEDBACK_EMAIL = 'feedback-inbox@example.com';
    mutableEnv.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook';
    console.error = record;
    console.log = record;
    console.warn = record;
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      output.push(['discord', init?.body]);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      return { result: await run(), output: JSON.stringify(output) };
    } finally {
      Object.assign(mutableEnv, originalEnv);
      Object.assign(console, original);
      globalThis.fetch = originalFetch;
    }
  };

  void it('logs and reports only the feedback id and codes when the server rejects it', async () => {
    const thrown = [smtpRejection(), new MailNotSentError(smtpRejection())];

    await thrown.reduce(async (previous, error) => {
      await previous;
      const { result, output } = await capture(() =>
        sendFeedbackEmail(feedback, async () => {
          throw error;
        }),
      );

      assert.equal(result, false);
      assert.ok(output.includes('fb-123'));
      assert.ok(output.includes('EENVELOPE'));
      assert.ok(output.includes('discord'));
      [
        'feedback-inbox@example.com',
        'sender@example.com',
        'Recipient address',
        '550 5.1.1',
      ].forEach((secret) => assert.ok(!output.includes(secret), `${secret} leaked: ${output}`));
    }, Promise.resolve());
  });

  void it('sends to the feedback inbox with the sender as reply-to', async () => {
    const calls: unknown[][] = [];
    const { result } = await capture(() =>
      sendFeedbackEmail(feedback, async (...args) => {
        calls.push(args);
      }),
    );

    assert.equal(result, true);
    assert.equal(calls[0]?.[0], 'feedback-inbox@example.com');
    assert.match(String(calls[0]?.[1]), /^Feedback received on SplitPro/);
    assert.equal(calls[0]?.[4], 'sender@example.com');
  });
});
