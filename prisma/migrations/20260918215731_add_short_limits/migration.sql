-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompetitionSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" DATETIME,
    "tradingMode" TEXT NOT NULL DEFAULT 'ANYTIME',
    "periodUnit" TEXT NOT NULL DEFAULT 'WEEK',
    "maxChangesPerPeriod" INTEGER NOT NULL DEFAULT 1,
    "lockAfterDate" TEXT,
    "allowTradingBeforeStart" BOOLEAN NOT NULL DEFAULT true,
    "minPositionPpm" INTEGER NOT NULL DEFAULT 0,
    "maxPositionPpm" INTEGER NOT NULL DEFAULT 300000,
    "minPositionCents" BIGINT NOT NULL DEFAULT 0,
    "minPositions" INTEGER NOT NULL DEFAULT 0,
    "maxPositions" INTEGER,
    "allowCash" BOOLEAN NOT NULL DEFAULT true,
    "minCashPpm" INTEGER NOT NULL DEFAULT 0,
    "maxCashPpm" INTEGER NOT NULL DEFAULT 1000000,
    "cashToleranceCents" BIGINT NOT NULL DEFAULT 100,
    "allowFractionalShares" BOOLEAN NOT NULL DEFAULT true,
    "minTradeMicroShares" BIGINT NOT NULL DEFAULT 1000,
    "minTradeValueCents" BIGINT NOT NULL DEFAULT 100,
    "feeModel" TEXT NOT NULL DEFAULT 'NONE',
    "feeFlatCents" BIGINT NOT NULL DEFAULT 0,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeMinCents" BIGINT NOT NULL DEFAULT 0,
    "feeMaxCents" BIGINT,
    "priceMode" TEXT NOT NULL DEFAULT 'LAST_CLOSE',
    "maxPriceStalenessDays" INTEGER NOT NULL DEFAULT 7,
    "maxQuoteAgeSeconds" INTEGER NOT NULL DEFAULT 900,
    "allowShort" BOOLEAN NOT NULL DEFAULT false,
    "allowNegativeCash" BOOLEAN NOT NULL DEFAULT false,
    "maxShortPositionPpm" INTEGER NOT NULL DEFAULT 200000,
    "maxGrossExposurePpm" INTEGER NOT NULL DEFAULT 1500000,
    "weeklyReportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leaderboardVisibility" TEXT NOT NULL DEFAULT 'ALL',
    "leaderboardTopN" INTEGER,
    "showOthersHoldings" BOOLEAN NOT NULL DEFAULT false,
    "notifyCompetitionStart" BOOLEAN NOT NULL DEFAULT true,
    "notifySetupDeadline" BOOLEAN NOT NULL DEFAULT true,
    "notifyWeeklyReport" BOOLEAN NOT NULL DEFAULT true,
    "notifyEnteredTopThree" BOOLEAN NOT NULL DEFAULT true,
    "notifyOvertaken" BOOLEAN NOT NULL DEFAULT false,
    "notifyCompetitionEnd" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompetitionSettings_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompetitionSettings" ("allowCash", "allowFractionalShares", "allowNegativeCash", "allowShort", "allowTradingBeforeStart", "cashToleranceCents", "competitionId", "createdAt", "effectiveFrom", "feeBps", "feeFlatCents", "feeMaxCents", "feeMinCents", "feeModel", "id", "leaderboardTopN", "leaderboardVisibility", "lockAfterDate", "maxCashPpm", "maxChangesPerPeriod", "maxPositionPpm", "maxPositions", "maxPriceStalenessDays", "maxQuoteAgeSeconds", "minCashPpm", "minPositionCents", "minPositionPpm", "minPositions", "minTradeMicroShares", "minTradeValueCents", "notifyCompetitionEnd", "notifyCompetitionStart", "notifyEnteredTopThree", "notifyOvertaken", "notifySetupDeadline", "notifyWeeklyReport", "periodUnit", "priceMode", "revision", "showOthersHoldings", "supersededAt", "tradingMode", "updatedAt", "weeklyReportEnabled") SELECT "allowCash", "allowFractionalShares", "allowNegativeCash", "allowShort", "allowTradingBeforeStart", "cashToleranceCents", "competitionId", "createdAt", "effectiveFrom", "feeBps", "feeFlatCents", "feeMaxCents", "feeMinCents", "feeModel", "id", "leaderboardTopN", "leaderboardVisibility", "lockAfterDate", "maxCashPpm", "maxChangesPerPeriod", "maxPositionPpm", "maxPositions", "maxPriceStalenessDays", "maxQuoteAgeSeconds", "minCashPpm", "minPositionCents", "minPositionPpm", "minPositions", "minTradeMicroShares", "minTradeValueCents", "notifyCompetitionEnd", "notifyCompetitionStart", "notifyEnteredTopThree", "notifyOvertaken", "notifySetupDeadline", "notifyWeeklyReport", "periodUnit", "priceMode", "revision", "showOthersHoldings", "supersededAt", "tradingMode", "updatedAt", "weeklyReportEnabled" FROM "CompetitionSettings";
DROP TABLE "CompetitionSettings";
ALTER TABLE "new_CompetitionSettings" RENAME TO "CompetitionSettings";
CREATE INDEX "CompetitionSettings_competitionId_supersededAt_idx" ON "CompetitionSettings"("competitionId", "supersededAt");
CREATE UNIQUE INDEX "CompetitionSettings_competitionId_revision_key" ON "CompetitionSettings"("competitionId", "revision");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
