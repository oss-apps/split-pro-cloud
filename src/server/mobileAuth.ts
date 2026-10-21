import { type User as DbUser, Prisma } from '@prisma/client';
import { JOSEError } from 'jose/errors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type NextApiRequest, type NextApiResponse } from 'next';
import { type Account, type Session } from 'next-auth';
import { type Adapter, type AdapterAccount, type AdapterUser } from 'next-auth/adapters';
import { z } from 'zod';

import { env } from '~/env';
import {
  EMAIL_AUTH_LIMITS,
  EMAIL_TOKEN_MAX_AGE_SECONDS,
  assertEmailSignInAllowed,
  authAdapter,
  authOptions,
  buildSession,
  deleteVerificationTokens,
  generateEmailToken,
  normalizeEmailIdentifier,
} from '~/server/auth';
import { db } from '~/server/db';
import { sendSignUpEmail } from '~/server/mailer';
import { type RateLimitRule, consumeRateLimits } from '~/server/rateLimit';

import {
  type AppleFullName,
  HANDOFF_IDENTIFIER_PREFIX,
  VERIFIER_PATTERN,
  formatAppleFullName,
  generateOpaqueToken,
  handoffIdentifier,
  handoffUserId,
  hashVerificationToken,
  isJsonContentType,
  isValidChallenge,
  isValidHandoffCode,
  parseAppleAudiences,
  parseMobileRedirect,
  pkceChallenge,
  readChallengeCookie,
  signChallengeCookie,
} from './mobileAuthTokens';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Deliberately longer than the web's 30 days: like other apps, the app stays signed in while it's
// used, with the expiry sliding forward on use below.
export const MOBILE_SESSION_MAX_AGE_SECONDS = 180 * DAY;
// Like next-auth's updateAge: extend an active session at most once a day
const MOBILE_SESSION_UPDATE_AGE_SECONDS = DAY;
const HANDOFF_CODE_MAX_AGE_SECONDS = 5 * MINUTE;
// next-auth's default, which the web uses
const WEB_SESSION_MAX_AGE_SECONDS = authOptions.session?.maxAge ?? 30 * DAY;

const isDevelopment = () => 'development' === env.NODE_ENV;
const handoffIdentifierFilter = { startsWith: `${HANDOFF_IDENTIFIER_PREFIX}:` };

export const MOBILE_AUTH_LIMITS = {
  exchangePerIpHour: { name: 'mobile-exchange:ip:1h', limit: 30, windowSeconds: HOUR },
  applePerIpHour: { name: 'mobile-apple:ip:1h', limit: 30, windowSeconds: HOUR },
} satisfies Record<string, RateLimitRule>;

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// The Prisma adapter is typed with string ids, ours are numbers. createUser and linkAccount are
// typed via next-auth's optional @auth/core peer, which resolves to `any` without it.
const adapter = authAdapter as Omit<Required<Adapter>, 'createUser' | 'linkAccount'> & {
  createUser: (
    user: Pick<DbUser, 'email' | 'name' | 'emailVerified' | 'image'>,
  ) => Promise<AdapterUser>;
  linkAccount: (account: AdapterAccount) => Promise<unknown>;
};
const toDbUser = (user: AdapterUser | null) => user as unknown as DbUser | null;
const adapterUserId = (userId: number) => userId as unknown as string;

export class MobileAuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export type MobileSignInResult = {
  token: string;
  user: Session['user'];
};

const fromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);

const getAuthSecret = () => {
  const secret = authOptions.secret ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new MobileAuthError(503, 'Sign-in is not configured');
  }
  return secret;
};

const rateLimitedError = (retryAfterSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new MobileAuthError(
    429,
    `Too many attempts. Try again in ${minutes} minute${1 === minutes ? '' : 's'}.`,
    retryAfterSeconds,
  );
};

const assertRateLimits = async (checks: [RateLimitRule, string][]) => {
  const result = await consumeRateLimits(checks);
  if (!result.allowed) {
    throw rateLimitedError(result.retryAfterSeconds);
  }
};

const tryNormalizeEmail = (email: string) => {
  try {
    return normalizeEmailIdentifier(email);
  } catch {
    return null;
  }
};

/**
 * Signs up a user, or returns the one a concurrent sign-in with the same email just created.
 */
const createUser = async (
  user: Pick<DbUser, 'email' | 'name' | 'emailVerified' | 'image'> & { email: string },
) => {
  // The adapter refuses new users on invite only instances too, checked here for a clean 403
  if (env.INVITE_ONLY) {
    throw new MobileAuthError(403, 'This instance is Invite Only');
  }

  try {
    const created = toDbUser(await adapter.createUser(user))!;
    await authOptions.events?.createUser?.({ user: created });
    return { user: created, isNewUser: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || 'P2002' !== error.code) {
      throw error;
    }

    const existingUser = await db.user.findUnique({ where: { email: user.email } });
    if (!existingUser) {
      throw error;
    }
    return { user: existingUser, isNewUser: false };
  }
};

const toSession = (user: DbUser, expires: Date) =>
  buildSession(
    {
      user: { name: user.name, email: user.email, image: user.image },
      expires: expires.toISOString(),
    },
    user,
  );

/**
 * Native app sessions are ordinary Session rows, sent as a bearer token instead of a cookie.
 */
const createMobileSession = async (userId: number): Promise<MobileSignInResult> => {
  const sessionToken = generateOpaqueToken();
  const expires = fromNow(MOBILE_SESSION_MAX_AGE_SECONDS);

  await adapter.createSession({ sessionToken, userId: adapterUserId(userId), expires });
  // Reloaded so changes from the createUser event (the default name) are included
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  return { token: sessionToken, user: toSession(user, expires).user };
};

const completeSignIn = async (user: DbUser, account: Account, isNewUser: boolean) => {
  await authOptions.events?.signIn?.({ user, account, isNewUser });
  return createMobileSession(user.id);
};

/**
 * The app session for a bearer token, with the id of its Session row (push tokens are linked to
 * it). An expired session is deleted, which also removes the push tokens it registered.
 */
export const findMobileSession = async (
  sessionToken: string | null,
): Promise<{ id: string; session: Session } | null> => {
  if (!sessionToken) {
    return null;
  }

  const session = await db.session.findUnique({ where: { sessionToken }, include: { user: true } });

  if (!session) {
    return null;
  }

  if (session.expires.getTime() < Date.now()) {
    await db.session.deleteMany({ where: { sessionToken } });
    return null;
  }

  const updateDueAt =
    session.expires.getTime() -
    MOBILE_SESSION_MAX_AGE_SECONDS * 1000 +
    MOBILE_SESSION_UPDATE_AGE_SECONDS * 1000;

  if (updateDueAt > Date.now()) {
    return { id: session.id, session: toSession(session.user, session.expires) };
  }

  const expires = fromNow(MOBILE_SESSION_MAX_AGE_SECONDS);
  await db.session.update({ where: { sessionToken }, data: { expires } });
  return { id: session.id, session: toSession(session.user, expires) };
};

export const getMobileSession = async (sessionToken: string | null) =>
  (await findMobileSession(sessionToken))?.session ?? null;

/**
 * Ends the app session, and stops notifications to the device if the app sends its push token.
 */
export const deleteMobileSession = async (sessionToken: string, pushToken?: string) => {
  const session = pushToken
    ? await db.session.findUnique({ where: { sessionToken }, select: { userId: true } })
    : null;

  await db.$transaction([
    ...(session && pushToken
      ? [db.devicePushToken.deleteMany({ where: { token: pushToken, userId: session.userId } })]
      : []),
    db.session.deleteMany({ where: { sessionToken } }),
  ]);
};

/**
 * Sends the same sign-in code as the web email provider, stored the way next-auth stores it.
 */
export const sendEmailCode = async (rawEmail: string, ip: string) => {
  const email = tryNormalizeEmail(rawEmail);

  if (!email) {
    await assertRateLimits([
      [EMAIL_AUTH_LIMITS.sendPerIpHour, ip],
      [EMAIL_AUTH_LIMITS.sendPerIpDay, ip],
    ]);
    throw new MobileAuthError(400, 'Invalid email address');
  }

  await assertRateLimits([
    [EMAIL_AUTH_LIMITS.sendPerEmail15m, email],
    [EMAIL_AUTH_LIMITS.sendPerEmailDay, email],
    [EMAIL_AUTH_LIMITS.sendPerIpHour, ip],
    [EMAIL_AUTH_LIMITS.sendPerIpDay, ip],
  ]);

  try {
    await assertEmailSignInAllowed(email);
  } catch (error) {
    throw new MobileAuthError(
      403,
      error instanceof Error ? error.message : 'Sign up is not allowed',
    );
  }

  const token = generateEmailToken();
  await adapter.createVerificationToken({
    identifier: email,
    token: hashVerificationToken(token, getAuthSecret()),
    expires: fromNow(EMAIL_TOKEN_MAX_AGE_SECONDS),
  });

  // The same link the web sends, so it still works when opened in a browser
  const url = new URL('/api/auth/callback/email', env.NEXTAUTH_URL);
  url.searchParams.set('callbackUrl', new URL('/balances', env.NEXTAUTH_URL).toString());
  url.searchParams.set('token', token);
  url.searchParams.set('email', email);

  if (!(await sendSignUpEmail(email, token, url.toString()))) {
    throw new MobileAuthError(502, 'Failed to send email');
  }
};

/**
 * Mirrors next-auth's email callback: consume the code, then sign in or sign up.
 */
export const verifyEmailCode = async (rawEmail: string, rawCode: string, ip: string) => {
  const email = tryNormalizeEmail(rawEmail);

  if (!email) {
    throw new MobileAuthError(400, 'Invalid email address');
  }

  // Shares its counters with the web callback, so guesses can't be split across both
  const ipResult = await consumeRateLimits([[EMAIL_AUTH_LIMITS.verifyPerIpHour, ip]]);
  const emailResult = await consumeRateLimits([[EMAIL_AUTH_LIMITS.verifyPerEmail, email]]);

  if (!emailResult.allowed) {
    // Too many guesses for this code: burn it, a new code has to be requested
    await deleteVerificationTokens(email);
    throw rateLimitedError(emailResult.retryAfterSeconds);
  }

  if (!ipResult.allowed) {
    throw rateLimitedError(ipResult.retryAfterSeconds);
  }

  const verificationToken = await adapter.useVerificationToken({
    identifier: email,
    token: hashVerificationToken(rawCode.trim().toUpperCase(), getAuthSecret()),
  });

  if (!verificationToken || verificationToken.expires.getTime() < Date.now()) {
    throw new MobileAuthError(400, 'Invalid or expired code');
  }

  const account: Account = { providerAccountId: email, type: 'email', provider: 'email' };
  const existingUser = toDbUser(await adapter.getUserByEmail(email));

  if (existingUser) {
    const user = toDbUser(
      await adapter.updateUser({ id: adapterUserId(existingUser.id), emailVerified: new Date() }),
    )!;
    await authOptions.events?.updateUser?.({ user });
    return completeSignIn(user, account, false);
  }

  const { user, isNewUser } = await createUser({
    email,
    name: null,
    image: null,
    emailVerified: new Date(),
  });
  return completeSignIn(user, account, isNewUser);
};

/**
 * One-time code handed to the app after a browser sign-in, redeemable only with the PKCE verifier.
 */
export const createHandoffCode = async (challenge: string, userId: number) => {
  const code = generateOpaqueToken();

  // Opportunistic cleanup of codes the app never exchanged
  db.verificationToken
    .deleteMany({ where: { identifier: handoffIdentifierFilter, expires: { lt: new Date() } } })
    .catch(console.error);

  await db.verificationToken.create({
    data: {
      identifier: handoffIdentifier(challenge, userId),
      token: hashVerificationToken(code, getAuthSecret()),
      expires: fromNow(HANDOFF_CODE_MAX_AGE_SECONDS),
    },
  });

  return code;
};

export const exchangeHandoffCode = async (code: string, verifier: string, ip: string) => {
  await assertRateLimits([[MOBILE_AUTH_LIMITS.exchangePerIpHour, ip]]);

  if (!VERIFIER_PATTERN.test(verifier)) {
    throw new MobileAuthError(400, 'Invalid verifier');
  }

  if (!isValidHandoffCode(code)) {
    throw new MobileAuthError(400, 'Invalid or expired code');
  }

  // Scoped to handoff codes, so a guess can never consume someone's email sign-in code
  const where = {
    token: hashVerificationToken(code, getAuthSecret()),
    identifier: handoffIdentifierFilter,
  };
  const verificationToken = await db.verificationToken.findFirst({ where });

  if (!verificationToken) {
    throw new MobileAuthError(400, 'Invalid or expired code');
  }

  // One use only, even when the verifier is wrong. The count guards against a concurrent exchange.
  const { count } = await db.verificationToken.deleteMany({ where });
  const userId = handoffUserId(verificationToken.identifier, pkceChallenge(verifier));

  if (1 !== count || null === userId || verificationToken.expires.getTime() < Date.now()) {
    throw new MobileAuthError(400, 'Invalid or expired code');
  }

  return createMobileSession(userId);
};

const verifyAppleIdentityToken = async (identityToken: string, audience: string[]) => {
  try {
    const { payload } = await jwtVerify(identityToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience,
    });
    return payload;
  } catch (error) {
    if (error instanceof JOSEError) {
      throw new MobileAuthError(401, 'Invalid Apple identity token');
    }
    throw error;
  }
};

/**
 * Finds the user by their linked Apple account, falling back to their verified email the first
 * time. Apple only includes the email reliably on the first sign-in, and it may be a private relay
 * address, which is a normal deliverable address as far as we are concerned.
 */
export const signInWithApple = async (
  identityToken: string,
  fullName: AppleFullName,
  ip: string,
) => {
  const audience = parseAppleAudiences(env.APPLE_BUNDLE_ID ?? '', isDevelopment());

  if (0 === audience.length) {
    throw new MobileAuthError(503, 'Sign in with Apple is not configured');
  }

  await assertRateLimits([[MOBILE_AUTH_LIMITS.applePerIpHour, ip]]);

  const payload = await verifyAppleIdentityToken(identityToken, audience);

  if (!payload.sub) {
    throw new MobileAuthError(401, 'Invalid Apple identity token');
  }

  const account: Account = { providerAccountId: payload.sub, type: 'oauth', provider: 'apple' };
  const linkedUser = toDbUser(await adapter.getUserByAccount(account));

  if (linkedUser) {
    return completeSignIn(linkedUser, account, false);
  }

  const emailVerified = true === payload.email_verified || 'true' === payload.email_verified;
  const email =
    'string' === typeof payload.email && emailVerified ? tryNormalizeEmail(payload.email) : null;

  if (!email) {
    throw new MobileAuthError(
      400,
      'Apple did not share a verified email address. Sign in with email or Google instead.',
    );
  }

  const existingUser = toDbUser(await adapter.getUserByEmail(email));
  const { user, isNewUser } = existingUser
    ? { user: existingUser, isNewUser: false }
    : await createUser({
        email,
        name: formatAppleFullName(fullName),
        image: null,
        emailVerified: new Date(),
      });

  await adapter.linkAccount({ ...account, userId: adapterUserId(user.id) });
  await authOptions.events?.linkAccount?.({ user, account, profile: user });

  return completeSignIn(user, account, isNewUser);
};

const isSecureOrigin = () => env.NEXTAUTH_URL.startsWith('https://');
const challengeCookieName = () => `${isSecureOrigin() ? '__Secure-' : ''}splitpro.mobile-challenge`;
const CHALLENGE_COOKIE_MAX_AGE_SECONDS = 15 * MINUTE;
// next-auth's session cookie, under either name it picks depending on NEXTAUTH_URL
const SESSION_COOKIES = [
  { name: 'next-auth.session-token', secure: false },
  { name: '__Secure-next-auth.session-token', secure: true },
];

/**
 * Validates the challenge and app redirect passed through the browser sign-in.
 */
export const parseHandoffParams = (query: unknown) => {
  const { challenge, redirect } = parseInput(
    z.object({ challenge: z.string(), redirect: z.string() }),
    query,
  );

  if (!isValidChallenge(challenge)) {
    throw new MobileAuthError(400, 'Invalid challenge');
  }

  const redirectUrl = parseMobileRedirect(redirect, isDevelopment());

  if (!redirectUrl) {
    throw new MobileAuthError(400, 'redirect is not an allowed app URI');
  }

  return { challenge, redirect, redirectUrl };
};

const appendSetCookie = (res: NextApiResponse, cookie: string) => {
  const existing = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...cookies, cookie]);
};

const setChallengeCookie = (res: NextApiResponse, value: string, maxAgeSeconds: number) => {
  const secure = isSecureOrigin() ? '; Secure' : '';
  appendSetCookie(
    res,
    `${challengeCookieName()}=${value}; Path=/api/mobile/auth; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`,
  );
};

/**
 * Ties the handoff to a sign-in started from this browser, so a link straight to the handoff
 * can't send a signed-in browser's code to whichever app claims the scheme. Signed, so it can't
 * be planted without loading /start.
 */
export const rememberChallenge = (res: NextApiResponse, challenge: string) =>
  setChallengeCookie(
    res,
    signChallengeCookie(challenge, Date.now(), getAuthSecret()),
    CHALLENGE_COOKIE_MAX_AGE_SECONDS,
  );

export const consumeRememberedChallenge = (req: NextApiRequest, res: NextApiResponse) => {
  setChallengeCookie(res, '', 0);
  return readChallengeCookie(req.cookies[challengeCookieName()], getAuthSecret());
};

/**
 * Signs this browser out of the web before signing in for the app. Otherwise the handoff would
 * hand over whoever is already signed in, and next-auth would link the Google account picked next
 * to that user. The app's browser is ephemeral on iOS; on Android it shares Chrome's cookies, so
 * this also signs Chrome out of splitpro.app.
 */
export const signOutBrowserSession = async (req: NextApiRequest, res: NextApiResponse) => {
  const sessionTokens = SESSION_COOKIES.flatMap(({ name }) => req.cookies[name] ?? []);

  if (0 < sessionTokens.length) {
    await db.session.deleteMany({ where: { sessionToken: { in: sessionTokens } } });
  }

  SESSION_COOKIES.forEach(({ name, secure }) =>
    appendSetCookie(
      res,
      `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    ),
  );
};

/**
 * The user of the browser's web session, only if that session was created after `issuedAt`, i.e.
 * by the sign-in /start began. Session rows have no creation time, but next-auth creates them with
 * `expires = now + maxAge`, and only moves that forward when the session is used, which can't
 * happen to a session created before /start since /start deletes it.
 */
export const getHandoffSessionUserId = async (req: NextApiRequest, issuedAt: number) => {
  const sessionTokens = SESSION_COOKIES.flatMap(({ name }) => req.cookies[name] ?? []);

  if (0 === sessionTokens.length) {
    return null;
  }

  const sessions = await db.session.findMany({
    where: { sessionToken: { in: sessionTokens }, expires: { gt: new Date() } },
    select: { userId: true, expires: true },
  });
  const session = sessions.find(
    ({ expires }) => expires.getTime() - WEB_SESSION_MAX_AGE_SECONDS * 1000 >= issuedAt,
  );

  return session?.userId ?? null;
};

/**
 * Wraps a mobile auth API route: method and content type checks, no caching, and `{ error }` JSON
 * for failures.
 */
export const mobileAuthRoute =
  (method: 'GET' | 'POST', handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'no-store');

    if (method !== req.method) {
      res.setHeader('Allow', method);
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Keeps cross-site form posts, e.g. one triggering sign-in emails, out
    if ('POST' === method && !isJsonContentType(req.headers['content-type'])) {
      res.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      if (!(error instanceof MobileAuthError)) {
        console.error('Mobile auth error', error);
        res.status(500).json({ error: 'Something went wrong' });
        return;
      }

      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error.status).json({ error: error.message });
    }
  };

export const parseInput = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown) => {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  throw new MobileAuthError(
    400,
    issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request',
  );
};
