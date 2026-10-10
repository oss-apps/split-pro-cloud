import { db } from '~/server/db';

export type RateLimitRule = {
  /** Unique prefix for this rule, e.g. `email-send:email:15m` */
  name: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Counts one hit for `key` under `rule` and reports whether it is still within the limit.
 * Fixed windows, stored in Postgres so they survive restarts and deploys.
 */
export async function consumeRateLimit(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<{ count: number; expiresAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart", "expiresAt")
    VALUES (${`${rule.name}:${key}`}, 1, NOW(), NOW() + make_interval(secs => ${rule.windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN NOW() ELSE "RateLimit"."windowStart" END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN EXCLUDED."expiresAt" ELSE "RateLimit"."expiresAt" END
    RETURNING "count", "expiresAt"
  `;

  // Opportunistic cleanup, there is no cron for this.
  db.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < NOW()`.catch(console.error);

  const row = rows[0];
  if (!row) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: row.count <= rule.limit,
    retryAfterSeconds: Math.max(0, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)),
  };
}

/**
 * Consumes every rule and returns the longest wait among the ones that were exceeded.
 */
export async function consumeRateLimits(checks: [RateLimitRule, string][]) {
  const results = await Promise.all(checks.map(([rule, key]) => consumeRateLimit(rule, key)));
  const blocked = results.filter((r) => !r.allowed);

  if (blocked.length === 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)),
  };
}

export async function resetRateLimit(rule: RateLimitRule, key: string) {
  await db.rateLimit.deleteMany({ where: { key: `${rule.name}:${key}` } });
}
