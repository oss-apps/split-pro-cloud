-- Fail fast rather than queue every query on "User" behind this migration while the table is busy
SET lock_timeout = '5s';

-- Users had no creation time. Both statements only change the catalog, so they are instant:
-- existing rows stay NULL (estimated later by the backfillUserCreatedAt data migration in
-- src/migrations, which never touches a set value) and new rows get the time they are created.
-- If it times out, run `prisma migrate resolve --rolled-back 20261117120000_add_user_created_at`
-- and deploy again: both statements are safe to repeat.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);

ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
