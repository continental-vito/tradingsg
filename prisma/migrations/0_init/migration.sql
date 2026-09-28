-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "department" TEXT,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PARTICIPANT',
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "startingCapitalCents" BIGINT NOT NULL DEFAULT 10000000,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionSettings" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingWindow" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "providerSymbol" TEXT,
    "name" TEXT NOT NULL,
    "exchange" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sector" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastPriceCents" BIGINT,
    "lastPriceAt" TIMESTAMP(3),
    "lastPriceSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionStock" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "isTradable" BOOLEAN NOT NULL DEFAULT true,
    "maxWeightPpm" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "closeCents" BIGINT NOT NULL,
    "openCents" BIGINT,
    "highCents" BIGINT,
    "lowCents" BIGINT,
    "prevCloseCents" BIGINT,
    "volume" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'mock',
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "initialCapitalCents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "adjustedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "disqualifiedReason" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "initialCapitalCents" BIGINT NOT NULL,
    "cashCents" BIGINT NOT NULL,
    "costBasisCents" BIGINT NOT NULL DEFAULT 0,
    "realizedPnlCents" BIGINT NOT NULL DEFAULT 0,
    "totalFeesCents" BIGINT NOT NULL DEFAULT 0,
    "netFlowCents" BIGINT NOT NULL DEFAULT 0,
    "transactionSeq" INTEGER NOT NULL DEFAULT 0,
    "rebalanceCount" INTEGER NOT NULL DEFAULT 0,
    "setupCompletedAt" TIMESTAMP(3),
    "lastRebalancedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "microShares" BIGINT NOT NULL DEFAULT 0,
    "costBasisCents" BIGINT NOT NULL DEFAULT 0,
    "realizedPnlCents" BIGINT NOT NULL DEFAULT 0,
    "firstBoughtAt" TIMESTAMP(3),
    "lastTradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebalanceRequest" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "periodKey" TEXT,
    "targetsJson" TEXT NOT NULL,
    "quotesJson" TEXT NOT NULL,
    "planJson" TEXT,
    "errorsJson" TEXT,
    "preValueCents" BIGINT,
    "postValueCents" BIGINT,
    "totalFeeCents" BIGINT NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RebalanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "stockId" TEXT,
    "rebalanceRequestId" TEXT,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "microShareDelta" BIGINT NOT NULL DEFAULT 0,
    "priceCents" BIGINT NOT NULL DEFAULT 0,
    "grossCents" BIGINT NOT NULL DEFAULT 0,
    "feeCents" BIGINT NOT NULL DEFAULT 0,
    "cashDeltaCents" BIGINT NOT NULL,
    "costAddedCents" BIGINT NOT NULL DEFAULT 0,
    "costRemovedCents" BIGINT NOT NULL DEFAULT 0,
    "realizedPnlCents" BIGINT NOT NULL DEFAULT 0,
    "cashAfterCents" BIGINT NOT NULL,
    "microSharesAfter" BIGINT NOT NULL DEFAULT 0,
    "isExternalFlow" BOOLEAN NOT NULL DEFAULT false,
    "prevAllocationPpm" INTEGER,
    "newAllocationPpm" INTEGER,
    "note" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioValuation" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "asOfAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "cashCents" BIGINT NOT NULL,
    "holdingsValueCents" BIGINT NOT NULL,
    "totalValueCents" BIGINT NOT NULL,
    "initialCapitalCents" BIGINT NOT NULL,
    "netFlowCents" BIGINT NOT NULL DEFAULT 0,
    "flowInPeriodCents" BIGINT NOT NULL DEFAULT 0,
    "costBasisCents" BIGINT NOT NULL,
    "realizedPnlCents" BIGINT NOT NULL,
    "unrealizedPnlCents" BIGINT NOT NULL,
    "cumulativeFeesCents" BIGINT NOT NULL DEFAULT 0,
    "totalReturnPpm" INTEGER NOT NULL,
    "twrPpm" INTEGER NOT NULL,
    "dailyReturnPpm" INTEGER,
    "weeklyReturnPpm" INTEGER,
    "periodReturnPpm" INTEGER,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "priceQuality" TEXT NOT NULL DEFAULT 'OK',
    "stalePriceCount" INTEGER NOT NULL DEFAULT 0,
    "isRankEligible" BOOLEAN NOT NULL DEFAULT true,
    "previousValuationId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldingValuation" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "microShares" BIGINT NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "priceAgeDays" INTEGER NOT NULL DEFAULT 0,
    "marketValueCents" BIGINT NOT NULL,
    "costBasisCents" BIGINT NOT NULL,
    "unrealizedPnlCents" BIGINT NOT NULL,
    "realizedPnlCents" BIGINT NOT NULL DEFAULT 0,
    "weightPpm" INTEGER NOT NULL,
    "positionReturnPpm" INTEGER NOT NULL,
    "dayChangePpm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldingValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "asOfAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "weekNumber" INTEGER,
    "periodStartDate" TEXT,
    "participantCount" INTEGER NOT NULL,
    "rankedCount" INTEGER NOT NULL,
    "totalAumCents" BIGINT NOT NULL,
    "medianReturnPpm" INTEGER NOT NULL,
    "bestReturnPpm" INTEGER NOT NULL,
    "worstReturnPpm" INTEGER NOT NULL,
    "priceQuality" TEXT NOT NULL DEFAULT 'OK',
    "previousSnapshotId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "valuationId" TEXT,
    "isRanked" BOOLEAN NOT NULL DEFAULT true,
    "unrankedReason" TEXT,
    "rank" INTEGER,
    "displayOrder" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "rankChange" INTEGER,
    "isNewEntry" BOOLEAN NOT NULL DEFAULT false,
    "tieBreakKey" TEXT NOT NULL,
    "totalValueCents" BIGINT NOT NULL,
    "totalReturnPpm" INTEGER NOT NULL,
    "periodReturnPpm" INTEGER,
    "dailyReturnPpm" INTEGER,
    "weeklyReturnPpm" INTEGER,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "periodStartDate" TEXT NOT NULL,
    "periodEndDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "snapshotId" TEXT NOT NULL,
    "previousSnapshotId" TEXT,
    "subject" TEXT NOT NULL,
    "introMessage" TEXT,
    "templateKey" TEXT NOT NULL DEFAULT 'weekly-v1',
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "showLeaderboard" BOOLEAN NOT NULL DEFAULT true,
    "showIndividual" BOOLEAN NOT NULL DEFAULT true,
    "leaderboardSize" INTEGER NOT NULL DEFAULT 10,
    "sharedHtml" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReportEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "rank" INTEGER,
    "previousRank" INTEGER,
    "rankChange" INTEGER,
    "isRanked" BOOLEAN NOT NULL DEFAULT true,
    "totalValueCents" BIGINT NOT NULL,
    "weeklyPnlCents" BIGINT NOT NULL DEFAULT 0,
    "totalPnlCents" BIGINT NOT NULL DEFAULT 0,
    "weeklyReturnPpm" INTEGER NOT NULL DEFAULT 0,
    "totalReturnPpm" INTEGER NOT NULL DEFAULT 0,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "tradesThisWeek" INTEGER NOT NULL DEFAULT 0,
    "bestStockId" TEXT,
    "bestSymbol" TEXT,
    "bestContributionCents" BIGINT,
    "bestReturnPpm" INTEGER,
    "worstStockId" TEXT,
    "worstSymbol" TEXT,
    "worstContributionCents" BIGINT,
    "worstReturnPpm" INTEGER,
    "payloadJson" TEXT NOT NULL,
    "renderedSubject" TEXT NOT NULL,
    "renderedHtml" TEXT NOT NULL,
    "renderedText" TEXT,
    "contentHash" TEXT NOT NULL,
    "sendStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "emailLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "reportId" TEXT,
    "participantId" TEXT,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "htmlPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "dataJson" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "resultJson" TEXT,
    "error" TEXT,
    "hostname" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isDisabled_idx" ON "User"("role", "isDisabled");

-- CreateIndex
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_consumedAt_idx" ON "PasswordResetToken"("userId", "consumedAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE INDEX "Competition_status_startsAt_idx" ON "Competition"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Competition_deletedAt_idx" ON "Competition"("deletedAt");

-- CreateIndex
CREATE INDEX "CompetitionSettings_competitionId_supersededAt_idx" ON "CompetitionSettings"("competitionId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionSettings_competitionId_revision_key" ON "CompetitionSettings"("competitionId", "revision");

-- CreateIndex
CREATE INDEX "TradingWindow_competitionId_opensAt_closesAt_idx" ON "TradingWindow"("competitionId", "opensAt", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_symbol_key" ON "Stock"("symbol");

-- CreateIndex
CREATE INDEX "Stock_isActive_symbol_idx" ON "Stock"("isActive", "symbol");

-- CreateIndex
CREATE INDEX "Stock_deletedAt_idx" ON "Stock"("deletedAt");

-- CreateIndex
CREATE INDEX "CompetitionStock_competitionId_isTradable_sortOrder_idx" ON "CompetitionStock"("competitionId", "isTradable", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionStock_competitionId_stockId_key" ON "CompetitionStock"("competitionId", "stockId");

-- CreateIndex
CREATE INDEX "PriceHistory_stockId_tradeDate_supersededAt_idx" ON "PriceHistory"("stockId", "tradeDate", "supersededAt");

-- CreateIndex
CREATE INDEX "PriceHistory_tradeDate_idx" ON "PriceHistory"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "PriceHistory_stockId_tradeDate_revision_key" ON "PriceHistory"("stockId", "tradeDate", "revision");

-- CreateIndex
CREATE INDEX "Participant_competitionId_status_idx" ON "Participant"("competitionId", "status");

-- CreateIndex
CREATE INDEX "Participant_deletedAt_idx" ON "Participant"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_userId_competitionId_key" ON "Participant"("userId", "competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_participantId_key" ON "Portfolio"("participantId");

-- CreateIndex
CREATE INDEX "Portfolio_competitionId_status_idx" ON "Portfolio"("competitionId", "status");

-- CreateIndex
CREATE INDEX "Holding_stockId_idx" ON "Holding"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_stockId_key" ON "Holding"("portfolioId", "stockId");

-- CreateIndex
CREATE UNIQUE INDEX "RebalanceRequest_idempotencyKey_key" ON "RebalanceRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RebalanceRequest_portfolioId_submittedAt_idx" ON "RebalanceRequest"("portfolioId", "submittedAt");

-- CreateIndex
CREATE INDEX "RebalanceRequest_status_idx" ON "RebalanceRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RebalanceRequest_portfolioId_periodKey_key" ON "RebalanceRequest"("portfolioId", "periodKey");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_executedAt_idx" ON "Transaction"("portfolioId", "executedAt");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_stockId_sequence_idx" ON "Transaction"("portfolioId", "stockId", "sequence");

-- CreateIndex
CREATE INDEX "Transaction_participantId_tradeDate_idx" ON "Transaction"("participantId", "tradeDate");

-- CreateIndex
CREATE INDEX "Transaction_rebalanceRequestId_idx" ON "Transaction"("rebalanceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_portfolioId_sequence_key" ON "Transaction"("portfolioId", "sequence");

-- CreateIndex
CREATE INDEX "PortfolioValuation_competitionId_asOfDate_kind_idx" ON "PortfolioValuation"("competitionId", "asOfDate", "kind");

-- CreateIndex
CREATE INDEX "PortfolioValuation_portfolioId_asOfAt_idx" ON "PortfolioValuation"("portfolioId", "asOfAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioValuation_portfolioId_asOfDate_kind_key" ON "PortfolioValuation"("portfolioId", "asOfDate", "kind");

-- CreateIndex
CREATE INDEX "HoldingValuation_stockId_idx" ON "HoldingValuation"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "HoldingValuation_valuationId_stockId_key" ON "HoldingValuation"("valuationId", "stockId");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_competitionId_kind_asOfDate_idx" ON "LeaderboardSnapshot"("competitionId", "kind", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardSnapshot_competitionId_asOfDate_kind_key" ON "LeaderboardSnapshot"("competitionId", "asOfDate", "kind");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotEntry_snapshotId_displayOrder_idx" ON "LeaderboardSnapshotEntry"("snapshotId", "displayOrder");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotEntry_snapshotId_rank_idx" ON "LeaderboardSnapshotEntry"("snapshotId", "rank");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotEntry_participantId_idx" ON "LeaderboardSnapshotEntry"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardSnapshotEntry_snapshotId_participantId_key" ON "LeaderboardSnapshotEntry"("snapshotId", "participantId");

-- CreateIndex
CREATE INDEX "WeeklyReport_competitionId_status_idx" ON "WeeklyReport"("competitionId", "status");

-- CreateIndex
CREATE INDEX "WeeklyReport_status_scheduledFor_idx" ON "WeeklyReport"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_competitionId_isoWeek_revision_key" ON "WeeklyReport"("competitionId", "isoWeek", "revision");

-- CreateIndex
CREATE INDEX "WeeklyReportEntry_reportId_sendStatus_idx" ON "WeeklyReportEntry"("reportId", "sendStatus");

-- CreateIndex
CREATE INDEX "WeeklyReportEntry_reportId_rank_idx" ON "WeeklyReportEntry"("reportId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReportEntry_reportId_participantId_key" ON "WeeklyReportEntry"("reportId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_dedupeKey_key" ON "EmailLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailLog_status_queuedAt_idx" ON "EmailLog"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "EmailLog_reportId_idx" ON "EmailLog"("reportId");

-- CreateIndex
CREATE INDEX "EmailLog_toEmail_createdAt_idx" ON "EmailLog"("toEmail", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_channel_key" ON "NotificationPreference"("userId", "type", "channel");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_heartbeatAt_idx" ON "JobRun"("status", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobName_runKey_key" ON "JobRun"("jobName", "runKey");

-- CreateIndex
CREATE INDEX "DataExport_competitionId_asOfDate_idx" ON "DataExport"("competitionId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "DataExport_competitionId_asOfDate_kind_key" ON "DataExport"("competitionId", "asOfDate", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionSettings" ADD CONSTRAINT "CompetitionSettings_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingWindow" ADD CONSTRAINT "TradingWindow_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionStock" ADD CONSTRAINT "CompetitionStock_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionStock" ADD CONSTRAINT "CompetitionStock_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebalanceRequest" ADD CONSTRAINT "RebalanceRequest_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_rebalanceRequestId_fkey" FOREIGN KEY ("rebalanceRequestId") REFERENCES "RebalanceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioValuation" ADD CONSTRAINT "PortfolioValuation_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioValuation" ADD CONSTRAINT "PortfolioValuation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioValuation" ADD CONSTRAINT "PortfolioValuation_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioValuation" ADD CONSTRAINT "PortfolioValuation_previousValuationId_fkey" FOREIGN KEY ("previousValuationId") REFERENCES "PortfolioValuation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingValuation" ADD CONSTRAINT "HoldingValuation_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "PortfolioValuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingValuation" ADD CONSTRAINT "HoldingValuation_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshotEntry" ADD CONSTRAINT "LeaderboardSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshotEntry" ADD CONSTRAINT "LeaderboardSnapshotEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshotEntry" ADD CONSTRAINT "LeaderboardSnapshotEntry_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "PortfolioValuation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportEntry" ADD CONSTRAINT "WeeklyReportEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportEntry" ADD CONSTRAINT "WeeklyReportEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WeeklyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

