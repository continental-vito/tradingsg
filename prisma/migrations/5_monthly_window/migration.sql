-- AlterTable
ALTER TABLE "CompetitionSettings" ADD COLUMN     "periodOpenDays" INTEGER;


-- Data: the house rule moves from one rebalance a week to one a month, open
-- only on the 1st to the 7th. Applied to every competition that is not over
-- and is still on the weekly one-change rule. Rules are revisioned, never
-- edited: the current row is superseded and a copy with the new period is
-- written as the next revision, exactly as saving the settings form would.
-- Every other rule is carried over unchanged. Nothing matches on an empty
-- database, so this is a no-op for a fresh install and the test suite.
WITH "current" AS (
  SELECT s.*
  FROM "CompetitionSettings" s
  JOIN "Competition" c ON c."id" = s."competitionId"
  WHERE s."supersededAt" IS NULL
    AND c."deletedAt" IS NULL
    AND c."status" <> 'ENDED'
    AND s."tradingMode" = 'ONCE_PER_PERIOD'
    AND s."periodUnit" = 'WEEK'
    AND s."maxChangesPerPeriod" = 1
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
  "periodUnit", "maxChangesPerPeriod", "lockAfterDate", "allowTradingBeforeStart",
  "minPositionPpm", "maxPositionPpm", "minPositionCents", "minPositions",
  "maxPositions", "allowCash", "minCashPpm", "maxCashPpm", "cashToleranceCents",
  "allowFractionalShares", "minTradeMicroShares", "minTradeValueCents", "feeModel",
  "feeFlatCents", "feeBps", "feeMinCents", "feeMaxCents", "priceMode",
  "maxPriceStalenessDays", "maxQuoteAgeSeconds", "allowShort", "allowNegativeCash",
  "maxShortPositionPpm", "maxGrossExposurePpm", "weeklyReportEnabled",
  "leaderboardVisibility", "leaderboardTopN", "showOthersHoldings",
  "notifyCompetitionStart", "notifySetupDeadline", "notifyWeeklyReport",
  "notifyEnteredTopThree", "notifyOvertaken", "notifyCompetitionEnd", "periodOpenDays",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || "id"), "competitionId",
  "revision" + 1, CURRENT_TIMESTAMP, NULL, "tradingMode", 'MONTH',
  "maxChangesPerPeriod", "lockAfterDate", "allowTradingBeforeStart", "minPositionPpm",
  "maxPositionPpm", "minPositionCents", "minPositions", "maxPositions", "allowCash",
  "minCashPpm", "maxCashPpm", "cashToleranceCents", "allowFractionalShares",
  "minTradeMicroShares", "minTradeValueCents", "feeModel", "feeFlatCents", "feeBps",
  "feeMinCents", "feeMaxCents", "priceMode", "maxPriceStalenessDays",
  "maxQuoteAgeSeconds", "allowShort", "allowNegativeCash", "maxShortPositionPpm",
  "maxGrossExposurePpm", "weeklyReportEnabled", "leaderboardVisibility",
  "leaderboardTopN", "showOthersHoldings", "notifyCompetitionStart",
  "notifySetupDeadline", "notifyWeeklyReport", "notifyEnteredTopThree",
  "notifyOvertaken", "notifyCompetitionEnd", 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "current";
