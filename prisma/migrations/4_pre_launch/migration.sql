-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "launchedAt" TIMESTAMP(3),
ADD COLUMN     "preLaunch" BOOLEAN NOT NULL DEFAULT false;

