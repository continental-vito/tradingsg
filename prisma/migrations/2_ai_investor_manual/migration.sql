-- The AI investor is traded by hand from /admin/ai rather than by a model on
-- a schedule, so the model choice, the on/off switch and the decision log go.
-- Only data written by the automatic runs is dropped; no ledger row is touched.

-- DropForeignKey
ALTER TABLE "AiInvestorRun" DROP CONSTRAINT "AiInvestorRun_aiInvestorId_fkey";

-- AlterTable
ALTER TABLE "AiInvestor" DROP COLUMN "isEnabled",
DROP COLUMN "lastRunAt",
DROP COLUMN "model";

-- DropTable
DROP TABLE "AiInvestorRun";

