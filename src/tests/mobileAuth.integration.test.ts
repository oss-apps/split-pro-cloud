import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type NextApiRequest, type NextApiResponse } from 'next';

const databaseUrl = process.env.TEST_DATABASE_URL;

const DAY_MS = 24 * 60 * 60_000;
const WEB_SESSION_MAX_AGE_MS = 30 * DAY_MS;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';
  process.env.NEXTAUTH_SECRET ??= 'mobile-auth-test-secret';
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

  const [{ db }, { env }, { authAdapter }, mobileAuth, tokens] = await Promise.all([
    import('~/server/db'),
    import('~/env'),
    import('~/server/auth'),
    import('~/server/mobileAuth'),
    import('~/server/mobileAuthTokens'),
  ]);

  // Read when used, so tests can switch settings
  const mutableEnv = env as { -readonly [Key in keyof typeof env]: (typeof env)[Key] };

  return {
    db,
    env: mutableEnv,
    authAdapter,
    ...mobileAuth,
    ...tokens,
    secret: process.env.NEXTAUTH_SECRET,
  };
};

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/** Just enough of Next's req/res to call an API route directly. */
const callRoute = async (
  handler: Handler,
  {
    method = 'GET',
    headers = {},
    cookies = {},
    query = {},
    body,
  }: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  },
) => {
  const responseHeaders: Record<string, unknown> = {};
  const response = {
    status: 200,
    body: undefined as unknown,
    location: '',
    setCookies: [] as string[],
  };
  const res = {
    getHeader: (name: string) => responseHeaders[name.toLowerCase()],
    setHeader: (name: string, value: unknown) => {
      responseHeaders[name.toLowerCase()] = value;
      return res;
    },
    status: (status: number) => {
      response.status = status;
      return res;
    },
    json: (data: unknown) => {
      response.body = data;
      return res;
    },
    send: (data: unknown) => {
      response.body = data;
      return res;
    },
    redirect: (status: number, location: string) => {
      response.status = status;
      response.location = location;
      return res;
    },
  };
  const req = {
    method,
    headers: { 'cf-connecting-ip': 'test-route', ...headers },
    cookies,
    query,
    body,
  };

  await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
  const setCookie = responseHeaders['set-cookie'];
  response.setCookies = Array.isArray(setCookie)
    ? setCookie.map(String)
    : setCookie
      ? [String(setCookie)]
      : [];
  return response;
};

/** The cookies a response sets, by name, as a browser would keep them. */
const cookieJar = (setCookies: string[]) =>
  Object.fromEntries(
    setCookies.map((cookie) => {
      const [pair = ''] = cookie.split(';');
      const index = pair.indexOf('=');
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
  );

const withStatus = (status: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, status, String(error));
  return true;
};

void test(
  'mobile auth: email code attempts, bearer sessions and the browser handoff',
  { skip: !databaseUrl },
  async () => {
    const {
      db,
      secret,
      verifyEmailCode,
      getMobileSession,
      deleteMobileSession,
      createHandoffCode,
      exchangeHandoffCode,
      hashVerificationToken,
      pkceChallenge,
      generateOpaqueToken,
    } = await setup();
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const email = `mobile-${suffix}@example.com`;
    const ip = `test-${suffix}`;

    const issueCode = (code: string) =>
      db.verificationToken.create({
        data: {
          identifier: email,
          token: hashVerificationToken(code, secret),
          expires: new Date(Date.now() + 10 * 60_000),
        },
      });
    const resetLimits = () =>
      db.rateLimit.deleteMany({ where: { key: { in: [`email-verify:email:${email}`] } } });

    try {
      // Five wrong guesses are rejected, the next attempt burns the code even if it is right
      await issueCode('ABC234');
      for (let attempt = 0; attempt < 5; attempt++) {
        await assert.rejects(verifyEmailCode(email, 'ZZZZZZ', ip), withStatus(400));
      }
      await assert.rejects(verifyEmailCode(email, 'ABC234', ip), withStatus(429));
      assert.equal(await db.verificationToken.count({ where: { identifier: email } }), 0);

      // A fresh code signs up a new user, tolerating case and spaces like the web form
      await resetLimits();
      await issueCode('ABC234');
      const signIn = await verifyEmailCode(email.toUpperCase(), ' abc234 ', ip);
      assert.equal(signIn.user.email, email);
      assert.equal(signIn.user.name, `mobile-${suffix}`);
      assert.equal(signIn.user.currency, 'USD');
      await assert.rejects(verifyEmailCode(email, 'ABC234', ip), withStatus(400));

      const session = await getMobileSession(signIn.token);
      assert.equal(session?.user.id, signIn.user.id);
      assert.ok(new Date(session.expires).getTime() > Date.now() + 179 * 24 * 60 * 60_000);

      await deleteMobileSession(signIn.token);
      assert.equal(await getMobileSession(signIn.token), null);

      // Handoff codes need the matching verifier and work once
      const verifier = generateOpaqueToken();
      const challenge = pkceChallenge(verifier);

      const wrongVerifierCode = await createHandoffCode(challenge, signIn.user.id);
      await assert.rejects(
        exchangeHandoffCode(wrongVerifierCode, generateOpaqueToken(), ip),
        withStatus(400),
      );
      await assert.rejects(exchangeHandoffCode(wrongVerifierCode, verifier, ip), withStatus(400));

      const code = await createHandoffCode(challenge, signIn.user.id);
      const exchanged = await exchangeHandoffCode(code, verifier, ip);
      assert.equal(exchanged.user.id, signIn.user.id);
      assert.ok((await getMobileSession(exchanged.token))?.user);
      await assert.rejects(exchangeHandoffCode(code, verifier, ip), withStatus(400));
    } finally {
      await db.verificationToken.deleteMany({
        where: { OR: [{ identifier: email }, { identifier: { startsWith: 'mobile-handoff:' } }] },
      });
      await db.rateLimit.deleteMany({ where: { key: { contains: suffix } } });
      await db.user.deleteMany({ where: { email } });
      await db.$disconnect();
    }
  },
);

void test(
  'mobile auth: the Google handoff only hands over a session the sign-in from /start created',
  { skip: !databaseUrl },
  async () => {
    const { db, env, generateOpaqueToken, pkceChallenge } = await setup();
    const [{ default: start }, { default: handoff }, { default: exchange }] = await Promise.all([
      import('~/pages/api/mobile/auth/start'),
      import('~/pages/api/mobile/auth/handoff'),
      import('~/pages/api/mobile/auth/exchange'),
    ]);
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const originalEnv = { ...env };
    Object.assign(env, {
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
    });

    const victim = await db.user.create({ data: { email: `victim-${suffix}@example.com` } });
    const createWebSession = (createdAt: number) =>
      db.session.create({
        data: {
          sessionToken: generateOpaqueToken(),
          userId: victim.id,
          expires: new Date(createdAt + WEB_SESSION_MAX_AGE_MS),
        },
      });

    try {
      const verifier = generateOpaqueToken();
      const challenge = pkceChallenge(verifier);
      const redirect = 'splitpro://oauth-callback';

      // Expo Go redirects, i.e. any Expo Go project, are refused outside development
      const expoGo = await callRoute(start, {
        query: { provider: 'google', challenge, redirect: 'exp://evil.example.com/--/x' },
      });
      assert.equal(expoGo.status, 400);

      // A link or form on another site can't use /start to sign the browser out
      const existing = await createWebSession(Date.now() - DAY_MS);
      for (const headers of [
        { 'sec-fetch-site': 'cross-site' } as Record<string, string>,
        { 'sec-fetch-site': 'same-site' },
        { referer: 'https://evil.example/' },
      ]) {
        const linked = await callRoute(start, {
          query: { provider: 'google', challenge, redirect },
          headers,
          cookies: { 'next-auth.session-token': existing.sessionToken },
        });
        assert.equal(linked.status, 403, JSON.stringify(headers));
        assert.match(String(linked.body), /open the app and start signing in there/);
        assert.deepEqual(linked.setCookies, []);
        assert.equal(await db.session.count({ where: { id: existing.id } }), 1);
      }

      // Opened by the app's browser, /start signs it out of the web and asks Google which account
      // to use. Browsers too old to send Sec-Fetch-Site are treated the same.
      const fromApp = await callRoute(start, {
        query: { provider: 'google', challenge, redirect },
        headers: { 'sec-fetch-site': 'none' },
      });
      assert.equal(fromApp.status, 200);
      const started = await callRoute(start, {
        query: { provider: 'google', challenge, redirect },
        cookies: { 'next-auth.session-token': existing.sessionToken },
      });
      assert.equal(started.status, 200);
      assert.match(
        String(started.body),
        /action="\/api\/auth\/signin\/google\?prompt=select_account"/,
      );
      assert.equal(await db.session.count({ where: { id: existing.id } }), 0);
      const jar = cookieJar(started.setCookies);
      assert.equal(jar['next-auth.session-token'], '');
      assert.equal(jar['__Secure-next-auth.session-token'], '');
      assert.ok(
        started.setCookies.some((cookie) =>
          /^__Secure-next-auth\.session-token=;.*Max-Age=0.*Secure/.test(cookie),
        ),
      );
      const challengeCookie = jar['splitpro.mobile-challenge'] ?? '';
      assert.ok(challengeCookie.startsWith(`${challenge}.`));

      // A session from before /start never gets a code, even if it somehow survived
      const stale = await createWebSession(Date.now() - 60_000);
      const staleHandoff = await callRoute(handoff, {
        query: { challenge, redirect },
        cookies: {
          'splitpro.mobile-challenge': challengeCookie,
          'next-auth.session-token': stale.sessionToken,
        },
      });
      assert.equal(staleHandoff.location, `${redirect}?error=unauthenticated`);

      // Nor does a session without the signed cookie from /start
      const fresh = await createWebSession(Date.now() + 1);
      const forged = await callRoute(handoff, {
        query: { challenge, redirect },
        cookies: {
          'splitpro.mobile-challenge': `${challenge}.0.forged`,
          'next-auth.session-token': fresh.sessionToken,
        },
      });
      assert.equal(forged.location, `${redirect}?error=invalid_state`);

      // The session the Google sign-in creates after /start is handed over, once
      const handedOff = await callRoute(handoff, {
        query: { challenge, redirect },
        cookies: {
          'splitpro.mobile-challenge': challengeCookie,
          'next-auth.session-token': fresh.sessionToken,
        },
      });
      const code = new URL(handedOff.location).searchParams.get('code');
      assert.ok(handedOff.location.startsWith(`${redirect}?code=`) && code);
      assert.equal(cookieJar(handedOff.setCookies)['splitpro.mobile-challenge'], '');

      const exchanged = await callRoute(exchange, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { code, verifier },
      });
      assert.equal(exchanged.status, 200);
      assert.equal((exchanged.body as { user: { id: number } }).user.id, victim.id);

      // Over https the challenge cookie is __Secure- prefixed
      env.NEXTAUTH_URL = 'https://splitpro.example';
      const secure = await callRoute(start, { query: { provider: 'google', challenge, redirect } });
      const secureCookie = secure.setCookies.find((cookie) =>
        cookie.startsWith('__Secure-splitpro.mobile-challenge='),
      );
      assert.ok(secureCookie?.includes('; Secure'));
      assert.ok(
        cookieJar(secure.setCookies)['__Secure-splitpro.mobile-challenge']?.startsWith(challenge),
      );
    } finally {
      Object.assign(env, originalEnv);
      await db.verificationToken.deleteMany({
        where: { identifier: { startsWith: 'mobile-handoff:' } },
      });
      await db.rateLimit.deleteMany({ where: { key: { contains: 'test-route' } } });
      await db.user.deleteMany({ where: { id: victim.id } });
      await db.$disconnect();
    }
  },
);

void test(
  'mobile auth: scoped handoff codes, sign up races, Apple audience, sign out and content types',
  { skip: !databaseUrl },
  async () => {
    const {
      db,
      env,
      authAdapter,
      secret,
      verifyEmailCode,
      exchangeHandoffCode,
      signInWithApple,
      getMobileSession,
      hashVerificationToken,
      generateOpaqueToken,
      mobileAuthRoute,
    } = await setup();
    const [{ default: signout }, { default: sendEmail }, { createTRPCContext }] = await Promise.all(
      [
        import('~/pages/api/mobile/auth/signout'),
        import('~/pages/api/mobile/auth/email'),
        import('~/server/api/trpc'),
      ],
    );
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ip = `test-${suffix}`;
    const email = `race-${suffix}@example.com`;
    const originalEnv = { ...env };
    const originalGetUserByEmail = authAdapter.getUserByEmail;

    const [alice, bob] = await Promise.all(
      ['alice', 'bob'].map((name) =>
        db.user.create({ data: { email: `${name}-${suffix}@example.com`, name } }),
      ),
    );
    assert.ok(alice && bob);
    const createSession = (userId: number, expiresInMs = 30 * DAY_MS) =>
      db.session.create({
        data: {
          sessionToken: generateOpaqueToken(),
          userId,
          expires: new Date(Date.now() + expiresInMs),
        },
      });
    const issueEmailCode = (identifier: string, code: string) =>
      db.verificationToken.create({
        data: {
          identifier,
          token: hashVerificationToken(code, secret),
          expires: new Date(Date.now() + 10 * 60_000),
        },
      });

    try {
      // A handoff exchange only looks at handoff codes, so it can't burn an email code
      const emailCode = generateOpaqueToken();
      await issueEmailCode(alice.email!, emailCode);
      await assert.rejects(
        exchangeHandoffCode(emailCode, generateOpaqueToken(), ip),
        withStatus(400),
      );
      assert.equal(await db.verificationToken.count({ where: { identifier: alice.email! } }), 1);
      await assert.rejects(
        exchangeHandoffCode('ABC234', generateOpaqueToken(), ip),
        withStatus(400),
      );

      // A user created concurrently by another sign-in is reused instead of failing
      const existing = await db.user.create({ data: { email, name: 'Existing' } });
      authAdapter.getUserByEmail = async () => null;
      await issueEmailCode(email, 'ABC234');
      const raced = await verifyEmailCode(email, 'ABC234', ip);
      assert.equal(raced.user.id, existing.id);
      assert.equal(raced.user.name, 'Existing');
      authAdapter.getUserByEmail = originalGetUserByEmail;

      // Invite only instances refuse sign ups with a clean 403
      env.INVITE_ONLY = true;
      await issueEmailCode(`new-${email}`, 'ABC234');
      await assert.rejects(verifyEmailCode(`new-${email}`, 'ABC234', ip), (error: unknown) => {
        assert.equal((error as { status?: number }).status, 403);
        assert.equal((error as Error).message, 'This instance is Invite Only');
        return true;
      });
      env.INVITE_ONLY = false;

      // Any Expo Go project gets tokens for Expo Go's bundle id, so it only counts in development
      env.APPLE_BUNDLE_ID = 'host.exp.Exponent';
      env.NODE_ENV = 'production';
      await assert.rejects(signInWithApple('a.b.c', null, ip), withStatus(503));
      env.NODE_ENV = 'development';
      await assert.rejects(signInWithApple('a.b.c', null, ip), withStatus(401));
      env.NODE_ENV = 'production';

      // Signing out deletes the device's push token, if it's the signed in user's
      const aliceSession = await createSession(alice.id);
      const [aliceToken, bobToken] = [
        `ExponentPushToken[a-${suffix}]`,
        `ExponentPushToken[b-${suffix}]`,
      ];
      await db.devicePushToken.createMany({
        data: [
          { userId: alice.id, token: aliceToken, platform: 'ios' },
          { userId: bob.id, token: bobToken, platform: 'android' },
        ],
      });
      const signOut = (sessionToken: string, body: unknown) =>
        callRoute(signout, {
          method: 'POST',
          headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
          body,
        });

      assert.equal((await signOut(aliceSession.sessionToken, { pushToken: bobToken })).status, 200);
      assert.equal(await db.devicePushToken.count({ where: { token: bobToken } }), 1);
      assert.equal(await getMobileSession(aliceSession.sessionToken), null);

      const aliceSession2 = await createSession(alice.id);
      assert.equal(
        (await signOut(aliceSession2.sessionToken, { pushToken: aliceToken })).status,
        200,
      );
      assert.equal(await db.devicePushToken.count({ where: { token: aliceToken } }), 0);
      assert.equal(await db.session.count({ where: { id: aliceSession2.id } }), 0);

      const aliceSession3 = await createSession(alice.id);
      assert.equal((await signOut(aliceSession3.sessionToken, {})).status, 200);
      assert.equal(await db.session.count({ where: { id: aliceSession3.id } }), 0);

      // Posts must be JSON, so a cross-site form can't send sign-in emails
      const formPost = await callRoute(sendEmail, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { email: alice.email },
      });
      assert.equal(formPost.status, 415);
      assert.equal(
        await db.rateLimit.count({ where: { key: { contains: alice.email! } } }),
        0,
        'Rejected before anything is sent',
      );

      // Unexpected errors don't leak their message
      const failing = await callRoute(
        mobileAuthRoute('GET', async () => {
          throw new Error('Unique constraint failed on the fields: (`email`)');
        }),
        {},
      );
      assert.deepEqual([failing.status, failing.body], [500, { error: 'Something went wrong' }]);

      // A bearer token is used exclusively, an invalid one doesn't fall back to the cookie
      const webSession = await createSession(alice.id);
      const appSession = await createSession(bob.id);
      const contextFor = async (headers: Record<string, string>) => {
        const res = { getHeader: () => undefined, setHeader: () => undefined };
        const context = await createTRPCContext({
          req: {
            headers: { 'cf-connecting-ip': ip, ...headers },
            cookies: { 'next-auth.session-token': webSession.sessionToken },
          },
          res,
        } as never);
        return context.session?.user.id ?? null;
      };
      assert.equal(await contextFor({}), alice.id);
      assert.equal(
        await contextFor({ authorization: `Bearer ${appSession.sessionToken}` }),
        bob.id,
      );
      assert.equal(await contextFor({ authorization: 'Bearer not-a-session' }), null);
      assert.equal(await contextFor({ authorization: 'Bearer' }), null);
      assert.equal(await contextFor({ authorization: 'Basic dXNlcjpwYXNz' }), alice.id);
    } finally {
      Object.assign(env, originalEnv);
      authAdapter.getUserByEmail = originalGetUserByEmail;
      await db.verificationToken.deleteMany({
        where: {
          identifier: { in: [alice.email!, email, `new-${email}`] },
        },
      });
      await db.rateLimit.deleteMany({ where: { key: { contains: suffix } } });
      await db.user.deleteMany({
        where: { OR: [{ id: { in: [alice.id, bob.id] } }, { email }] },
      });
      await db.$disconnect();
    }
  },
);
