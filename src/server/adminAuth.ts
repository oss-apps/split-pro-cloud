import { createHash, timingSafeEqual } from 'crypto';

import { getBearerToken } from '~/server/mobileAuthTokens';

/**
 * Pure helpers for the internal admin API. Kept free of db and env imports so they can be unit
 * tested.
 */

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Whether `authorization` is `Bearer <expected>`. Compares digests in constant time, so neither the
 * token nor its length leaks through timing. Never true without an expected token.
 */
export const isAdminAuthorized = (
  authorization: string | undefined,
  expected: string | undefined,
) => {
  if (!expected) {
    return false;
  }

  const token = getBearerToken(authorization);
  if (!token) {
    return false;
  }

  return timingSafeEqual(digest(token), digest(expected));
};
