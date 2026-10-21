import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** Waits for notifications sent after a save to go out. */
const until = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the notification');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const setup = async () => {
  assert.match(new URL(databaseUrl!).pathname, /test/i, 'Refusing to use a non-test database');
  process.env.DATABASE_URL = databaseUrl;
  process.env.SKIP_ENV_VALIDATION = '1';

  const [{ SplitType }, { TRPCError }, { db }, { appRouter }, { expo }, { toFixedNumber }] =
    await Promise.all([
      import('@prisma/client'),
      import('@trpc/server'),
      import('~/server/db'),
      import('~/server/api/root'),
      import('~/server/expoPush'),
      import('~/utils/numbers'),
    ]);

  return { SplitType, TRPCError, db, appRouter, expo, toFixedNumber };
};

void test(
  'native push: tokens are registered per user and get the web notifications',
  { skip: !databaseUrl },
  async () => {
    const { SplitType, TRPCError, db, appRouter, expo, toFixedNumber } = await setup();
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const tokenA = `ExponentPushToken[alice-${suffix}]`;
    const tokenB = `ExponentPushToken[bob-${suffix}]`;
    const tokenC = `ExponentPushToken[spare-${suffix}]`;

    // Records what would go to Expo instead of sending it.
    const sent: ExpoPushMessage[] = [];
    let reply = (messages: ExpoPushMessage[]): ExpoPushTicket[] =>
      messages.map((_, index) => ({ status: 'ok', id: `receipt-${index}` }));
    expo.sendPushNotificationsAsync = async (messages) => {
      sent.push(...messages);
      return reply(messages);
    };

    const [alice, bob] = await Promise.all(
      ['Alice', 'Bob'].map((name) =>
        db.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@example.com`, name } }),
      ),
    );
    assert.ok(alice && bob);
    const group = await db.group.create({
      data: { name: 'Trip', publicId: `trip-${suffix}`, userId: alice.id },
    });
    await db.groupUser.createMany({
      data: [alice, bob].map((user) => ({ groupId: group.id, userId: user.id })),
    });

    const callerFor = (user: typeof alice) =>
      appRouter.createCaller({
        db,
        ip: 'test',
        session: {
          expires: new Date(Date.now() + 60_000).toISOString(),
          user: { id: user.id, name: user.name, email: user.email, currency: 'USD' },
        },
      });
    const ownerOf = async (token: string) =>
      (await db.devicePushToken.findUnique({ where: { token } }))?.userId;
    const isBadRequest = (error: unknown) => {
      assert.ok(error instanceof TRPCError);
      assert.equal(error.code, 'BAD_REQUEST');
      return true;
    };

    try {
      await assert.rejects(
        callerFor(alice).user.registerPushToken({ token: 'not-a-token', platform: 'ios' }),
        isBadRequest,
      );

      // A token moves to whoever registers it last, and only its owner can remove it.
      await callerFor(alice).user.registerPushToken({
        token: tokenA,
        platform: 'ios',
        deviceName: "Alice's iPhone",
      });
      await callerFor(bob).user.registerPushToken({ token: tokenA, platform: 'android' });
      assert.equal(await ownerOf(tokenA), bob.id);
      await callerFor(alice).user.registerPushToken({
        token: tokenA,
        platform: 'ios',
        deviceName: "Alice's iPhone",
      });
      await callerFor(bob).user.unregisterPushToken({ token: tokenA });
      assert.deepEqual(
        await db.devicePushToken.findUnique({
          where: { token: tokenA },
          select: { userId: true, platform: true, deviceName: true },
        }),
        { userId: alice.id, platform: 'ios', deviceName: "Alice's iPhone" },
      );
      await callerFor(bob).user.registerPushToken({ token: tokenB, platform: 'android' });

      // Bob's expense goes to Alice only, with the web notification's text and a link.
      const expense = await callerFor(bob).group.addOrEditExpense({
        groupId: group.id,
        name: 'Lunch',
        category: 'general',
        amount: 10,
        splitType: SplitType.EXACT,
        currency: 'USD',
        paidBy: bob.id,
        participants: [
          { userId: bob.id, amount: 10 },
          { userId: alice.id, amount: -10 },
        ],
      });
      assert.ok(expense);
      await until(() => 0 < sent.length);
      const amount = toFixedNumber(
        (await db.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount,
      );
      assert.deepEqual(sent.splice(0), [
        {
          to: tokenA,
          title: 'Bob',
          body: `Bob paid  USD ${amount} for Lunch`,
          data: { url: `/expenses/${expense.id}` },
          sound: 'default',
        },
      ]);

      // Expo failing doesn't fail the save.
      reply = () => {
        throw new Error('Expo is down');
      };
      await callerFor(bob).group.addOrEditExpense({
        groupId: group.id,
        expenseId: expense.id,
        name: 'Lunch',
        category: 'general',
        amount: 10,
        splitType: SplitType.EXACT,
        currency: 'USD',
        paidBy: bob.id,
        participants: [
          { userId: bob.id, amount: 10 },
          { userId: alice.id, amount: -10 },
        ],
      });
      await until(() => 0 < sent.length);
      assert.deepEqual(
        sent.splice(0).map((message) => [message.to, message.body]),
        [[tokenA, `Updated Lunch USD ${amount}`]],
      );
      assert.equal(await ownerOf(tokenA), alice.id);

      // A device that's gone is forgotten.
      reply = (messages) =>
        messages.map(() => ({
          status: 'error',
          message: 'not a registered push notification recipient',
          details: { error: 'DeviceNotRegistered' },
        }));
      await callerFor(bob).user.deleteExpense({ expenseId: expense.id });
      await until(async () => undefined === (await ownerOf(tokenA)));
      assert.deepEqual(sent.splice(0), [
        {
          to: tokenA,
          title: 'Bob',
          body: 'Deleted Lunch',
          data: { url: `/groups/${group.id}` },
          sound: 'default',
        },
      ]);
      assert.equal(await ownerOf(tokenA), undefined);
      assert.equal(await ownerOf(tokenB), bob.id);

      // Signing out of the app removes its token, deleting the account removes the rest.
      await callerFor(alice).user.registerPushToken({ token: tokenC, platform: 'android' });
      await callerFor(alice).user.unregisterPushToken({ token: tokenC });
      assert.equal(await ownerOf(tokenC), undefined);
      const carol = await db.user.create({ data: { email: `carol-${suffix}@example.com` } });
      await callerFor(carol).user.registerPushToken({ token: tokenC, platform: 'ios' });
      await db.user.delete({ where: { id: carol.id } });
      assert.equal(await ownerOf(tokenC), undefined);
    } finally {
      await db.group.deleteMany({ where: { id: group.id } });
      await db.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
      await db.$disconnect();
    }
  },
);

void test(
  'native push: a late DeviceNotRegistered receipt keeps a token registered again since',
  { skip: !databaseUrl },
  async () => {
    const { db, expo } = await setup();
    const { checkReceipts } = await import('~/server/expoPush');
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const [goneToken, backToken] = [
      `ExponentPushToken[gone-${suffix}]`,
      `ExponentPushToken[back-${suffix}]`,
    ];
    const user = await db.user.create({ data: { email: `receipts-${suffix}@example.com` } });

    expo.getPushNotificationReceiptsAsync = async (ids) =>
      Object.fromEntries(
        ids.map((id) => [
          id,
          {
            status: 'error',
            message: 'not a registered push notification recipient',
            details: { error: 'DeviceNotRegistered' },
          },
        ]),
      );

    try {
      await db.devicePushToken.createMany({
        data: [goneToken, backToken].map((token) => ({ userId: user.id, token, platform: 'ios' })),
      });
      const sentAt = new Date();
      await new Promise((resolve) => setTimeout(resolve, 10));
      // The app registered this token again after the notification went out
      await db.devicePushToken.update({
        where: { token: backToken },
        data: { deviceName: 'Reinstalled' },
      });

      await checkReceipts(
        [
          { id: 'receipt-gone', token: goneToken },
          { id: 'receipt-back', token: backToken },
        ],
        sentAt,
      );

      assert.equal(await db.devicePushToken.count({ where: { token: goneToken } }), 0);
      assert.equal(await db.devicePushToken.count({ where: { token: backToken } }), 1);
    } finally {
      await db.user.deleteMany({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);

void test(
  'native push: a token goes with the app session that registered it',
  { skip: !databaseUrl },
  async () => {
    const { db, appRouter } = await setup();
    const [{ getDevicePushTokens }, { createTRPCContext }] = await Promise.all([
      import('~/server/expoPush'),
      import('~/server/api/trpc'),
    ]);
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const revokedToken = `ExponentPushToken[revoked-${suffix}]`;
    const expiredToken = `ExponentPushToken[expired-${suffix}]`;
    const webToken = `ExponentPushToken[web-${suffix}]`;
    const user = await db.user.create({ data: { email: `sessions-${suffix}@example.com` } });
    const createSession = () =>
      db.session.create({
        data: {
          sessionToken: `session-${suffix}-${Math.random()}`,
          userId: user.id,
          expires: new Date(Date.now() + 60_000),
        },
      });
    const contextFor = (sessionToken: string) =>
      createTRPCContext({
        req: {
          headers: { authorization: `Bearer ${sessionToken}`, 'cf-connecting-ip': 'test' },
          cookies: {},
        },
        res: { getHeader: () => undefined, setHeader: () => undefined },
      } as never);
    const register = async (sessionToken: string, token: string) =>
      appRouter
        .createCaller(await contextFor(sessionToken))
        .user.registerPushToken({ token, platform: 'ios' });
    const sessionOf = async (token: string) =>
      (await db.devicePushToken.findUnique({ where: { token }, select: { sessionId: true } }))
        ?.sessionId;

    try {
      // Revoking the session, e.g. from another device, removes the token it registered
      const revoked = await createSession();
      await register(revoked.sessionToken, revokedToken);
      assert.equal(await sessionOf(revokedToken), revoked.id);
      await db.session.delete({ where: { id: revoked.id } });
      assert.equal(await sessionOf(revokedToken), undefined);

      // An expired session's token is skipped and forgotten, a token without a session is kept
      const expired = await createSession();
      await register(expired.sessionToken, expiredToken);
      await db.devicePushToken.create({
        data: { userId: user.id, token: webToken, platform: 'android' },
      });
      await db.session.update({
        where: { id: expired.id },
        data: { expires: new Date(Date.now() - 1000) },
      });
      assert.deepEqual(await getDevicePushTokens([user.id]), [webToken]);
      assert.equal(await sessionOf(expiredToken), undefined);
      assert.equal(await sessionOf(webToken), null);

      // The app using an expired session deletes it, and the token with it
      const lapsed = await createSession();
      await register(lapsed.sessionToken, expiredToken);
      await db.session.update({
        where: { id: lapsed.id },
        data: { expires: new Date(Date.now() - 1000) },
      });
      assert.equal((await contextFor(lapsed.sessionToken)).session, null);
      assert.equal(await sessionOf(expiredToken), undefined);
    } finally {
      await db.user.deleteMany({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
