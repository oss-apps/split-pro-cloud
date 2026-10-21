/**
 * PKCE (RFC 7636) helpers for the browser sign-in handoff. Pure, so they can be tested in Node; the
 * caller passes the random bytes and the SHA-256 implementation (expo-crypto in the app).
 */

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Matches VERIFIER_PATTERN in ../../../src/server/mobileAuthTokens.ts. */
export const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** 64 random bytes give a 64 character verifier with 384 bits of entropy. */
export const VERIFIER_BYTE_LENGTH = 64;

export type Sha256 = (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;

/** base64url without padding. */
export const base64UrlEncode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * One verifier character per random byte. 256 is a multiple of the alphabet size, so every
 * character is equally likely.
 */
export const createCodeVerifier = (randomBytes: Uint8Array) => {
  const verifier = Array.from(randomBytes, (byte) => BASE64URL_ALPHABET[byte & 63]).join('');

  if (!VERIFIER_PATTERN.test(verifier)) {
    throw new Error('A PKCE verifier needs 43 to 128 random bytes');
  }

  return verifier;
};

/** The S256 code challenge: base64url(sha256(ascii(verifier))). */
export const createCodeChallenge = async (verifier: string, sha256: Sha256) => {
  const ascii = Uint8Array.from(verifier, (char) => char.charCodeAt(0));
  return base64UrlEncode(new Uint8Array(await sha256(ascii)));
};
