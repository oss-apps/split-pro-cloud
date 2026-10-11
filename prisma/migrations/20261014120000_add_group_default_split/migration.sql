-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "defaultSplitAt" TIMESTAMP(3),
ADD COLUMN     "defaultSplitById" INTEGER,
ADD COLUMN     "defaultSplitShares" JSONB,
ADD COLUMN     "defaultSplitType" "SplitType";

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_defaultSplitById_fkey" FOREIGN KEY ("defaultSplitById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

