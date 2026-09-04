/**
 * Deletes every row the seed created, and nothing else.
 *
 * This is what makes the demo data safe to ship: it is removable in one
 * command rather than by hand-picking rows out of a live database. Every seeded
 * row carries isDemo = true, and this deletes exactly that set.
 *
 * Child rows go first even though the schema cascades, because cascades are
 * only active when PRAGMA foreign_keys is ON — and that is per-connection.
 * Relying on it here would make the correctness of a destructive operation
 * depend on a pragma set somewhere else.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  // CI sets DATABASE_URL directly.
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

async function main() {
  const competitions = await db.competition.findMany({
    where: { isDemo: true },
    select: { id: true },
  });
  const competitionIds = competitions.map((c) => c.id);

  const participants = await db.participant.findMany({
    where: { isDemo: true },
    select: { id: true, portfolio: { select: { id: true } } },
  });
  const participantIds = participants.map((p) => p.id);
  const portfolioIds = participants.flatMap((p) => (p.portfolio ? [p.portfolio.id] : []));

  const counts: Record<string, number> = {};
  const record = async (label: string, run: Promise<{ count: number }>) => {
    counts[label] = (await run).count;
  };

  await record(
    "holdingValuations",
    db.holdingValuation.deleteMany({
      where: { valuation: { portfolioId: { in: portfolioIds } } },
    }),
  );
  await record(
    "valuations",
    db.portfolioValuation.deleteMany({
      where: { portfolioId: { in: portfolioIds } },
    }),
  );
  await record(
    "transactions",
    db.transaction.deleteMany({
      where: { portfolioId: { in: portfolioIds } },
    }),
  );
  await record(
    "rebalanceRequests",
    db.rebalanceRequest.deleteMany({
      where: { portfolioId: { in: portfolioIds } },
    }),
  );
  await record(
    "holdings",
    db.holding.deleteMany({
      where: { portfolioId: { in: portfolioIds } },
    }),
  );
  await record(
    "reportEntries",
    db.weeklyReportEntry.deleteMany({
      where: { participantId: { in: participantIds } },
    }),
  );
  await record(
    "snapshotEntries",
    db.leaderboardSnapshotEntry.deleteMany({
      where: { participantId: { in: participantIds } },
    }),
  );
  await record(
    "emailLogs",
    db.emailLog.deleteMany({
      where: { participantId: { in: participantIds } },
    }),
  );
  await record(
    "reports",
    db.weeklyReport.deleteMany({
      where: { competitionId: { in: competitionIds } },
    }),
  );
  await record(
    "snapshots",
    db.leaderboardSnapshot.deleteMany({
      where: { competitionId: { in: competitionIds } },
    }),
  );
  await record("portfolios", db.portfolio.deleteMany({ where: { id: { in: portfolioIds } } }));
  await record("participants", db.participant.deleteMany({ where: { isDemo: true } }));
  await record(
    "competitionStocks",
    db.competitionStock.deleteMany({
      where: { competitionId: { in: competitionIds } },
    }),
  );
  await record(
    "competitionSettings",
    db.competitionSettings.deleteMany({
      where: { competitionId: { in: competitionIds } },
    }),
  );
  await record(
    "tradingWindows",
    db.tradingWindow.deleteMany({
      where: { competitionId: { in: competitionIds } },
    }),
  );
  await record("competitions", db.competition.deleteMany({ where: { isDemo: true } }));
  await record(
    "priceHistory",
    db.priceHistory.deleteMany({
      where: { stock: { isDemo: true } },
    }),
  );
  await record("stocks", db.stock.deleteMany({ where: { isDemo: true } }));
  await record("sessions", db.session.deleteMany({ where: { user: { isDemo: true } } }));
  await record(
    "resetTokens",
    db.passwordResetToken.deleteMany({
      where: { user: { isDemo: true } },
    }),
  );
  await record("notifications", db.notification.deleteMany({ where: { user: { isDemo: true } } }));
  await record(
    "notificationPrefs",
    db.notificationPreference.deleteMany({
      where: { user: { isDemo: true } },
    }),
  );
  await record("users", db.user.deleteMany({ where: { isDemo: true } }));

  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) console.info(`  ${String(count).padStart(5)}  ${label}`);
  }
  console.info("Demo data removed. Re-create it with: make db-seed");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error("Clearing demo data failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
