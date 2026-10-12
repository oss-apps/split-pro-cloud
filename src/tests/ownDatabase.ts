import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

let prepared: Promise<string> | undefined;

/**
 * A database of this test file's own, next to TEST_DATABASE_URL (`<name>_<suffix>`), created and
 * migrated on first use. Test files run in parallel; serializable transactions in one file would
 * otherwise make unrelated tests in other files fail to serialize now and then.
 */
export const getOwnTestDatabase = (baseUrl: string, suffix: string) => {
  prepared ??= (async () => {
    const url = new URL(baseUrl);
    const name = `${url.pathname.slice(1)}_${suffix}`;
    assert.match(name, /test/i, 'Refusing to use a non-test database');
    assert.match(name, /^\w+$/, 'Unexpected database name');
    url.pathname = `/${name}`;

    const { PrismaClient } = await import('@prisma/client');
    const admin = new PrismaClient({ datasourceUrl: baseUrl });
    try {
      const existing = await admin.$queryRaw<unknown[]>`
        SELECT 1 FROM pg_database WHERE datname = ${name}`;
      if (!existing.length) {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`).catch((error: unknown) => {
          // Created by a parallel run in the meantime.
          if (!/already exists/.test(String(error))) throw error;
        });
      }
    } finally {
      await admin.$disconnect();
    }

    execFileSync(
      path.join(process.cwd(), 'node_modules', '.bin', 'prisma'),
      ['migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      },
    );
    return url.toString();
  })();
  return prepared;
};
