-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "yesLabel" TEXT NOT NULL DEFAULT 'Yes',
    "noLabel" TEXT NOT NULL DEFAULT 'No',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowChange" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAdjustment" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL,
    "ratePpm" INTEGER NOT NULL,
    "base" TEXT NOT NULL,
    "note" TEXT,
    "participantCount" INTEGER NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "appliedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyQuestion_isActive_sortOrder_idx" ON "SurveyQuestion"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "SurveyAnswer_userId_idx" ON "SurveyAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAnswer_questionId_userId_key" ON "SurveyAnswer"("questionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAdjustment_idempotencyKey_key" ON "SurveyAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SurveyAdjustment_competitionId_createdAt_idx" ON "SurveyAdjustment"("competitionId", "createdAt");

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAdjustment" ADD CONSTRAINT "SurveyAdjustment_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

