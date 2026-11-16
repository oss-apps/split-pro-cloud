import { type PrismaClient } from '@prisma/client';

import { backfillUserCreatedAt } from './backfillUserCreatedAt';

/**
 * Data migrations: changes to existing rows that are too slow or too involved for a SQL migration,
 * run in the background after the server starts (see `instrumentation.ts`).
 *
 * Like upstream SplitPro's runner, the version reached is kept in AppMetadata and each migration
 * runs once, in order, setting the version when it completes. The key is our own, not upstream's
 * `schema_version`, whose runner treats a missing value as a pre-2.0.0 database.
 *
 * A failing migration is logged and leaves the version as it was, so it runs again on the next
 * start; it never stops the server. Migrations must be safe to run again.
 */

export const DATA_VERSION_KEY = 'cloud_data_version';

type Db = Pick<PrismaClient, '$transaction' | '$queryRaw' | 'appMetadata'>;

export type DataMigration = {
  /** Semver-like, compared as strings like upstream's runner */
  version: string;
  name: string;
  run: (db: Db) => Promise<unknown>;
};

export const USER_CREATED_AT_BACKFILL_VERSION = '1.0.0';

export const DATA_MIGRATIONS: DataMigration[] = [
  {
    version: USER_CREATED_AT_BACKFILL_VERSION,
    name: 'Estimate User.createdAt',
    run: (db) => backfillUserCreatedAt(db),
  },
];

const getVersion = async (db: Db) =>
  (await db.appMetadata.findUnique({ where: { key: DATA_VERSION_KEY } }))?.value ?? null;

const setVersion = (db: Db, version: string) =>
  db.appMetadata.upsert({
    where: { key: DATA_VERSION_KEY },
    update: { value: version },
    create: { key: DATA_VERSION_KEY, value: version },
  });

/** Only an error's name and Prisma or Node code: messages can contain data. */
const safeErrorDetails = (error: unknown) => {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const { code } = error as { code?: unknown };
  return { name: error.name, code: 'string' === typeof code ? code : undefined };
};

/** Runs the pending data migrations. Never throws. */
export const runDataMigrations = async (db: Db, migrations = DATA_MIGRATIONS) => {
  try {
    const current = await getVersion(db);
    const pending = migrations.filter(({ version }) => null === current || version > current);

    // One after another: each one starts from the previous one's result
    for (const migration of pending) {
      const startedAt = Date.now();
      const result = await migration.run(db);
      await setVersion(db, migration.version);
      console.log(`Data migration ${migration.version} (${migration.name}) done`, {
        ms: Date.now() - startedAt,
        result,
      });
    }
    return true;
  } catch (error) {
    console.error('Data migration failed, will retry on next start', safeErrorDetails(error));
    return false;
  }
};
