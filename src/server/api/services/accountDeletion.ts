import { type Prisma, RecurringStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { timingSafeEqual } from 'crypto';

import { env } from '~/env';
import { authOptions, generateEmailToken } from '~/server/auth';
import { db } from '~/server/db';
import { sendAccountDeletedEmail, sendAccountDeletionCodeEmail } from '~/server/mailer';
import {
  HANDOFF_IDENTIFIER_PREFIX,
  hashVerificationToken,
  parseAppleAudiences,
} from '~/server/mobileAuthTokens';
import {
  RateLimitedError,
  type RateLimitRule,
  consumeRateLimits,
  resetRateLimit,
} from '~/server/rateLimit';
import { getAppleRevokeConfig, revokeAppleAuthorization } from '~/server/appleRevoke';

import {
  sendRecurringGroupDeletedPushNotification,
  sendRecurringStatusPushNotification,
} from './notificationService';
import { lockAndPrepareAccountRemoval } from './recurringService';

/** What other people see in place of someone who deleted their account. */
export const DELETED_USER_NAME = 'Deleted user';

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const DELETE_ACCOUNT_CODE_MAX_AGE_SECONDS = 15 * MINUTE;
export const DELETE_ACCOUNT_RESEND_SECONDS = MINUTE;
export const INVALID_DELETE_CODE_MESSAGE = 'Invalid or expired code';

export const ACCOUNT_DELETION_LIMITS = {
  sendCooldown: {
    name: 'account-delete-send:user:cooldown',
    limit: 1,
    windowSeconds: DELETE_ACCOUNT_RESEND_SECONDS,
  },
  sendPerDay: { name: 'account-delete-send:user:1d', limit: 10, windowSeconds: DAY },
  // Like the sign-in code's: a few guesses per code, then a new one has to be requested
  verifyPerCode: {
    name: 'account-delete-verify:user',
    limit: 5,
    windowSeconds: DELETE_ACCOUNT_CODE_MAX_AGE_SECONDS,
  },
} satisfies Record<string, RateLimitRule>;

const DELETE_CODE_IDENTIFIER_PREFIX = 'account-delete';
const ACCOUNT_DELETION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/**
 * Deletion codes live next to sign-in codes on VerificationToken, under their own identifier, so
 * neither kind can be used as the other: sign-in looks codes up by email, this by user id.
 */
export const deleteCodeIdentifier = (userId: number) =>
  `${DELETE_CODE_IDENTIFIER_PREFIX}:${userId}`;

const getSecret = () => {
  const secret = authOptions.secret ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Auth is not configured' });
  }
  return secret;
};

/**
 * The identifier is part of the hash, so a code can only match the account it was sent for, and
 * two accounts getting the same code don't clash on the unique token column.
 */
export const hashDeleteCode = (userId: number, code: string, secret: string) =>
  hashVerificationToken(`${deleteCodeIdentifier(userId)}:${code.trim().toUpperCase()}`, secret);

const isSameHash = (a: string, b: string) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

const rateLimited = (retryAfterSeconds: number) => {
  const cause = new RateLimitedError(retryAfterSeconds);
  return new TRPCError({ code: 'TOO_MANY_REQUESTS', message: cause.message, cause });
};

/**
 * What deleting the account changes, for the screen that explains it: their outstanding balances
 * (which stay with their friends) and the groups they created (which pass to another member).
 */
export const getAccountDeletionInfo = async (userId: number) => {
  const [user, balances, groups, appleAccounts] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    db.balance.groupBy({
      by: ['currency'],
      _sum: { amount: true },
      where: { userId, amount: { not: 0 } },
    }),
    db.group.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        // Who handOverGroups gives it to
        groupUsers: {
          where: { userId: { not: userId }, user: { deletedAt: null } },
          orderBy: { userId: 'asc' },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        groupBalances: { where: { amount: { not: 0 } }, take: 1, select: { amount: true } },
      },
    }),
    db.account.count({ where: { userId, provider: 'apple' } }),
  ]);

  return {
    email: user.email,
    balances: balances
      .map((balance) => ({ currency: balance.currency, amount: balance._sum.amount ?? 0 }))
      .filter((balance) => 0 !== balance.amount),
    groups: groups.map((group) => {
      const nextOwner = group.groupUsers[0]?.user;
      return {
        id: group.id,
        name: group.name,
        nextOwnerName: nextOwner ? nextOwner.name ?? nextOwner.email : null,
        willBeDeleted: !nextOwner && 0 === group.groupBalances.length,
      };
    }),
    hasAppleAccount: 0 < appleAccounts,
  };
};

/**
 * Emails a one-time code that `deleteAccount` needs. Only the newest code works, and it gets a
 * fresh set of attempts.
 */
export const requestAccountDeletionCode = async (userId: number) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });

  if (!user.email) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Your account has no email address to send a code to',
    });
  }

  const key = String(userId);
  const result = await consumeRateLimits([
    [ACCOUNT_DELETION_LIMITS.sendCooldown, key],
    [ACCOUNT_DELETION_LIMITS.sendPerDay, key],
  ]);

  if (!result.allowed) {
    throw rateLimited(result.retryAfterSeconds);
  }

  const code = generateEmailToken();
  const identifier = deleteCodeIdentifier(userId);

  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }),
    db.verificationToken.create({
      data: {
        identifier,
        token: hashDeleteCode(userId, code, getSecret()),
        expires: new Date(Date.now() + DELETE_ACCOUNT_CODE_MAX_AGE_SECONDS * 1000),
      },
    }),
  ]);
  await resetRateLimit(ACCOUNT_DELETION_LIMITS.verifyPerCode, key);

  const sent = await sendAccountDeletionCodeEmail(
    user.email,
    code,
    DELETE_ACCOUNT_CODE_MAX_AGE_SECONDS / MINUTE,
  );

  if (!sent) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send email' });
  }

  return {
    email: user.email,
    expiresInSeconds: DELETE_ACCOUNT_CODE_MAX_AGE_SECONDS,
    resendAfterSeconds: DELETE_ACCOUNT_RESEND_SECONDS,
  };
};

/**
 * Throws unless `code` is the account's current deletion code. Counts the attempt; too many burn
 * the code. Leaves it in place: `deleteAccount` consumes it in the transaction that deletes.
 */
const assertDeleteCode = async (userId: number, hash: string) => {
  const key = String(userId);
  const identifier = deleteCodeIdentifier(userId);
  const result = await consumeRateLimits([[ACCOUNT_DELETION_LIMITS.verifyPerCode, key]]);

  if (!result.allowed) {
    await db.verificationToken.deleteMany({ where: { identifier } });
    throw rateLimited(result.retryAfterSeconds);
  }

  const stored = await db.verificationToken.findFirst({ where: { identifier } });

  if (!stored || !isSameHash(stored.token, hash) || stored.expires.getTime() <= Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: INVALID_DELETE_CODE_MESSAGE });
  }
};

/**
 * Best effort, as the App Store requires for Sign in with Apple: revokes the user's Apple tokens
 * with a fresh authorization code from the app. Needs the Apple `sub` of their linked accounts,
 * so it runs before those are removed.
 */
const revokeAppleSignIn = async (userId: number, authorizationCode: string | undefined) => {
  const appleAccounts = await db.account.findMany({
    where: { userId, provider: 'apple' },
    select: { providerAccountId: true },
  });

  if (0 === appleAccounts.length) {
    return;
  }

  if (!authorizationCode) {
    console.warn('Deleting an account linked to Apple without an authorization code to revoke');
    return;
  }

  const config = getAppleRevokeConfig({
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_KEY_ID,
    privateKey: env.APPLE_PRIVATE_KEY,
    clientId: parseAppleAudiences(env.APPLE_BUNDLE_ID ?? '', false)[0],
  });

  if (!config) {
    console.warn(
      'Not revoking Sign in with Apple: set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY and APPLE_BUNDLE_ID',
    );
    return;
  }

  await revokeAppleAuthorization({
    config,
    authorizationCode,
    appleUserIds: appleAccounts.map((account) => account.providerAccountId),
  });
};

/**
 * Groups the account created pass to the member who has been around longest (lowest id). A group
 * nobody else is in any more goes, like deleting it would, if it's settled. Returns the deleted
 * groups with their recurring expenses, whose creators should be told.
 */
const handOverGroups = async (tx: Prisma.TransactionClient, userId: number) => {
  const groups = await tx.group.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      groupUsers: {
        where: { userId: { not: userId }, user: { deletedAt: null } },
        orderBy: { userId: 'asc' },
        take: 1,
        select: { userId: true },
      },
      groupBalances: { where: { amount: { not: 0 } }, take: 1, select: { amount: true } },
      recurringExpenses: {
        where: { status: { not: RecurringStatus.STOPPED }, createdById: { not: userId } },
        select: {
          createdById: true,
          occurrences: { orderBy: { occurrenceDate: 'desc' }, take: 1, select: { name: true } },
        },
      },
    },
  });

  const deleted: typeof groups = [];

  for (const group of groups) {
    const nextOwner = group.groupUsers[0];

    if (nextOwner) {
      await tx.group.update({ where: { id: group.id }, data: { userId: nextOwner.userId } });
    } else if (0 === group.groupBalances.length) {
      await tx.group.delete({ where: { id: group.id } });
      deleted.push(group);
    }
  }

  return deleted;
};

/**
 * Leaves every group the account is settled in. Where it still has a balance it stays a member,
 * shown as a deleted user, so the others can see and settle what's left.
 */
const leaveSettledGroups = async (tx: Prisma.TransactionClient, userId: number) => {
  const unsettled = await tx.groupBalance.findMany({
    where: { userId, amount: { not: 0 } },
    distinct: ['groupId'],
    select: { groupId: true },
  });

  await tx.groupUser.deleteMany({
    where: { userId, groupId: { notIn: unsettled.map((balance) => balance.groupId) } },
  });
};

/**
 * Removes the person, not what they share: their name, email, sign-in methods, sessions, devices
 * and friendships go. Expenses, balances and notes stay for the people they share them with,
 * against an anonymous user row.
 */
const anonymiseAccount = async (
  tx: Prisma.TransactionClient,
  userId: number,
  email: string | null,
) => {
  const pausedIds = await lockAndPrepareAccountRemoval(tx, userId);
  const deletedGroups = await handOverGroups(tx, userId);
  await leaveSettledGroups(tx, userId);

  await tx.friendship.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.devicePushToken.deleteMany({ where: { userId } });
  await tx.session.deleteMany({ where: { userId } });
  await tx.pushNotification.deleteMany({ where: { userId } });
  await tx.verificationToken.deleteMany({
    where: {
      OR: [
        { identifier: deleteCodeIdentifier(userId) },
        ...(email ? [{ identifier: email }] : []),
        {
          AND: [
            { identifier: { startsWith: `${HANDOFF_IDENTIFIER_PREFIX}:` } },
            { identifier: { endsWith: `:${userId}` } },
          ],
        },
      ],
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      name: DELETED_USER_NAME,
      email: null,
      emailVerified: null,
      image: null,
      deletedAt: new Date(),
    },
  });

  return { pausedIds, deletedGroups };
};

/**
 * Deletes the account once the emailed code checks out. The code is used up in the same
 * transaction, so it works once.
 */
export const deleteAccount = async (
  userId: number,
  { code, appleAuthorizationCode }: { code: string; appleAuthorizationCode?: string },
) => {
  const hash = hashDeleteCode(userId, code, getSecret());
  await assertDeleteCode(userId, hash);

  // Captured before it's removed, for the goodbye email
  const { email } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  await revokeAppleSignIn(userId, appleAuthorizationCode);

  // Balances don't change, so not serializable like balance changes: that would conflict with
  // them for nothing. The rules and the account are locked row by row instead.
  const { pausedIds, deletedGroups } = await db.$transaction(async (tx) => {
    const { count } = await tx.verificationToken.deleteMany({
      where: { identifier: deleteCodeIdentifier(userId), token: hash, expires: { gt: new Date() } },
    });

    if (1 !== count) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: INVALID_DELETE_CODE_MESSAGE });
    }

    return anonymiseAccount(tx, userId, email);
  }, ACCOUNT_DELETION_TRANSACTION_OPTIONS);

  const key = String(userId);
  await Promise.all([
    resetRateLimit(ACCOUNT_DELETION_LIMITS.verifyPerCode, key),
    ...(email ? [db.rateLimit.deleteMany({ where: { key: { endsWith: `:${email}` } } })] : []),
  ]).catch(console.error);

  pausedIds.forEach((id) => {
    sendRecurringStatusPushNotification(id).catch(console.error);
  });
  deletedGroups.forEach((group) => {
    sendRecurringGroupDeletedPushNotification(
      group.recurringExpenses.flatMap((rule) =>
        null === rule.createdById
          ? []
          : [
              {
                createdById: rule.createdById,
                name: rule.occurrences[0]?.name ?? 'A recurring expense',
              },
            ],
      ),
      group.name,
    ).catch(console.error);
  });

  if (email) {
    sendAccountDeletedEmail(email).catch(console.error);
  }
};
