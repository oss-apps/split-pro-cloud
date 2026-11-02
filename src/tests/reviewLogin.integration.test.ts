import assert from 'node:assert/strict';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

void test(
  'Review login: the configured email signs in with its fixed code and nothing else changes',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';
    process.env.NEXTAUTH_SECRET ??= 'review-login-test-secret';
    process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

    const [{ db }, { env }, { sendEmailCode, verifyEmailCode }] = await Promise.all([
      import('~/server/db'),
      import('~/env'),
      import('~/server/mobileAuth'),
    ]);
    const mutableEnv = env as { -readonly [Key in keyof typeof env]: (typeof env)[Key] };
    const originalEnv = { ...env };
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const reviewEmail = `review-${suffix}@example.com`;
    const otherEmail = `other-${suffix}@example.com`;
    mutableEnv.REVIEW_LOGIN_EMAIL = reviewEmail.toUpperCase();
    mutableEnv.REVIEW_LOGIN_CODE = 'rv7k2m';
    mutableEnv.NODE_ENV = 'production';

    try {
      await sendEmailCode(reviewEmail, `ip-${suffix}`);
      const signedIn = await verifyEmailCode(reviewEmail, 'RV7K2M', `ip-${suffix}`);
      assert.ok(signedIn.token);
      assert.equal(signedIn.user.email, reviewEmail);

      // Single use like any code
      await assert.rejects(verifyEmailCode(reviewEmail, 'RV7K2M', `ip-${suffix}`), /Invalid/);

      // Without a requested code, the fixed code doesn't work
      await assert.rejects(verifyEmailCode(reviewEmail, 'RV7K2M', `ip-${suffix}`), /Invalid/);

      // Other addresses never accept it
      await db.verificationToken.deleteMany({ where: { identifier: otherEmail } });
      await assert.rejects(verifyEmailCode(otherEmail, 'RV7K2M', `ip-${suffix}`), /Invalid/);
    } finally {
      Object.assign(mutableEnv, originalEnv);
      await db.verificationToken.deleteMany({
        where: { identifier: { in: [reviewEmail, otherEmail] } },
      });
      await db.user.deleteMany({ where: { email: { in: [reviewEmail, otherEmail] } } });
      await db.$disconnect();
    }
  },
);
