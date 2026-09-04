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
import { addDays, dateKeyOf } from "../src/lib/dates";
import { DEMO_STOCKS } from "./demo/stocks";
import { DEMO_PASSWORD, DEMO_PEOPLE } from "./demo/people";

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
        update: { name: s.name, sector: s.sector, isDemo: true },
        create: {
          symbol: s.symbol,
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
    update: {},
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
