-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitionId" TEXT NOT NULL,
    "asOfDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataExport_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DataExport_competitionId_asOfDate_idx" ON "DataExport"("competitionId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "DataExport_competitionId_asOfDate_kind_key" ON "DataExport"("competitionId", "asOfDate", "kind");
