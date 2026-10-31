/**
 * Every native-auth HTTP call lives here, so this one file is reconciled with the backend routes in
 * ../src/pages/api/mobile/auth. Errors come back as `{ error: string }` with a non-2xx status and
 * are thrown as `AuthApiError`.
 */
import type { MobileSignInResult } from '~/server/mobileAuth';

import { API_URL } from './config';

export type SignInResult = MobileSignInResult;
export type SessionUser = MobileSignInResult['user'];

export class AuthApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** From the Retry-After header of a 429. */
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const parseRetryAfter = (header: string | null) => {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && 0 < seconds ? seconds : undefined;
};

const AUTH_PATHS = {
  sendEmailCode: '/api/mobile/auth/email',
  verifyEmailCode: '/api/mobile/auth/email/verify',
  apple: '/api/mobile/auth/apple',
  googleStart: '/api/mobile/auth/start',
  exchange: '/api/mobile/auth/exchange',
  signOut: '/api/mobile/auth/signout',
} as const;

const post = async <T>(path: string, body?: unknown, token?: string): Promise<T> => {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new AuthApiError('Could not reach SplitPro. Check your connection.', 0);
  }

  const data = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;

  if (!response.ok) {
    const message =
      'string' === typeof data?.error ? data.error : 'Something went wrong. Please try again.';
    throw new AuthApiError(
      message,
      response.status,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }

  if (null === data) {
    throw new AuthApiError('Unexpected response from SplitPro.', response.status);
  }

  return data;
};

/** Emails a one-time sign-in code. */
export const sendEmailCode = (email: string) =>
  post<{ ok: true }>(AUTH_PATHS.sendEmailCode, { email });

/** Exchanges the emailed code for a session token. */
export const verifyEmailCode = (email: string, code: string) =>
  post<SignInResult>(AUTH_PATHS.verifyEmailCode, { email, code });

export type AppleFullName = {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
};

/** Signs in with the identity token from expo-apple-authentication. */
export const signInWithAppleToken = (identityToken: string, fullName?: AppleFullName | null) =>
  post<SignInResult>(AUTH_PATHS.apple, { identityToken, fullName });

/**
 * The page that starts the browser sign-in for the app. It has to be opened on the server's
 * NEXTAUTH_URL host, because the sign-in relies on that host's cookies.
 */
export const googleSignInUrl = (challenge: string, redirect: string) =>
  `${API_URL}${AUTH_PATHS.googleStart}?${new URLSearchParams({ provider: 'google', challenge, redirect }).toString()}`;

/**
 * Redeems the one-time code the browser sign-in (e.g. Google) hands back to the app, with the PKCE
 * verifier whose challenge started that sign-in.
 */
export const exchangeHandoffCode = (code: string, verifier: string) =>
  post<SignInResult>(AUTH_PATHS.exchange, { code, verifier });

/**
 * The ids of the sign-in providers the server has configured (next-auth's providers endpoint), e.g.
 * `['google', 'email']`. Self-hosted instances may have only some of them.
 */
export const getAuthProviders = async () => {
  const response = await fetch(`${API_URL}/api/auth/providers`);

  if (!response.ok) {
    throw new AuthApiError('Could not load sign-in options.', response.status);
  }

  return Object.keys((await response.json()) as Record<string, unknown>);
};

/**
 * Revokes the session token on the server. With the device's push token, the server also stops
 * sending it notifications, in the same step.
 */
export const signOutSession = (token: string, pushToken?: string | null) =>
  post<{ ok: true }>(AUTH_PATHS.signOut, pushToken ? { pushToken } : undefined, token);
