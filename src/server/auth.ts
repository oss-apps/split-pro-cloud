import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { type Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { type GetServerSidePropsContext } from 'next';
import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
  type Session,
  type User,
} from 'next-auth';
import { Adapter, AdapterAccount, AdapterSession, AdapterUser } from 'next-auth/adapters';
import DiscordProvider from 'next-auth/providers/discord';
import GoogleProvider from 'next-auth/providers/google';
import EmailProvider from 'next-auth/providers/email';
import AuthentikProvider from 'next-auth/providers/authentik';

import { env } from '~/env';
import { db } from '~/server/db';
import { sendSignUpEmail } from './mailer';
import { type RateLimitRule, resetRateLimit } from './rateLimit';

export const EMAIL_TOKEN_MAX_AGE_SECONDS = 10 * 60;
const EMAIL_TOKEN_LENGTH = 6;
// No 0/O or 1/I so codes are easy to type
const EMAIL_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EMAIL_AUTH_LIMITS = {
  sendPerEmail15m: { name: 'email-send:email:15m', limit: 3, windowSeconds: 15 * MINUTE },
  sendPerEmailDay: { name: 'email-send:email:1d', limit: 10, windowSeconds: DAY },
  sendPerIpHour: { name: 'email-send:ip:1h', limit: 10, windowSeconds: HOUR },
  sendPerIpDay: { name: 'email-send:ip:1d', limit: 30, windowSeconds: DAY },
  verifyPerEmail: {
    name: 'email-verify:email',
    limit: 5,
    windowSeconds: EMAIL_TOKEN_MAX_AGE_SECONDS,
  },
  verifyPerIpHour: { name: 'email-verify:ip:1h', limit: 20, windowSeconds: HOUR },
} satisfies Record<string, RateLimitRule>;

/**
 * Same rules as next-auth's default email normalizer, shared so rate limit keys match the
 * identifier stored on VerificationToken.
 */
export function normalizeEmailIdentifier(identifier: string) {
  const trimmed = identifier.normalize('NFKC').trim();

  if (1 !== (trimmed.match(/@/g) ?? []).length || trimmed.includes('"')) {
    throw new Error('Invalid email address format.');
  }

  const [local, rawDomain] = trimmed.toLowerCase().split('@');
  const domain = rawDomain?.split(',')[0];

  if (!local || !domain?.includes('.')) {
    throw new Error('Invalid email address format.');
  }

  return `${local}@${domain}`;
}

export async function deleteVerificationTokens(identifier: string) {
  await db.verificationToken.deleteMany({ where: { identifier } });
}

export const generateEmailToken = () =>
  Array.from(
    { length: EMAIL_TOKEN_LENGTH },
    () => EMAIL_TOKEN_ALPHABET[randomInt(EMAIL_TOKEN_ALPHABET.length)],
  ).join('');

const BLOCKED_SIGNUP_EMAIL_DOMAINS = [
  // Yahoo domains
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.co.jp',
  'ymail.com',
  'rocketmail.com',
  'yahoo.in',
  'yahoo.com.br',
  'att.net',
  'aol.com',
  // Hotmail/Outlook domains
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'hotmail.ca',
  'outlook.com',
  'outlook.in',
  'live.com',
  'live.co.uk',
  'msn.com',
  'windowslive.com',
];

export const EMAIL_DOMAIN_BLOCKED_MESSAGE =
  'This email domain is not supported for signup. Please use Google login instead.';

/**
 * Throws for new signups from blocked email domains. Existing users can always sign in.
 */
export const assertEmailSignInAllowed = async (email: string) => {
  const existingUser = await db.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existingUser) {
    return;
  }

  const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';

  if (BLOCKED_SIGNUP_EMAIL_DOMAINS.includes(emailDomain)) {
    throw new Error(EMAIL_DOMAIN_BLOCKED_MESSAGE);
  }
};

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: DefaultSession['user'] & {
      id: number;
      currency: string;
      // ...other properties
      // role: UserRole;
    };
  }

  interface User {
    id: number;
    currency: string;
  }
}

/** Thrown when signing in would give a session to, or link a sign-in to, a deleted account. */
export class DeletedAccountError extends Error {
  constructor() {
    super('This account has been deleted');
  }
}

/**
 * Runs `write` while the account is locked against deletion, which locks it FOR UPDATE before it
 * removes sessions and sign-in methods. So a sign-in that looked the user up just before the
 * deletion either commits first, and the deletion removes what it wrote, or waits and is refused.
 */
const writeForLiveUser = <T>(userId: number, write: (tx: Prisma.TransactionClient) => Promise<T>) =>
  db.$transaction(async (tx) => {
    const live = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM "User" WHERE id = ${userId} AND "deletedAt" IS NULL FOR SHARE`;

    if (0 === live.length) {
      throw new DeletedAccountError();
    }

    return write(tx);
  });

// Adapter users are our User rows, typed without our columns
const isDeleted = (user: AdapterUser) =>
  !!(user as AdapterUser & { deletedAt: Date | null }).deletedAt;
const liveUser = (user: AdapterUser | null) => (user && isDeleted(user) ? null : user);

const SplitProPrismaAdapter = (...args: Parameters<typeof PrismaAdapter>): Adapter => {
  const prismaAdapter = PrismaAdapter(...args);

  return {
    ...prismaAdapter,
    // A deleted account keeps its row for what others share with it, but can never sign in again
    getUser: async (id) => liveUser(await prismaAdapter.getUser!(id)),
    getUserByEmail: async (email) => liveUser(await prismaAdapter.getUserByEmail!(email)),
    getUserByAccount: async (account) => liveUser(await prismaAdapter.getUserByAccount!(account)),
    getSessionAndUser: async (sessionToken) => {
      const userAndSession = await prismaAdapter.getSessionAndUser!(sessionToken);

      if (!userAndSession || !isDeleted(userAndSession.user)) {
        return userAndSession;
      }

      await db.session.deleteMany({ where: { sessionToken } });
      return null;
    },
    updateUser: ({ id, ...data }) =>
      writeForLiveUser(Number(id), (tx) =>
        tx.user.update({ where: { id: Number(id) }, data }),
      ) as unknown as Promise<AdapterUser>,
    linkAccount: (account: AdapterAccount) =>
      writeForLiveUser(Number(account.userId), (tx) =>
        tx.account.create({ data: { ...account, userId: Number(account.userId) } }),
      ),
    createSession: (session) =>
      writeForLiveUser(Number(session.userId), (tx) =>
        tx.session.create({ data: { ...session, userId: Number(session.userId) } }),
      ) as unknown as Promise<AdapterSession>,
    createUser: async (user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> => {
      // next-auth types this via the optional @auth/core peer, which resolves to `any` without it
      const prismaCreateUser = prismaAdapter.createUser as
        | ((user: Omit<AdapterUser, 'id'>) => Promise<AdapterUser>)
        | undefined;

      if (env.INVITE_ONLY) {
        throw new Error('This instance is Invite Only');
      }

      if (!prismaCreateUser) {
        // This should never happen but typing says it's possible.
        throw new Error('Prisma Adapter lacks User Creation');
      }

      return prismaCreateUser(user);
    },
    // The only way an account is removed in code. Its recurring expenses pause or stop first.
    deleteUser: async (id: string) => {
      // Loaded here, so signing in never pulls in the expense services.
      const [
        { deleteUserAccount },
        { sendRecurringGroupDeletedPushNotification, sendRecurringStatusPushNotification },
      ] = await Promise.all([
        import('./api/services/recurringService'),
        import('./api/services/notificationService'),
      ]);
      const { user, pausedIds, deletedGroups } = await deleteUserAccount(Number(id));
      pausedIds.forEach((ruleId) => {
        sendRecurringStatusPushNotification(ruleId).catch(console.error);
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
      return { ...user, id: String(user.id) } as unknown as AdapterUser;
    },
    createVerificationToken: async (verificationToken) => {
      // Only the newest code works, and it gets a fresh set of verification attempts.
      const [, created] = await db.$transaction([
        db.verificationToken.deleteMany({ where: { identifier: verificationToken.identifier } }),
        db.verificationToken.create({ data: verificationToken }),
      ]);
      await resetRateLimit(EMAIL_AUTH_LIMITS.verifyPerEmail, verificationToken.identifier);
      return created;
    },
  };
};

export const authAdapter = SplitProPrismaAdapter(db);

/**
 * The session the app sees, for both cookie sessions and native app bearer sessions.
 */
export const buildSession = (session: DefaultSession, user: User): Session => ({
  ...session,
  user: {
    ...session.user,
    id: user.id,
    currency: user.currency,
  },
});

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
  },
  callbacks: {
    // `user` is typed as an AdapterUser with a string id, but our ids are numbers
    session: ({ session, user }) => buildSession(session, user as unknown as User),
  },
  adapter: authAdapter,
  providers: getProviders(),
  events: {
    createUser: async ({ user }) => {
      // Check if the user's name is empty
      if ((!user.name || user.name.trim() === '') && user.email) {
        // Define the logic to update the user's name here
        const updatedName = user.email.split('@')[0];

        // Use your database client to update the user's name
        await db.user.update({
          where: { id: user.id },
          data: { name: updatedName },
        });
      }
    },
  },
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = (ctx: {
  req: GetServerSidePropsContext['req'];
  res: GetServerSidePropsContext['res'];
}) => {
  return getServerSession(ctx.req, ctx.res, authOptions);
};

export const getServerAuthSessionForSSG = async (context: GetServerSidePropsContext) => {
  console.log('Before getting session');
  const session = await getServerAuthSession(context);
  console.log('After getting session');

  if (!session?.user?.email) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }

  return {
    props: {
      user: session.user,
    },
  };
};

/**
 * Get providers to enable
 */
function getProviders() {
  const providersList = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providersList.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (env.EMAIL_SERVER_HOST) {
    providersList.push(
      EmailProvider({
        from: env.FROM_EMAIL,
        server: {
          host: env.EMAIL_SERVER_HOST,
          port: parseInt(env.EMAIL_SERVER_PORT ?? ''),
          auth: {
            user: env.EMAIL_SERVER_USER,
            pass: env.EMAIL_SERVER_PASSWORD,
          },
        },
        maxAge: EMAIL_TOKEN_MAX_AGE_SECONDS,
        normalizeIdentifier: normalizeEmailIdentifier,
        async sendVerificationRequest({ identifier: email, url, token }) {
          await assertEmailSignInAllowed(email);

          const result = await sendSignUpEmail(email, token, url);
          if (!result) {
            throw new Error('Failed to send email');
          }
        },
        async generateVerificationToken() {
          return generateEmailToken();
        },
      }),
    );
  }

  if (env.AUTHENTIK_ID && env.AUTHENTIK_SECRET && env.AUTHENTIK_ISSUER) {
    providersList.push(
      AuthentikProvider({
        clientId: env.AUTHENTIK_ID,
        clientSecret: env.AUTHENTIK_SECRET,
        issuer: env.AUTHENTIK_ISSUER,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  return providersList;
}

/**
 * Validates the environment variables that are related to authentication.
 * this will check if atleat one provider is set properly.
 *
 * this function should be updated if new providers are added.
 */
export function validateAuthEnv() {
  console.log('Validating auth env');
  if (!process.env.SKIP_ENV_VALIDATION) {
    const providers = getProviders();
    if (providers.length === 0) {
      throw new Error(
        'No authentication providers are configured, at least one is required. Learn more here: https://github.com/oss-apps/split-pro?tab=readme-ov-file#setting-up-the-environment',
      );
    }
  }
}
