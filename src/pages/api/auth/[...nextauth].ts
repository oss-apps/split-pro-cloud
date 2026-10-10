import { type NextApiRequest, type NextApiResponse } from 'next';
import NextAuth from 'next-auth';

import { env } from '~/env';
import {
  EMAIL_AUTH_LIMITS,
  authOptions,
  deleteVerificationTokens,
  normalizeEmailIdentifier,
} from '~/server/auth';
import { consumeRateLimits } from '~/server/rateLimit';

function getClientIp(req: NextApiRequest) {
  const cfIp = req.headers['cf-connecting-ip'];
  if ('string' === typeof cfIp && cfIp) {
    return cfIp.trim();
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const firstForwarded = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
    ?.split(',')[0]
    ?.trim();

  if (firstForwarded) {
    return firstForwarded;
  }

  return req.socket.remoteAddress ?? 'unknown';
}

function tryNormalizeEmail(email: unknown) {
  if ('string' !== typeof email) {
    return null;
  }

  try {
    return normalizeEmailIdentifier(email);
  } catch {
    return null;
  }
}

function sendSignInError(req: NextApiRequest, res: NextApiResponse, error: string) {
  const url = new URL('/auth/signin', env.NEXTAUTH_URL);
  url.searchParams.set('error', error);

  // next-auth's client posts with json=true and reads the error from the returned url
  if ('true' === (req.body as Record<string, unknown> | undefined)?.json) {
    res.status(200).json({ url: url.toString() });
    return;
  }

  res.redirect(302, url.toString());
}

function rateLimitedError(retryAfterSeconds: number) {
  return `RateLimited:${Math.max(1, Math.ceil(retryAfterSeconds / 60))}`;
}

/**
 * Rate limits email sign-in before handing over to next-auth. Returns false if the request was
 * answered here.
 */
async function checkEmailSignIn(req: NextApiRequest, res: NextApiResponse) {
  const [action, provider] = Array.isArray(req.query.nextauth) ? req.query.nextauth : [];

  if ('email' !== provider) {
    return true;
  }

  const ip = getClientIp(req);

  if ('signin' === action && 'POST' === req.method) {
    const email = tryNormalizeEmail((req.body as Record<string, unknown> | undefined)?.email);

    if (!email) {
      // Let next-auth reject it, but still count the IP
      const result = await consumeRateLimits([
        [EMAIL_AUTH_LIMITS.sendPerIpHour, ip],
        [EMAIL_AUTH_LIMITS.sendPerIpDay, ip],
      ]);
      if (!result.allowed) {
        sendSignInError(req, res, rateLimitedError(result.retryAfterSeconds));
        return false;
      }
      return true;
    }

    const result = await consumeRateLimits([
      [EMAIL_AUTH_LIMITS.sendPerEmail15m, email],
      [EMAIL_AUTH_LIMITS.sendPerEmailDay, email],
      [EMAIL_AUTH_LIMITS.sendPerIpHour, ip],
      [EMAIL_AUTH_LIMITS.sendPerIpDay, ip],
    ]);

    if (!result.allowed) {
      sendSignInError(req, res, rateLimitedError(result.retryAfterSeconds));
      return false;
    }

    return true;
  }

  if ('callback' === action) {
    const email = tryNormalizeEmail(req.query.email);

    if (!email || 'string' !== typeof req.query.token) {
      sendSignInError(req, res, 'Verification');
      return false;
    }

    const ipResult = await consumeRateLimits([[EMAIL_AUTH_LIMITS.verifyPerIpHour, ip]]);
    const emailResult = await consumeRateLimits([[EMAIL_AUTH_LIMITS.verifyPerEmail, email]]);

    if (!emailResult.allowed) {
      // Too many guesses for this code: burn it, a new code has to be requested
      await deleteVerificationTokens(email);
      sendSignInError(req, res, rateLimitedError(emailResult.retryAfterSeconds));
      return false;
    }

    if (!ipResult.allowed) {
      sendSignInError(req, res, rateLimitedError(ipResult.retryAfterSeconds));
      return false;
    }

    req.query.email = email;
    req.query.token = req.query.token.trim().toUpperCase();
  }

  return true;
}

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  if (!(await checkEmailSignIn(req, res))) {
    return;
  }

  await NextAuth(req, res, authOptions);
}
