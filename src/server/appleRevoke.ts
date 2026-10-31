import { SignJWT, decodeJwt, importPKCS8 } from 'jose';

/**
 * Revokes a user's Sign in with Apple authorization when they delete their account, as the App
 * Store requires. Free of db and env imports so it can be unit tested.
 *
 * @see https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
 */

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
// The secret is made for one exchange and one revoke. Apple accepts up to six months.
const CLIENT_SECRET_MAX_AGE_SECONDS = 5 * 60;
const APPLE_REQUEST_TIMEOUT_MS = 10_000;

export type AppleRevokeConfig = {
  teamId: string;
  keyId: string;
  /** PKCS #8 PEM, the contents of the .p8 file. */
  privateKey: string;
  /** The app's bundle id, which Apple issued the authorization code to. */
  clientId: string;
};

export type AppleRevokeResult = 'revoked' | 'unconfigured' | 'mismatched' | 'failed';

/** Env vars often hold a PEM on one line, with literal `\n`. */
export const normalizeApplePrivateKey = (privateKey: string) =>
  privateKey.replace(/\\n/g, '\n').trim();

export const getAppleRevokeConfig = ({
  teamId,
  keyId,
  privateKey,
  clientId,
}: Partial<Record<keyof AppleRevokeConfig, string>>): AppleRevokeConfig | null =>
  teamId && keyId && privateKey && clientId
    ? { teamId, keyId, privateKey: normalizeApplePrivateKey(privateKey), clientId }
    : null;

/**
 * The client secret JWT for Apple's token endpoints, signed with the Sign in with Apple key.
 */
export const createAppleClientSecret = async (config: AppleRevokeConfig, now = Date.now()) => {
  const issuedAt = Math.floor(now / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + CLIENT_SECRET_MAX_AGE_SECONDS)
    .sign(await importPKCS8(config.privateKey, 'ES256'));
};

const postForm = (fetchFn: typeof fetch, url: string, form: Record<string, string>) =>
  fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
  });

const readError = async (response: Response) => {
  const body = await response.text().catch(() => '');
  return `${response.status} ${body}`.trim();
};

/**
 * Exchanges a fresh authorization code from the app for the user's tokens, then revokes them. Only
 * when the code belongs to one of `appleUserIds` (the `sub` of their linked Apple accounts), so a
 * code for some other Apple ID can't revoke that person's sign-in. Never throws: deleting the
 * account goes on whatever Apple says.
 */
export const revokeAppleAuthorization = async ({
  config,
  authorizationCode,
  appleUserIds,
  fetchFn = fetch,
  now = Date.now(),
}: {
  config: AppleRevokeConfig | null;
  authorizationCode: string;
  appleUserIds: string[];
  fetchFn?: typeof fetch;
  now?: number;
}): Promise<AppleRevokeResult> => {
  if (!config) {
    return 'unconfigured';
  }

  try {
    const clientSecret = await createAppleClientSecret(config, now);
    const tokenResponse = await postForm(fetchFn, APPLE_TOKEN_URL, {
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    });

    if (!tokenResponse.ok) {
      console.error('Apple token exchange failed', await readError(tokenResponse));
      return 'failed';
    }

    const tokens = (await tokenResponse.json()) as {
      id_token?: string;
      refresh_token?: string;
      access_token?: string;
    };
    // Straight from Apple over TLS, so the claims can be read without checking the signature
    const sub = tokens.id_token ? decodeJwt(tokens.id_token).sub : undefined;

    if (!sub || !appleUserIds.includes(sub)) {
      console.error('Apple authorization code is for another Apple ID, not revoking');
      return 'mismatched';
    }

    const [token, hint] = tokens.refresh_token
      ? [tokens.refresh_token, 'refresh_token']
      : [tokens.access_token, 'access_token'];

    if (!token) {
      console.error('Apple token exchange returned no token to revoke');
      return 'failed';
    }

    const revokeResponse = await postForm(fetchFn, APPLE_REVOKE_URL, {
      client_id: config.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: hint,
    });

    if (!revokeResponse.ok) {
      console.error('Apple token revoke failed', await readError(revokeResponse));
      return 'failed';
    }

    return 'revoked';
  } catch (error) {
    console.error('Apple token revoke failed', error);
    return 'failed';
  }
};
