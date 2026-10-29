-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "preLaunchClosesOn" TEXT,
ADD COLUMN     "preLaunchOpensOn" TEXT;


-- Data: the current competition becomes a pre-launch with these dates —
--   2 November   portfolio building opens
--   6 November   last day to build or change a portfolio
--   9 November   every queued order executes at the close, and portfolios are
--                valued for the first time
-- and its transaction cost becomes 0.5%.
--
-- "Current" is what every admin page shows: the most recent competition that is
-- not deleted, not ended, and runs past 9 November. Nothing else is touched.
--
-- Kept: every account, participant, portfolio, holding and ledger row, and the
-- login answers. Removed: the valuations, leaderboard snapshots and weekly
-- reports computed before the start, which describe a period that is no longer
-- part of the competition, and the job records for them, so the nightly jobs
-- rebuild from 9 November. All of it is derived and is recomputed from the
-- ledger. On an empty database nothing matches and this is a no-op.
CREATE TEMP TABLE "_start_nov9" AS
SELECT "id", "slug"
FROM "Competition"
WHERE "deletedAt" IS NULL AND "status" <> 'ENDED' AND "endDate" > '2026-11-09'
ORDER BY "startsAt" DESC
LIMIT 1;

DELETE FROM "WeeklyReport" WHERE "competitionId" IN (SELECT "id" FROM "_start_nov9");
DELETE FROM "LeaderboardSnapshot" WHERE "competitionId" IN (SELECT "id" FROM "_start_nov9");
DELETE FROM "PortfolioValuation" WHERE "competitionId" IN (SELECT "id" FROM "_start_nov9");
DELETE FROM "JobRun"
WHERE "jobName" IN (
    'snapshot-valuations', 'snapshot-leaderboard', 'build-weekly-report', 'launch-competitions'
  )
  AND split_part("runKey", ':', 1) IN (SELECT "slug" FROM "_start_nov9");

-- The fee, as a new rules revision with everything else carried over.
WITH "current" AS (
  SELECT s.*
  FROM "CompetitionSettings" s
  WHERE s."competitionId" IN (SELECT "id" FROM "_start_nov9")
    AND s."supersededAt" IS NULL
    AND s."revision" = (
      SELECT MAX(r."revision") FROM "CompetitionSettings" r WHERE r."competitionId" = s."competitionId"
    )
), "superseded" AS (
  UPDATE "CompetitionSettings"
  SET "supersededAt" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT "id" FROM "current")
  RETURNING "id"
)
INSERT INTO "CompetitionSettings" (
  "id", "competitionId", "revision", "effectiveFrom", "supersededAt", "tradingMode",
  "periodUnit", "maxChangesPerPeriod", "periodOpenDays", "lockAfterDate",
  "allowTradingBeforeStart", "minPositionPpm", "maxPositionPpm", "minPositionCents",
  "minPositions", "maxPositions", "allowCash", "minCashPpm", "maxCashPpm",
  "cashToleranceCents", "allowFractionalShares", "minTradeMicroShares",
  "minTradeValueCents", "feeModel", "feeFlatCents", "feeBps", "feeMinCents",
  "feeMaxCents", "priceMode", "maxPriceStalenessDays", "maxQuoteAgeSeconds",
  "allowShort", "allowNegativeCash", "maxShortPositionPpm", "maxGrossExposurePpm",
  "weeklyReportEnabled", "leaderboardVisibility", "leaderboardTopN",
  "showOthersHoldings", "notifyCompetitionStart", "notifySetupDeadline",
  "notifyWeeklyReport", "notifyEnteredTopThree", "notifyOvertaken",
  "notifyCompetitionEnd", "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || s."id"), s."competitionId",
  s."revision" + 1, CURRENT_TIMESTAMP, NULL, s."tradingMode", s."periodUnit",
  s."maxChangesPerPeriod", s."periodOpenDays", s."lockAfterDate",
  s."allowTradingBeforeStart", s."minPositionPpm", s."maxPositionPpm",
  s."minPositionCents", s."minPositions", s."maxPositions", s."allowCash",
  s."minCashPpm", s."maxCashPpm", s."cashToleranceCents", s."allowFractionalShares",
  s."minTradeMicroShares", s."minTradeValueCents",
  CASE WHEN s."feeModel" = 'NONE' THEN 'PERCENT' ELSE s."feeModel" END, s."feeFlatCents",
  50, s."feeMinCents", s."feeMaxCents", s."priceMode", s."maxPriceStalenessDays",
  s."maxQuoteAgeSeconds", s."allowShort", s."allowNegativeCash", s."maxShortPositionPpm",
  s."maxGrossExposurePpm", s."weeklyReportEnabled", s."leaderboardVisibility",
  s."leaderboardTopN", s."showOthersHoldings", s."notifyCompetitionStart",
  s."notifySetupDeadline", s."notifyWeeklyReport", s."notifyEnteredTopThree",
  s."notifyOvertaken", s."notifyCompetitionEnd", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "current" s;

UPDATE "Competition"
SET "preLaunch" = true,
    "launchedAt" = NULL,
    "preLaunchOpensOn" = '2026-11-02',
    "preLaunchClosesOn" = '2026-11-06',
    "startDate" = '2026-11-09',
    "startsAt" = '2026-11-09 08:00:00',
    "registrationOpen" = true,
    "status" = CASE WHEN "status" IN ('DRAFT', 'PAUSED') THEN "status" ELSE 'REGISTRATION' END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM "_start_nov9");

INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "afterJson", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || "id"),
       'competition.reschedule', 'Competition', "id",
       '{"preLaunchOpensOn":"2026-11-02","preLaunchClosesOn":"2026-11-06","startDate":"2026-11-09","feeBps":50,"by":"migration 6_prelaunch_window"}',
       CURRENT_TIMESTAMP
FROM "_start_nov9";

DROP TABLE "_start_nov9";
