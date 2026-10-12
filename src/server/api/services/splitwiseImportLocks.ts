import { randomUUID } from 'crypto';
import { type Prisma, type SplitwiseImportMode } from '@prisma/client';

import { db } from '~/server/db';

/**
 * Claims how each pair's Splitwise balance comes over, inside the transaction that writes it, and
 * returns the pairs already claimed the other way. A claim is never changed or removed, so a pair
 * imported as a balance can't also get its history, and the other way around.
 *
 * Two transactions claiming the same new pair can't both succeed: the second waits on the primary
 * key and then fails to serialize, and `runBalanceTransaction` retries it, now seeing the claim.
 * Claims take no row locks, so they add nothing to the lock order of balance transactions.
 */
export const claimSplitwisePairs = async (
  tx: Prisma.TransactionClient,
  pairs: [number, number][],
  mode: SplitwiseImportMode,
) => {
  const sorted = [
    ...new Map(
      pairs
        .filter(([a, b]) => a !== b)
        .map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number])
        .map((pair) => [pair.join(':'), pair]),
    ).values(),
  ].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (!sorted.length) {
    return [];
  }

  const userIds = sorted.map(([a]) => a);
  const friendIds = sorted.map(([, b]) => b);
  await tx.$executeRaw`
    INSERT INTO "SplitwiseImportPair" ("userId", "friendId", "mode")
    SELECT u, f, ${mode}::"SplitwiseImportMode"
    FROM unnest(${userIds}::int[], ${friendIds}::int[]) AS t(u, f)
    ORDER BY u, f
    ON CONFLICT DO NOTHING`;
  const claims = await tx.$queryRaw<{ userId: number; friendId: number; mode: string }[]>`
    SELECT "userId", "friendId", "mode"::text AS "mode"
    FROM "SplitwiseImportPair"
    WHERE ("userId", "friendId") IN (
      SELECT * FROM unnest(${userIds}::int[], ${friendIds}::int[])
    )`;

  return claims
    .filter((claim) => claim.mode !== mode)
    .map((claim) => [claim.userId, claim.friendId] as [number, number]);
};

/** Pairs claimed as a balance-only import, without claiming anything. */
export const getBalanceOnlyPairs = async (pairs: [number, number][]) => {
  const keys = pairs.filter(([a, b]) => a !== b).map(([a, b]) => (a < b ? [a, b] : [b, a]));
  if (!keys.length) {
    return [];
  }
  return db.splitwiseImportPair.findMany({
    where: {
      mode: 'BALANCE',
      OR: keys.map(([userId, friendId]) => ({ userId, friendId })),
    },
    select: { userId: true, friendId: true },
  });
};

/** How long a lease lasts without being renewed, e.g. after a crash. */
const LOCK_TTL_SECONDS = 120;
const LOCK_RETRY_MS = 250;

export class LostImportLockError extends Error {
  constructor() {
    super('The import took too long and was stopped.');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes leases on every key, waiting up to `waitMs` for an import holding one of them to finish.
 * Returns the token to renew and release them with, or null when they stayed busy.
 */
export const acquireImportLocks = async (keys: string[], waitMs: number) => {
  const sorted = [...new Set(keys)].sort();
  const token = randomUUID();
  const deadline = Date.now() + waitMs;

  for (;;) {
    let acquired = 0;
    try {
      // In key order, so two imports wanting the same keys don't wait on each other in a cycle.
      acquired = (
        await db.$queryRaw<{ key: string }[]>`
          INSERT INTO "SplitwiseImportLock" ("key", "token", "expiresAt")
          SELECT k, ${token}, NOW() + make_interval(secs => ${LOCK_TTL_SECONDS})
          FROM unnest(${sorted}::text[]) AS k
          ORDER BY k
          ON CONFLICT ("key") DO UPDATE
            SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
            WHERE "SplitwiseImportLock"."expiresAt" <= NOW()
          RETURNING "key"`
      ).length;
    } catch (error) {
      console.warn('Splitwise import: retrying a lock', error);
    }

    if (acquired === sorted.length) {
      return token;
    }
    if (acquired) {
      await releaseImportLocks(token);
    }
    if (deadline <= Date.now()) {
      return null;
    }
    await sleep(LOCK_RETRY_MS);
  }
};

/** Extends the leases. Throws if any of them expired and someone else took it meanwhile. */
export const renewImportLocks = async (token: string, count: number) => {
  const renewed = await db.$executeRaw`
    UPDATE "SplitwiseImportLock"
    SET "expiresAt" = NOW() + make_interval(secs => ${LOCK_TTL_SECONDS})
    WHERE "token" = ${token}`;
  if (renewed !== count) {
    throw new LostImportLockError();
  }
};

export const releaseImportLocks = async (token: string) => {
  await db.$executeRaw`DELETE FROM "SplitwiseImportLock" WHERE "token" = ${token}`;
};
