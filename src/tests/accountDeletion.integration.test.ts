import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { UnsecuredJWT } from 'jose';
import { type AdapterAccount } from 'next-auth/adapters';

const databaseUrl = process.env.TEST_DATABASE_URL;

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to clean a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';
  process.env.NEXTAUTH_SECRET ??= 'account-deletion-test-secret';
  process.env.NEXTAUTH_URL ??= 'http://localhost:3000';

  const [
    { SplitType },
    { db },
    { env },
    { DeletedAccountError, authAdapter, authOptions, generateEmailToken },
    mobileAuth,
    { generateOpaqueToken, hashVerificationToken },
    { appRouter },
    accountDeletion,
    { resetRateLimit },
  ] = await Promise.all([
    import('@prisma/client'),
    import('~/server/db'),
    import('~/env'),
    import('~/server/auth'),
    import('~/server/mobileAuth'),
    import('~/server/mobileAuthTokens'),
    import('~/server/api/root'),
    import('~/server/api/services/accountDeletion'),
    import('~/server/rateLimit'),
  ]);
  const secret = process.env.NEXTAUTH_SECRET;
  // Read when used, so the test can switch settings. Codes are logged instead of emailed.
  const mutableEnv = env as { -readonly [Key in keyof typeof env]: (typeof env)[Key] };
  mutableEnv.NODE_ENV = 'development';

  const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const emailOf = (name: string) => `${name.toLowerCase()}-${suffix}@example.com`;
  const createUser = (name: string) =>
    db.user.create({ data: { email: emailOf(name), name, currency: 'USD' } });

  const callerFor = (user: { id: number; name: string | null; email: string | null }) =>
    appRouter.createCaller({
      db,
      ip: 'test',
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
      },
    });

  /** Signs in like the app does with an email code, returning the bearer session. */
  const signInWithEmail = async (email: string) => {
    const code = generateEmailToken();
    await authAdapter.createVerificationToken!({
      identifier: email,
      token: hashVerificationToken(code, secret),
      expires: new Date(Date.now() + 60_000),
    });
    return mobileAuth.verifyEmailCode(email, code, `test-${suffix}`);
  };

  /** Requests a deletion code and reads it from the development log. */
  const requestCode = async (user: { id: number; name: string | null; email: string | null }) => {
    await resetRateLimit(accountDeletion.ACCOUNT_DELETION_LIMITS.sendCooldown, String(user.id));
    const logged: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logged.push(args);
    try {
      await callerFor(user).user.requestDeleteAccountCode();
    } finally {
      console.log = original;
    }
    const line = logged.find((args) => 'Account deletion code : ' === args[0]);
    assert.ok(line, 'The code is logged in development');
    assert.equal(line[1], user.email);
    return String(line[2]);
  };

  return {
    SplitType,
    db,
    env: mutableEnv,
    secret,
    ...mobileAuth,
    ...accountDeletion,
    hashVerificationToken,
    generateEmailToken,
    generateOpaqueToken,
    DeletedAccountError,
    authAdapter,
    authOptions,
    resetRateLimit,
    emailOf,
    createUser,
    callerFor,
    signInWithEmail,
    requestCode,
  };
};

const withCode = (code: string) => (error: unknown) => {
  assert.equal((error as { code?: string }).code, code, String(error));
  return true;
};

/** Stands in for Apple's token endpoints, returning an id token for `sub`. */
const appleFetch = (sub: string, onExchange?: () => Promise<void>) => {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url.endsWith('/auth/token')) {
      await onExchange?.();
      return new Response(
        JSON.stringify({ refresh_token: 'refresh', id_token: new UnsecuredJWT({ sub }).encode() }),
      );
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
};

const configureApple = (env: Record<string, unknown>) => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  env.APPLE_BUNDLE_ID = 'app.splitpro.test';
  env.APPLE_TEAM_ID = 'TEAM123456';
  env.APPLE_KEY_ID = 'KEY1234567';
  env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
};

void test(
  'account deletion: the emailed code is single use, expires and is limited',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const eve = await t.createUser('Eve');
    const userIds = [eve.id];
    const originalFetch = globalThis.fetch;

    try {
      const caller = t.callerFor(eve);
      const deleteWith = (code: string) => caller.user.deleteAccount({ code });
      const identifier = t.deleteCodeIdentifier(eve.id);

      // No code asked for yet
      await assert.rejects(deleteWith('ABC234'), withCode('BAD_REQUEST'));

      // A wrong code fails, and the right one is still there afterwards
      let code = await t.requestCode(eve);
      assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
      await assert.rejects(deleteWith(code === 'ABC234' ? 'ABC235' : 'ABC234'), (error) => {
        assert.equal((error as Error).message, t.INVALID_DELETE_CODE_MESSAGE);
        return true;
      });
      assert.equal(await t.db.verificationToken.count({ where: { identifier } }), 1);

      // A second request inside the cooldown is refused with how long to wait
      await assert.rejects(caller.user.requestDeleteAccountCode(), (error) => {
        withCode('TOO_MANY_REQUESTS')(error);
        assert.ok(
          0 <
            Number(
              (error as Error & { cause: { retryAfterSeconds: number } }).cause.retryAfterSeconds,
            ),
        );
        return true;
      });

      // An expired code fails
      await t.db.verificationToken.updateMany({
        where: { identifier },
        data: { expires: new Date(Date.now() - 1000) },
      });
      await assert.rejects(deleteWith(code), withCode('BAD_REQUEST'));

      // Five wrong guesses burn the code: even the right one is refused after
      code = await t.requestCode(eve);
      assert.equal(await t.db.verificationToken.count({ where: { identifier } }), 1);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await assert.rejects(deleteWith('WRONG2'), withCode('BAD_REQUEST'));
      }
      await assert.rejects(deleteWith(code), withCode('TOO_MANY_REQUESTS'));
      assert.equal(await t.db.verificationToken.count({ where: { identifier } }), 0);

      // A new code gets a fresh set of attempts
      code = await t.requestCode(eve);

      // A sign-in code for the same email can't delete the account
      const signInCode = t.generateEmailToken();
      await t.db.verificationToken.create({
        data: {
          identifier: eve.email!,
          token: t.hashVerificationToken(signInCode, t.secret),
          expires: new Date(Date.now() + 60_000),
        },
      });
      await assert.rejects(deleteWith(signInCode), withCode('BAD_REQUEST'));

      // And the deletion code can't sign in
      await assert.rejects(t.verifyEmailCode(eve.email!, code, `test-${eve.id}`), (error) => {
        assert.equal((error as { status?: number }).status, 400);
        return true;
      });
      assert.equal(await t.db.verificationToken.count({ where: { identifier } }), 1);

      // An Apple link with Apple failing doesn't stop the deletion
      await t.db.account.create({
        data: {
          userId: eve.id,
          type: 'oauth',
          provider: 'apple',
          providerAccountId: `eve-${eve.id}`,
        },
      });
      configureApple(t.env);
      globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
      const originalError = console.error;
      console.error = () => undefined;
      try {
        // Lowercase and spaces are fine, as typed
        await caller.user.deleteAccount({
          code: ` ${code.toLowerCase()} `,
          appleAuthorizationCode: 'apple-code',
        });
      } finally {
        console.error = originalError;
      }

      const deleted = await t.db.user.findUniqueOrThrow({ where: { id: eve.id } });
      assert.ok(deleted.deletedAt);
      assert.equal(deleted.email, null);

      // Single use: the same code doesn't work again
      await assert.rejects(deleteWith(code), withCode('BAD_REQUEST'));
      assert.equal(await t.db.verificationToken.count({ where: { identifier } }), 0);
    } finally {
      globalThis.fetch = originalFetch;
      await t.db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  },
);

void test(
  'account deletion: anonymises the account and leaves what others share',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const [alice, bob, carol] = [
      await t.createUser('Alice'),
      await t.createUser('Bob'),
      await t.createUser('Carol'),
    ];
    const userIds = [alice.id, bob.id, carol.id];
    const groupIds: number[] = [];
    const originalFetch = globalThis.fetch;

    const createGroup = async (name: string, ownerId: number, memberIds: number[]) => {
      const group = await t.db.group.create({
        data: { name, publicId: `${name.toLowerCase()}-${alice.id}`, userId: ownerId },
      });
      await t.db.groupUser.createMany({
        data: memberIds.map((userId) => ({ groupId: group.id, userId })),
      });
      groupIds.push(group.id);
      return group;
    };

    /** An expense with its balances, as the split service would record it. */
    const addExpense = async (
      groupId: number | null,
      currency: string,
      paidBy: number,
      amount: number,
      shares: [number, number][],
    ) => {
      await t.db.expense.create({
        data: {
          groupId,
          currency,
          paidBy,
          addedBy: paidBy,
          name: 'Dinner',
          category: 'food',
          amount,
          splitType: t.SplitType.EXACT,
          expenseParticipants: {
            create: shares.map(([userId, share]) => ({ userId, amount: share })),
          },
        },
      });
      const owed = shares.filter(([userId]) => userId !== paidBy);
      await t.db.balance.createMany({
        data: owed.flatMap(([userId, share]) => [
          { userId, friendId: paidBy, currency, amount: share },
          { userId: paidBy, friendId: userId, currency, amount: -share },
        ]),
      });
      if (null !== groupId) {
        await t.db.groupBalance.createMany({
          data: owed.flatMap(([userId, share]) => [
            { groupId, userId, firendId: paidBy, currency, amount: share },
            { groupId, userId: paidBy, firendId: userId, currency, amount: -share },
          ]),
        });
      }
    };

    const balancesOf = async (userId: number) => {
      const [balances, groupBalances] = await Promise.all([
        t.db.balance.findMany({
          where: { OR: [{ userId }, { friendId: userId }] },
          orderBy: [{ userId: 'asc' }, { friendId: 'asc' }, { currency: 'asc' }],
          select: { userId: true, friendId: true, currency: true, amount: true },
        }),
        t.db.groupBalance.findMany({
          where: { OR: [{ userId }, { firendId: userId }] },
          orderBy: [{ groupId: 'asc' }, { userId: 'asc' }, { firendId: 'asc' }],
          select: { groupId: true, userId: true, firendId: true, currency: true, amount: true },
        }),
      ]);
      return { balances, groupBalances };
    };

    try {
      // Alice owes Bob in a trip she set up with Bob and Carol, and Bob owes her directly
      const trip = await createGroup('Trip', alice.id, [alice.id, bob.id, carol.id]);
      const solo = await createGroup('Solo', alice.id, [alice.id]);
      const book = await createGroup('Book', carol.id, [alice.id, carol.id]);
      // Written directly rather than through the balance transactions, which would only add
      // serialization conflicts with the other tests sharing the database
      await addExpense(trip.id, 'USD', bob.id, 3000, [
        [bob.id, 2000],
        [alice.id, -1000],
        [carol.id, -1000],
      ]);
      await addExpense(null, 'EUR', alice.id, 5000, [
        [alice.id, 2500],
        [bob.id, -2500],
      ]);
      await t.db.friendship.createMany({
        data: [
          { userId: alice.id, friendId: bob.id },
          { userId: bob.id, friendId: alice.id },
        ],
      });

      // She uses the app: a bearer session, a push token, Google and Apple sign-ins
      const appSession = await t.signInWithEmail(alice.email!);
      const session = await t.db.session.findUniqueOrThrow({
        where: { sessionToken: appSession.token },
      });
      await t.db.devicePushToken.create({
        data: {
          userId: alice.id,
          token: `ExponentPushToken[alice-${alice.id}]`,
          platform: 'ios',
          sessionId: session.id,
        },
      });
      await t.db.pushNotification.create({ data: { userId: alice.id, subscription: '{}' } });
      const appleSub = `alice-apple-${alice.id}`;
      await t.db.account.createMany({
        data: [
          {
            userId: alice.id,
            type: 'oauth',
            provider: 'google',
            providerAccountId: `g-${alice.id}`,
          },
          { userId: alice.id, type: 'oauth', provider: 'apple', providerAccountId: appleSub },
        ],
      });

      const info = await t.callerFor(alice).user.getDeleteAccountInfo();
      assert.equal(info.email, alice.email);
      assert.equal(info.hasAppleAccount, true);
      assert.deepEqual(
        [...info.balances].sort((a, b) => a.currency.localeCompare(b.currency)),
        [
          { currency: 'EUR', amount: 2500 },
          { currency: 'USD', amount: -1000 },
        ],
      );
      assert.deepEqual(info.groups, [
        { id: trip.id, name: 'Trip', nextOwnerName: 'Bob', willBeDeleted: false },
        { id: solo.id, name: 'Solo', nextOwnerName: null, willBeDeleted: true },
      ]);

      const bobBefore = await balancesOf(bob.id);
      const carolBefore = await balancesOf(carol.id);

      // Apple is asked to revoke while her Apple account is still linked
      configureApple(t.env);
      let linkedAtExchange = -1;
      const apple = appleFetch(appleSub, async () => {
        linkedAtExchange = await t.db.account.count({
          where: { userId: alice.id, provider: 'apple' },
        });
      });
      globalThis.fetch = apple.fetchFn;

      const code = await t.requestCode(alice);
      await t.callerFor(alice).user.deleteAccount({ code, appleAuthorizationCode: 'apple-code' });
      globalThis.fetch = originalFetch;

      assert.deepEqual(apple.calls, [
        'https://appleid.apple.com/auth/token',
        'https://appleid.apple.com/auth/revoke',
      ]);
      assert.equal(linkedAtExchange, 1);

      // Anonymised, signed out everywhere, nothing to sign in with
      const deleted = await t.db.user.findUniqueOrThrow({ where: { id: alice.id } });
      assert.equal(deleted.name, t.DELETED_USER_NAME);
      assert.equal(deleted.email, null);
      assert.equal(deleted.emailVerified, null);
      assert.equal(deleted.image, null);
      assert.ok(deleted.deletedAt);
      assert.equal(await t.getMobileSession(appSession.token), null);
      const [sessions, accounts, pushTokens, webPush, friendships, tokens] = await Promise.all([
        t.db.session.count({ where: { userId: alice.id } }),
        t.db.account.count({ where: { userId: alice.id } }),
        t.db.devicePushToken.count({ where: { userId: alice.id } }),
        t.db.pushNotification.count({ where: { userId: alice.id } }),
        t.db.friendship.count({ where: { OR: [{ userId: alice.id }, { friendId: alice.id }] } }),
        t.db.verificationToken.count({ where: { identifier: alice.email! } }),
      ]);
      assert.deepEqual(
        [sessions, accounts, pushTokens, webPush, friendships, tokens],
        [0, 0, 0, 0, 0, 0],
      );

      // Her friends' balances, and the expenses behind them, are untouched
      assert.deepEqual(await balancesOf(bob.id), bobBefore);
      assert.deepEqual(await balancesOf(carol.id), carolBefore);
      assert.equal(await t.db.expense.count({ where: { paidBy: { in: [alice.id, bob.id] } } }), 2);

      // The trip passes to Bob and she stays in it until settled; the empty group goes; she
      // leaves Carol's group, where she owes nothing
      const groups = await t.db.group.findMany({
        where: { id: { in: groupIds } },
        include: { groupUsers: { select: { userId: true } } },
      });
      const tripAfter = groups.find((g) => g.id === trip.id);
      assert.equal(tripAfter?.userId, bob.id);
      assert.ok(tripAfter?.groupUsers.some((member) => member.userId === alice.id));
      assert.equal(
        groups.some((g) => g.id === solo.id),
        false,
      );
      assert.deepEqual(
        groups.find((g) => g.id === book.id)?.groupUsers.map((member) => member.userId),
        [carol.id],
      );

      // Bob still sees her balance, under the anonymous name
      const bobFriends = await t.callerFor(bob).user.getBalances();
      const shown = bobFriends.balances.find((balance) => balance.friendId === alice.id);
      assert.equal(shown?.friend.name, t.DELETED_USER_NAME);
      assert.equal(shown?.friend.email, null);

      // But can't pick her for anything new
      const bobPicks = await t.callerFor(bob).user.getFriends();
      assert.equal(
        bobPicks.some((friend) => friend.id === alice.id),
        false,
      );
      await assert.rejects(
        t.callerFor(carol).group.addMembers({ groupId: book.id, userIds: [alice.id] }),
        withCode('BAD_REQUEST'),
      );

      // The same email signs up again as a new, empty account
      const again = await t.signInWithEmail(alice.email!);
      userIds.push(again.user.id);
      assert.notEqual(again.user.id, alice.id);
      const fresh = await t
        .callerFor({ id: again.user.id, name: null, email: again.user.email ?? null })
        .user.getDeleteAccountInfo();
      assert.deepEqual(fresh.balances, []);
      assert.deepEqual(fresh.groups, []);
      assert.equal(fresh.hasAppleAccount, false);
    } finally {
      globalThis.fetch = originalFetch;
      await t.db.group.deleteMany({ where: { id: { in: groupIds } } });
      await t.db.user.deleteMany({ where: { id: { in: userIds } } });
      await t.db.$disconnect();
    }
  },
);

void test(
  'account deletion: a deleted account gets no session, whenever the sign-in started',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const frank = await t.createUser('Frank');
    const userIds = [frank.id];
    const { events } = t.authOptions;
    const isDeletedAccount = (error: unknown) => {
      assert.ok(error instanceof t.DeletedAccountError, String(error));
      return true;
    };

    try {
      // The deletion commits after the sign-in found the account, before it creates the session
      const code = await t.requestCode(frank);
      t.authOptions.events = {
        ...events,
        signIn: async () => {
          await t.callerFor(frank).user.deleteAccount({ code });
        },
      };
      await assert.rejects(t.signInWithEmail(frank.email!), isDeletedAccount);
      t.authOptions.events = events;
      assert.ok((await t.db.user.findUniqueOrThrow({ where: { id: frank.id } })).deletedAt);
      assert.equal(await t.db.session.count({ where: { userId: frank.id } }), 0);

      // Which the app's sign-in routes answer as a 401
      const response = { status: 0, body: undefined as unknown };
      const res = {
        setHeader: () => res,
        status: (status: number) => {
          response.status = status;
          return res;
        },
        json: (body: unknown) => {
          response.body = body;
          return res;
        },
      };
      await t.mobileAuthRoute('GET', () => Promise.reject(new t.DeletedAccountError()))(
        { method: 'GET', headers: {} } as never,
        res as never,
      );
      assert.deepEqual(response, { status: 401, body: { error: 'This account has been deleted' } });

      // Google and Apple sign-ins found it the same way: they can't link to it or sign in to it
      const sessionToken = t.generateOpaqueToken();
      await assert.rejects(
        Promise.resolve(
          t.authAdapter.createSession!({
            sessionToken,
            userId: String(frank.id),
            expires: new Date(Date.now() + 60_000),
          }),
        ),
        isDeletedAccount,
      );
      const google = {
        userId: String(frank.id),
        type: 'oauth' as const,
        provider: 'google',
        providerAccountId: `g-${frank.id}`,
      };
      // Typed via next-auth's optional @auth/core peer, which resolves to `any` without it
      const linkAccount = t.authAdapter.linkAccount as (
        account: AdapterAccount,
      ) => Promise<unknown>;
      await assert.rejects(linkAccount(google), isDeletedAccount);
      await assert.rejects(
        Promise.resolve(
          t.authAdapter.updateUser!({ id: String(frank.id), emailVerified: new Date() }),
        ),
        isDeletedAccount,
      );
      assert.equal(await t.db.account.count({ where: { userId: frank.id } }), 0);

      // Nor is it found by a sign-in method or session somehow left behind, which are removed
      await t.db.account.create({ data: { ...google, userId: frank.id } });
      assert.equal(
        await t.authAdapter.getUserByAccount!({
          provider: 'google',
          providerAccountId: `g-${frank.id}`,
        }),
        null,
      );
      assert.equal(await t.authAdapter.getUser!(frank.id as unknown as string), null);
      const [appSession, webSession] = await Promise.all(
        [0, 1].map(() =>
          t.db.session.create({
            data: {
              sessionToken: t.generateOpaqueToken(),
              userId: frank.id,
              expires: new Date(Date.now() + 60_000),
            },
          }),
        ),
      );
      assert.equal(await t.getMobileSession(appSession!.sessionToken), null);
      assert.equal(await t.authAdapter.getSessionAndUser!(webSession!.sessionToken), null);
      assert.equal(await t.db.session.count({ where: { userId: frank.id } }), 0);
    } finally {
      t.authOptions.events = events;
      await t.db.user.deleteMany({ where: { id: { in: userIds } } });
      await t.db.$disconnect();
    }
  },
);

/** Waits until some transaction is waiting for a row lock. */
const waitForLockWait = async (db: {
  $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
}) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = (await db.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`) as Array<{
      waiting: number;
    }>;
    if (0 < (row?.waiting ?? 0)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Nothing waited for a lock');
};

void test(
  'account deletion: a group never passes to a member deleted at the same time',
  { skip: !databaseUrl },
  async () => {
    const t = await setup();
    const [alice, bob, carol] = [
      await t.createUser('Alice'),
      await t.createUser('Bob'),
      await t.createUser('Carol'),
    ];
    const userIds = [alice.id, bob.id, carol.id];
    const groupIds: number[] = [];

    const createGroup = async (name: string, ownerId: number, memberIds: number[]) => {
      const group = await t.db.group.create({
        data: { name, publicId: `${name.toLowerCase()}-race-${alice.id}`, userId: ownerId },
      });
      await t.db.groupUser.createMany({
        data: memberIds.map((userId) => ({ groupId: group.id, userId })),
      });
      groupIds.push(group.id);
      return group;
    };
    const ownerOf = async (groupId: number) =>
      (await t.db.group.findUnique({ where: { id: groupId } }))?.userId ?? null;

    try {
      // Bob, next in line for Alice's trip, is being deleted while Alice deletes her account
      const trip = await createGroup('Trip', alice.id, [alice.id, bob.id, carol.id]);
      const code = await t.requestCode(alice);
      let release = () => undefined as void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let bobLocked = () => undefined as void;
      const isBobLocked = new Promise<void>((resolve) => {
        bobLocked = resolve;
      });
      const deletingBob = t.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${bob.id} FOR UPDATE`;
          bobLocked();
          await released;
          await tx.user.update({ where: { id: bob.id }, data: { deletedAt: new Date() } });
        },
        { timeout: 20_000 },
      );
      await isBobLocked;
      const deletingAlice = t.callerFor(alice).user.deleteAccount({ code });
      await waitForLockWait(t.db);
      release();
      await deletingBob;
      await deletingAlice;

      // It goes to Carol, who is still around
      assert.equal(await ownerOf(trip.id), carol.id);

      // Two members whose groups would pass to each other, deleting at once, don't deadlock
      const [dave, erin] = [await t.createUser('Dave'), await t.createUser('Erin')];
      userIds.push(dave.id, erin.id);
      const daves = await createGroup('Daves', dave.id, [dave.id, erin.id, carol.id]);
      const erins = await createGroup('Erins', erin.id, [erin.id, dave.id]);
      const [daveCode, erinCode] = [await t.requestCode(dave), await t.requestCode(erin)];
      await Promise.all([
        t.callerFor(dave).user.deleteAccount({ code: daveCode }),
        t.callerFor(erin).user.deleteAccount({ code: erinCode }),
      ]);
      assert.equal(await ownerOf(daves.id), carol.id);
      // Erin's group had nobody left and nothing to settle
      assert.equal(await ownerOf(erins.id), null);
    } finally {
      await t.db.group.deleteMany({ where: { id: { in: groupIds } } });
      await t.db.user.deleteMany({ where: { id: { in: userIds } } });
      await t.db.$disconnect();
    }
  },
);
