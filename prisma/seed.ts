/**
 * Seeds a complete, believable competition so every screen has something real
 * on it the first time it is opened.
 *
 * Everything written here carries isDemo = true. `make db-clear-demo` deletes
 * exactly those rows, which is what makes this safe to ship and then remove
 * before production rather than a one-way decision.
 *
 * Run with `make db-seed`. Idempotent: re-running upserts by natural key
 * instead of duplicating, so it can be run against an existing database.
 */
import { hash } from "@node-rs/argon2";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { addDays, dateKeyOf, eachTradingDay } from "../src/lib/dates";
import { backfillPrices } from "../src/server/jobs/prices";
import { snapshotLeaderboard } from "../src/server/jobs/leaderboard";
import { snapshotValuations } from "../src/server/jobs/valuations";
import { commitRebalance } from "../src/server/portfolio/commit";
import { DEMO_STOCKS } from "./demo/stocks";
import { DEMO_PASSWORD, DEMO_PEOPLE } from "./demo/people";
import { DEMO_STRATEGIES } from "./demo/strategies";

try {
  process.loadEnvFile(".env");
} catch {
  // CI sets DATABASE_URL directly.
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const TIMEZONE = "Europe/Berlin";
const STARTING_CAPITAL_CENTS = 10_000_000n; // €100,000.00
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin1234";

/** Local-part is derived, so re-running the seed hits the same users. */
function emailFor(firstName: string, lastName: string): string {
  const strip = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z]/g, "")
      .toLowerCase();
  return `${strip(firstName)}.${strip(lastName)}@example.com`;
}

async function main() {
  const now = new Date();
  const today = dateKeyOf(now, TIMEZONE);

  // The competition is deliberately mid-flight: started six weeks ago, ends in
  // 23 days. A demo where the competition has not begun shows nothing but empty
  // states, which is exactly what the demo data exists to avoid.
  const startDate = addDays(today, -42);
  const endDate = addDays(today, 23);

  console.info(`Seeding demo data — competition ${startDate} → ${endDate}`);

  // ── Admin ──────────────────────────────────────────────────────────────────
  const adminHash = await hash(ADMIN_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", isDemo: true },
    create: {
      email: ADMIN_EMAIL,
      passwordHash: adminHash,
      firstName: "Ada",
      lastName: "Admin",
      department: "Finance",
      role: "ADMIN",
      isDemo: true,
    },
  });

  // ── Stocks ─────────────────────────────────────────────────────────────────
  const stocks = [];
  for (const s of DEMO_STOCKS) {
    stocks.push(
      await db.stock.upsert({
        where: { symbol: s.symbol },
        update: {
          name: s.name,
          sector: s.sector,
          // Refreshed on every seed, so correcting a ticker in the fixture is
          // picked up without a migration or a hand edit.
          providerSymbol: s.providerSymbol,
          isDemo: true,
        },
        create: {
          symbol: s.symbol,
          providerSymbol: s.providerSymbol,
          name: s.name,
          exchange: s.exchange,
          currency: s.currency,
          sector: s.sector,
          isDemo: true,
        },
      }),
    );
  }
  console.info(`  ${stocks.length} stocks`);

  // ── Competition ────────────────────────────────────────────────────────────
  const competition = await db.competition.upsert({
    where: { slug: "autumn-2026" },
    // Re-running the seed on a later day must move the window with it, or the
    // stored dates and the freshly computed ones drift apart and the backfill
    // prices a range the competition does not cover.
    update: {
      startsAt: new Date(`${startDate}T08:00:00Z`),
      endsAt: new Date(`${endDate}T17:30:00Z`),
      startDate,
      endDate,
    },
    create: {
      slug: "autumn-2026",
      name: "Autumn 2026 Stock Challenge",
      description:
        "Twelve weeks, €100,000 of virtual capital, and one question: who has the best investment strategy?",
      status: "RUNNING",
      registrationOpen: true,
      currency: "EUR",
      timezone: TIMEZONE,
      startingCapitalCents: STARTING_CAPITAL_CENTS,
      startsAt: new Date(`${startDate}T08:00:00Z`),
      endsAt: new Date(`${endDate}T17:30:00Z`),
      startDate,
      endDate,
      isDemo: true,
    },
  });

  await db.competitionSettings.upsert({
    where: { competitionId_revision: { competitionId: competition.id, revision: 1 } },
    update: {},
    create: {
      competitionId: competition.id,
      revision: 1,
      tradingMode: "ANYTIME",
      periodUnit: "WEEK",
      maxChangesPerPeriod: 1,
      maxPositionPpm: 300_000, // 30%
      minPositionPpm: 0,
      allowCash: true,
      maxCashPpm: 1_000_000,
      allowFractionalShares: true,
      feeModel: "NONE",
      priceMode: "LAST_CLOSE",
    },
  });

  for (const [i, stock] of stocks.entries()) {
    await db.competitionStock.upsert({
      where: { competitionId_stockId: { competitionId: competition.id, stockId: stock.id } },
      update: { sortOrder: i },
      create: { competitionId: competition.id, stockId: stock.id, sortOrder: i },
    });
  }

  // ── Participants ───────────────────────────────────────────────────────────
  const demoHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  let created = 0;
  for (const person of DEMO_PEOPLE) {
    const email = emailFor(person.firstName, person.lastName);
    const user = await db.user.upsert({
      where: { email },
      update: { isDemo: true },
      create: {
        email,
        passwordHash: demoHash,
        firstName: person.firstName,
        lastName: person.lastName,
        department: person.department,
        role: "PARTICIPANT",
        isDemo: true,
      },
    });

    const participant = await db.participant.upsert({
      where: { userId_competitionId: { userId: user.id, competitionId: competition.id } },
      update: {},
      create: {
        userId: user.id,
        competitionId: competition.id,
        displayName: `${person.firstName} ${person.lastName.charAt(0)}.`,
        initialCapitalCents: STARTING_CAPITAL_CENTS,
        status: "REGISTERED",
        joinedAt: new Date(`${startDate}T09:00:00Z`),
        isDemo: true,
      },
    });

    // The portfolio starts as DRAFT holding 100% cash, with the funding row
    // already in the ledger. Phase 2 gives it prices and an allocation; until
    // then cash + holdings still reconciles to the ledger, which is the point.
    const existing = await db.portfolio.findUnique({ where: { participantId: participant.id } });
    if (!existing) {
      await db.$transaction(async (tx) => {
        const portfolio = await tx.portfolio.create({
          data: {
            participantId: participant.id,
            competitionId: competition.id,
            status: "DRAFT",
            initialCapitalCents: STARTING_CAPITAL_CENTS,
            cashCents: STARTING_CAPITAL_CENTS,
            transactionSeq: 1,
          },
        });
        await tx.transaction.create({
          data: {
            portfolioId: portfolio.id,
            participantId: participant.id,
            sequence: 1,
            type: "INITIAL_FUNDING",
            tradeDate: startDate,
            executedAt: new Date(`${startDate}T08:00:00Z`),
            cashDeltaCents: STARTING_CAPITAL_CENTS,
            cashAfterCents: STARTING_CAPITAL_CENTS,
            isExternalFlow: true,
            note: "Starting virtual capital",
            isDemo: true,
          },
        });
      });
      created++;
    }
  }

  console.info(`  ${DEMO_PEOPLE.length} participants (${created} newly funded)`);

  // ── Price history ──────────────────────────────────────────────────────────
  // Written before anything is allocated, because a rebalance is priced at the
  // close of the day it happens on and there is nothing to price against
  // otherwise.
  const log = (message: string) => console.info(`  ${message}`);
  const ctx = { db, runKey: "seed", log };

  await backfillPrices(ctx, {
    from: startDate,
    to: today,
    anchorDate: startDate,
    // The hand-tuned anchors and volatilities from the fixture, so the demo
    // market has a believable spread rather than eighteen identical walks.
    profiles: DEMO_STOCKS.map((s) => ({
      symbol: s.symbol,
      anchorCents: s.anchorCents,
      driftBps: s.driftBps,
      volBps: s.volBps,
    })),
  });

  // ── Allocations ────────────────────────────────────────────────────────────
  const stockIdBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));
  const participants = await db.participant.findMany({
    where: { competitionId: competition.id, isDemo: true },
    include: { portfolio: { select: { id: true, setupCompletedAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Allocation dates are picked from the actual trading days, not from raw day
  // offsets: an offset landing on a weekend — or before the first priced day —
  // has no close to trade against, and the rebalance is correctly refused.
  const openDays = eachTradingDay(startDate, today);

  // The last two are left entirely in cash on purpose. The leaderboard has to
  // show what an unranked entry looks like and the dashboard has to show its
  // empty state, without anyone having to construct that situation by hand.
  const uninvestedCount = 2;
  const investable = participants.slice(0, Math.max(0, participants.length - uninvestedCount));

  let allocated = 0;
  for (const [index, participant] of investable.entries()) {
    if (!participant.portfolio || participant.portfolio.setupCompletedAt !== null) continue;

    const strategy = DEMO_STRATEGIES[index % DEMO_STRATEGIES.length];
    if (!strategy) continue;

    const targets = Object.entries(strategy.weights).flatMap(([symbol, weightPpm]) => {
      const stockId = stockIdBySymbol.get(symbol);
      return stockId ? [{ stockId, weightPpm }] : [];
    });

    // Staggered over the first two trading weeks, so the demo has people who
    // joined late and a ranking history with actual movement in it.
    //
    // The stride is 1, not 2, on purpose. There are 15 strategies, so
    // participants i and i+15 share one; with a stride of 2 they also shared an
    // allocation date, which made their portfolios byte-identical and filled
    // the leaderboard with exact ties that looked fabricated. A stride of 1
    // shifts them five days apart instead.
    const allocationDate = openDays[index % Math.min(10, openDays.length)] ?? openDays[0];
    if (!allocationDate) break;
    const result = await commitRebalance(db, {
      portfolioId: participant.portfolio.id,
      targets,
      idempotencyKey: `seed:${participant.id}`,
      periodKey: null,
      asOfDate: allocationDate,
      executedAt: new Date(`${allocationDate}T10:00:00Z`),
    });

    if (!result.ok) {
      console.error(
        `  ! ${participant.displayName} (${strategy.label}) was rejected: ` +
          result.errors.map((e) => e.code).join(", "),
      );
      continue;
    }
    allocated++;
  }
  console.info(
    `  ${allocated} portfolios allocated across ${DEMO_STRATEGIES.length} strategies, ` +
      `${uninvestedCount} left uninvested to exercise the unranked path`,
  );

  // ── Valuations and standings ───────────────────────────────────────────────
  const tradingDays = eachTradingDay(startDate, today);
  for (const day of tradingDays) {
    await snapshotValuations(
      { ...ctx, log: () => {} },
      {
        competitionId: competition.id,
        asOfDate: day,
      },
    );
  }
  console.info(`  valued every portfolio across ${tradingDays.length} trading days`);

  let snapshots = 0;
  for (const day of tradingDays) {
    await snapshotLeaderboard(
      { ...ctx, log: () => {} },
      {
        competitionId: competition.id,
        asOfDate: day,
        kind: "DAILY",
      },
    );
    snapshots++;
    const isSunday = new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
    const isLast = day === tradingDays[tradingDays.length - 1];
    if (isSunday || isLast || new Date(`${day}T00:00:00Z`).getUTCDay() === 5) {
      await snapshotLeaderboard(
        { ...ctx, log: () => {} },
        {
          competitionId: competition.id,
          asOfDate: day,
          kind: "WEEKLY",
        },
      );
      snapshots++;
    }
  }
  console.info(`  ${snapshots} leaderboard snapshots`);

  const finalSnapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: {
      entries: {
        where: { rank: { not: null } },
        orderBy: { displayOrder: "asc" },
        take: 3,
        include: { participant: { select: { displayName: true } } },
      },
    },
  });
  if (finalSnapshot) {
    console.info("");
    console.info("  Leaderboard:");
    for (const entry of finalSnapshot.entries) {
      console.info(
        `    ${String(entry.rank).padStart(2)}. ${entry.participant.displayName.padEnd(12)} ` +
          `${(entry.totalReturnPpm / 10_000).toFixed(2).padStart(7)}%`,
      );
    }
  }

  console.info("");
  console.info("  Sign in with:");
  console.info(`    admin        ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.info(`    participant  ${emailFor("Sarah", "Weber")} / ${DEMO_PASSWORD}`);
  console.info("");
  console.info(`  Admin user id: ${admin.id}`);
  console.info("Demo data seeded. Remove it with: make db-clear-demo");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error("Seed failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
