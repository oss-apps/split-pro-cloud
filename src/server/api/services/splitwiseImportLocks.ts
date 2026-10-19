import { randomUUID } from 'crypto';
import { type Prisma } from '@prisma/client';

import { db } from '~/server/db';

type Client = Prisma.TransactionClient | typeof db;

const uniqueIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/*
 * Balance-only and history imports never both write balances of the same person.
 *
 * Why this is enough: the balance-only import writes a balance only between two people it marks
 * (a `BALANCE` person, and `importedFromSplitwise` on both rows). A history import writes balances
 * only for people whose balance its expenses change (each payer and everyone with a non-zero
 * share), and marks them `HISTORY`. If none of those has any balance-only data, the two imports
 * change balances of disjoint sets of people, so nobody's total can include the same Splitwise
 * money twice. A person has one mode only (the primary key), and both importers check and set it
 * in the transaction that writes the balances.
 */

/**
 * The people among `userIds` with balances from the balance-only import: recorded as `BALANCE`,
 * or with any balance it wrote (`importedFromSplitwise`, in any currency, settled or not). That
 * includes balances written before this check existed, or by an older version of the app still
 * running during a deploy. The import writes both directions of a pair and pairs are only removed
 * together, so a person's own rows are enough, and reading them stays on the primary key.
 */
export const getBalanceOnlyPeople = async (client: Client, userIds: number[]) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) {
    return [];
  }
  const rows = await client.$queryRaw<{ userId: number }[]>`
    SELECT "userId" FROM "SplitwiseImportPerson"
    WHERE "userId" = ANY(${ids}::int[]) AND "mode" = 'BALANCE'
    UNION
    SELECT "userId" FROM "Balance"
    WHERE "userId" = ANY(${ids}::int[]) AND "importedFromSplitwise"`;
  return rows.map((row) => row.userId).sort((a, b) => a - b);
};

/** History can't be written for these people: they have balances from the balance-only import. */
export class BalanceOnlyPeopleError extends Error {
  constructor(readonly userIds: number[]) {
    super('Some people have balances from the balance-only import');
  }
}

/**
 * In the transaction that writes history for `userIds`: marks them `HISTORY`, or throws
 * `BalanceOnlyPeopleError` if any of them has balance-only data. A balance-only import of one of
 * them committing at the same time makes one of the two transactions fail to serialize, and the
 * retry sees the other's mark.
 */
export const claimHistoryPeople = async (tx: Prisma.TransactionClient, userIds: number[]) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) {
    return;
  }
  await tx.$executeRaw`
    INSERT INTO "SplitwiseImportPerson" ("userId", "mode")
    SELECT u, 'HISTORY'::"SplitwiseImportMode" FROM unnest(${ids}::int[]) AS t(u)
    ORDER BY u
    ON CONFLICT DO NOTHING`;
  const balanceOnly = await getBalanceOnlyPeople(tx, ids);
  if (balanceOnly.length) {
    throw new BalanceOnlyPeopleError(balanceOnly);
  }
};

/** The people among `userIds` with history imported, read in the balance-only transaction. */
export const getHistoryPeople = async (tx: Prisma.TransactionClient, userIds: number[]) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) {
    return new Set<number>();
  }
  const rows = await tx.$queryRaw<{ userId: number }[]>`
    SELECT "userId" FROM "SplitwiseImportPerson"
    WHERE "userId" = ANY(${ids}::int[]) AND "mode" = 'HISTORY'`;
  return new Set(rows.map((row) => row.userId));
};

/** In the balance-only transaction: marks the people it writes balances for as `BALANCE`. */
export const claimBalanceOnlyPeople = async (tx: Prisma.TransactionClient, userIds: number[]) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) {
    return;
  }
  await tx.$executeRaw`
    INSERT INTO "SplitwiseImportPerson" ("userId", "mode")
    SELECT u, 'BALANCE'::"SplitwiseImportMode" FROM unnest(${ids}::int[]) AS t(u)
    ORDER BY u
    ON CONFLICT DO NOTHING`;
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

/**
 * Every account per email, matched the way the import matches people: ignoring capitals and
 * surrounding spaces (`User_email_normalized_idx`). `emails` must already be normalized.
 */
export const findAccountsByEmail = async (client: Client, emails: string[]) => {
  const accounts = new Map<string, number[]>();
  const list = [...new Set(emails)];
  if (!list.length) {
    return accounts;
  }
  const rows = await client.$queryRaw<{ email: string; id: number }[]>`
    SELECT lower(btrim("email", E' \\t\\r\\n')) AS email, id FROM "User"
    WHERE lower(btrim("email", E' \\t\\r\\n')) = ANY(${list}::text[])
    ORDER BY id`;
  rows.forEach(({ email, id }) => accounts.set(email, [...(accounts.get(email) ?? []), id]));
  return accounts;
};

/** Emails that more than one account uses, among `emails`. */
export class SharedEmailError extends Error {
  constructor(readonly emails: string[]) {
    super('More than one SplitPro account uses the same email address.');
  }
}

/** Throws `SharedEmailError` if any of `emails` is used by more than one account. */
export const assertOneAccountPerEmail = async (client: Client, emails: string[]) => {
  const shared = [...(await findAccountsByEmail(client, emails))]
    .filter(([, ids]) => 1 < ids.length)
    .map(([email]) => email);
  if (shared.length) {
    throw new SharedEmailError(shared);
  }
};
