-- CreateTable
CREATE TABLE "AiInvestor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInvestor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInvestorRun" (
    "id" TEXT NOT NULL,
    "aiInvestorId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT,
    "targetsJson" TEXT,
    "rebalanceRequestId" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInvestorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInvestor_userId_key" ON "AiInvestor"("userId");

-- CreateIndex
CREATE INDEX "AiInvestorRun_aiInvestorId_createdAt_idx" ON "AiInvestorRun"("aiInvestorId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiInvestor" ADD CONSTRAINT "AiInvestor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInvestorRun" ADD CONSTRAINT "AiInvestorRun_aiInvestorId_fkey" FOREIGN KEY ("aiInvestorId") REFERENCES "AiInvestor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

