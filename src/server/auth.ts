import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { randomInt } from 'crypto';
import { type GetServerSidePropsContext } from 'next';
import { getServerSession, type DefaultSession, type NextAuthOptions } from 'next-auth';
import { Adapter, AdapterUser } from 'next-auth/adapters';
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

const SplitProPrismaAdapter = (...args: Parameters<typeof PrismaAdapter>): Adapter => {
  const prismaAdapter = PrismaAdapter(...args);

  return {
    ...prismaAdapter,
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
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
        currency: user.currency,
      },
    }),
  },
  adapter: SplitProPrismaAdapter(db),
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
          // Check if user already exists - allow existing users to sign in
          const existingUser = await db.user.findUnique({
            where: { email: email.toLowerCase() },
          });

          // Only block certain email domains for NEW signups, not existing users
          if (!existingUser) {
            const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';

            const blockedEmailDomains = [
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

            if (blockedEmailDomains.includes(emailDomain)) {
              throw new Error(
                'This email domain is not supported for signup. Please use Google login instead.',
              );
            }
          }

          const result = await sendSignUpEmail(email, token, url);
          if (!result) {
            throw new Error('Failed to send email');
          }
        },
        async generateVerificationToken() {
          return Array.from(
            { length: EMAIL_TOKEN_LENGTH },
            () => EMAIL_TOKEN_ALPHABET[randomInt(EMAIL_TOKEN_ALPHABET.length)],
          ).join('');
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
