import { type Prisma, type PrismaClient } from '@prisma/client';

/** The migration that added `User.createdAt`: rows created since then hold their exact time. */
export const CREATED_AT_MIGRATION = '20261117120000_add_user_created_at';

type Client = Pick<PrismaClient | Prisma.TransactionClient, '$queryRaw'>;

/**
 * When `User.createdAt` started being set on create: the time the migration finished. Null when
 * it's unknown (a database set up without migrations).
 */
export const getCreatedAtExactSince = async (client: Client) => {
  const [table] = await client.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS "exists"
  `;
  if (!table?.exists) {
    return null;
  }
  const [row] = await client.$queryRaw<{ finishedAt: Date | null }[]>`
    SELECT "finished_at" AS "finishedAt" FROM "_prisma_migrations"
    WHERE "migration_name" = ${CREATED_AT_MIGRATION} AND "rolled_back_at" IS NULL
    ORDER BY "finished_at" DESC NULLS LAST LIMIT 1
  `;
  return row?.finishedAt ?? null;
};
