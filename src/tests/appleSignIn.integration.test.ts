import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const databaseUrl = process.env.TEST_DATABASE_URL;

const BUNDLE_ID = 'app.splitpro';

void test(
  'Sign in with Apple: signs up, signs in again and links an existing account',
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
    process.env.DATABASE_URL = databaseUrl;
    process.env.SKIP_ENV_VALIDATION = '1';
    process.env.NEXTAUTH_SECRET ??= 'apple-sign-in-test-secret';
    process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

    const [{ db }, { env }, { signInWithApple }] = await Promise.all([
      import('~/server/db'),
      import('~/env'),
      import('~/server/mobileAuth'),
    ]);
    const mutableEnv = env as { -readonly [Key in keyof typeof env]: (typeof env)[Key] };
    const originalEnv = { ...env };
    mutableEnv.APPLE_BUNDLE_ID = BUNDLE_ID;
    mutableEnv.NODE_ENV = 'production';

    // Stand in for Apple: our own key served as Apple's key set
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('https://appleid.apple.com/auth/keys')
        ? new Response(JSON.stringify({ keys: [jwk] }), {
            headers: { 'content-type': 'application/json' },
          })
        : originalFetch(input, init)) as typeof fetch;

    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const identityToken = (sub: string, email: string) =>
      new SignJWT({ email, email_verified: 'true' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer('https://appleid.apple.com')
        .setAudience(BUNDLE_ID)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    const newEmail = `apple-new-${suffix}@example.com`;
    const existing = await db.user.create({
      data: { email: `apple-existing-${suffix}@example.com`, name: 'Existing', currency: 'USD' },
    });

    try {
      // First sign-in creates the account and links Apple to it
      const first = await signInWithApple(
        await identityToken(`sub-new-${suffix}`, newEmail),
        { givenName: 'Ada', familyName: 'Lovelace' },
        `ip-${suffix}`,
      );
      assert.ok(first.token);
      const created = await db.user.findUnique({ where: { email: newEmail } });
      assert.equal(created?.name, 'Ada Lovelace');
      assert.equal(await db.account.count({ where: { provider: 'apple', userId: created.id } }), 1);

      // Signing in again finds it through the linked Apple account
      const again = await signInWithApple(
        await identityToken(`sub-new-${suffix}`, newEmail),
        null,
        `ip-${suffix}`,
      );
      assert.equal(again.user.email, newEmail);
      assert.equal(await db.user.count({ where: { email: newEmail } }), 1);

      // An Apple ID with the same verified email as an existing account signs in to it
      const linked = await signInWithApple(
        await identityToken(`sub-existing-${suffix}`, existing.email!),
        null,
        `ip-${suffix}`,
      );
      assert.equal(linked.user.email, existing.email);
      assert.equal(
        await db.account.count({ where: { userId: existing.id, provider: 'apple' } }),
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
      Object.assign(mutableEnv, originalEnv);
      await db.user.deleteMany({
        where: { email: { in: [newEmail, existing.email!] } },
      });
      await db.$disconnect();
    }
  },
);
