import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Pure helpers for native app sign-in. Kept free of db and env imports so they can be unit tested.
 */

// The only redirect the app registers. Expo Go projects (exp://<any host>) are only allowed in
// development, since anyone can publish one and receive the handoff code.
export const MOBILE_REDIRECT_URI = 'splitpro://oauth-callback';
const EXPO_GO_PROTOCOL = 'exp:';

// Every Expo Go project signs in with Apple under Expo Go's bundle id, so it's development only
const EXPO_GO_BUNDLE_ID = 'host.exp.Exponent';

export const HANDOFF_IDENTIFIER_PREFIX = 'mobile-handoff';

// generateOpaqueToken output
const HANDOFF_CODE_PATTERN = /^[0-9a-f]{64}$/;

// base64url of a sha256 digest, no padding
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// RFC 7636 code verifier
export const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export const generateOpaqueToken = () => randomBytes(32).toString('hex');

/**
 * Same hash next-auth v4 stores on VerificationToken, so either side can consume the other's codes.
 */
export const hashVerificationToken = (token: string, secret: string) =>
  createHash('sha256').update(`${token}${secret}`).digest('hex');

export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

export const isValidChallenge = (challenge: string) => CHALLENGE_PATTERN.test(challenge);

export const verifierMatchesChallenge = (verifier: string, challenge: string) =>
  VERIFIER_PATTERN.test(verifier) && pkceChallenge(verifier) === challenge;

export const isValidHandoffCode = (code: string) => HANDOFF_CODE_PATTERN.test(code);

/**
 * Returns the app redirect URI if it is allowed, otherwise null.
 */
export const parseMobileRedirect = (redirect: unknown, isDevelopment: boolean) => {
  if ('string' !== typeof redirect || 2048 < redirect.length || /\s/.test(redirect)) {
    return null;
  }

  try {
    const url = new URL(redirect);

    if (MOBILE_REDIRECT_URI === url.href) {
      return url;
    }

    return isDevelopment && EXPO_GO_PROTOCOL === url.protocol ? url : null;
  } catch {
    return null;
  }
};

/**
 * The bundle ids accepted as the audience of Apple identity tokens.
 */
export const parseAppleAudiences = (bundleIds: string, isDevelopment: boolean) =>
  bundleIds
    .split(',')
    .map((bundleId) => bundleId.trim())
    .filter((bundleId) => '' !== bundleId && (isDevelopment || EXPO_GO_BUNDLE_ID !== bundleId));

const challengeSignature = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(`mobile-challenge:${payload}`).digest('base64url');

/**
 * Cookie value tying a handoff to the /start that issued it, and when.
 */
export const signChallengeCookie = (challenge: string, issuedAt: number, secret: string) => {
  const payload = `${challenge}.${issuedAt}`;
  return `${payload}.${challengeSignature(payload, secret)}`;
};

export const readChallengeCookie = (value: string | undefined, secret: string) => {
  const [challenge, issuedAt, signature, ...rest] = value?.split('.') ?? [];

  if (!challenge || !issuedAt || !signature || 0 < rest.length || !/^\d+$/.test(issuedAt)) {
    return null;
  }

  const expected = Buffer.from(challengeSignature(`${challenge}.${issuedAt}`, secret));
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return { challenge, issuedAt: Number(issuedAt) };
};

export const appendQueryParams = (url: URL, params: Record<string, string>) => {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  return target.toString();
};

export const handoffIdentifier = (challenge: string, userId: number) =>
  `${HANDOFF_IDENTIFIER_PREFIX}:${challenge}:${userId}`;

/**
 * The user id a handoff code was issued for, if it was issued for this challenge.
 */
export const handoffUserId = (identifier: string, challenge: string) => {
  const prefix = `${HANDOFF_IDENTIFIER_PREFIX}:${challenge}:`;

  if (!identifier.startsWith(prefix)) {
    return null;
  }

  const userId = identifier.slice(prefix.length);
  return /^\d+$/.test(userId) ? Number(userId) : null;
};

export const getBearerToken = (authorization: string | undefined) => {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? null;
};

/**
 * Whether the request authenticates with a bearer token, valid or not.
 */
export const hasBearerAuthorization = (authorization: string | undefined) =>
  /^Bearer(\s|$)/i.test(authorization ?? '');

/**
 * Whether a POST body was sent as JSON. Cross-site HTML forms can't send this content type.
 */
export const isJsonContentType = (contentType: string | undefined) =>
  'application/json' === contentType?.split(';')[0]?.trim().toLowerCase();

export type AppleFullName =
  | string
  | {
      givenName?: string | null;
      middleName?: string | null;
      familyName?: string | null;
    }
  | null
  | undefined;

/**
 * Apple only shares the name on the first sign-in, and only with the app, so the app forwards it.
 */
export const formatAppleFullName = (fullName: AppleFullName) => {
  const parts =
    'string' === typeof fullName
      ? [fullName]
      : [fullName?.givenName, fullName?.middleName, fullName?.familyName];

  return parts.join(' ').trim().replace(/\s+/g, ' ') || null;
};
