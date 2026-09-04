import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * A private database per test suite.
 *
 * Real SQLite rather than a mock, because the things most worth testing here
 * are unique indexes, cascade behaviour and integer identities — and a mock has
 * none of them. Migrations are applied with `prisma migrate deploy` so the test
 * runs against the same DDL production will.
 */
export interface TestDb {
  db: PrismaClient;
  cleanup: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "tradingsg-test-"));
  const file = join(dir, "test.db");
  const url = `file:${file}`;

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  // Cascades in the schema are inert unless this is on, and it is per-connection.
  await db.$executeRawUnsafe("PRAGMA foreign_keys = ON;");

  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A funded participant with a portfolio, which is the precondition for most tests. */
export async function seedParticipant(
  db: PrismaClient,
  competitionId: string,
  email: string,
  capitalCents = 10_000_000n,
) {
  const user = await db.user.create({
    data: {
      email,
      passwordHash: "not-a-real-hash",
      firstName: email.split("@")[0] ?? "Test",
      lastName: "User",
    },
  });
  const participant = await db.participant.create({
    data: {
      userId: user.id,
      competitionId,
      displayName: user.firstName,
      initialCapitalCents: capitalCents,
    },
  });
  const portfolio = await db.portfolio.create({
    data: {
      participantId: participant.id,
      competitionId,
      initialCapitalCents: capitalCents,
      cashCents: capitalCents,
      transactionSeq: 1,
    },
  });
  await db.transaction.create({
    data: {
      portfolioId: portfolio.id,
      participantId: participant.id,
      sequence: 1,
      type: "INITIAL_FUNDING",
      tradeDate: "2026-07-24",
      cashDeltaCents: capitalCents,
      cashAfterCents: capitalCents,
      isExternalFlow: true,
    },
  });
  return { user, participant, portfolio };
}

export async function seedCompetition(db: PrismaClient, slug = "test-cup") {
  return db.competition.create({
    data: {
      slug,
      name: "Test Cup",
      status: "RUNNING",
      startsAt: new Date("2026-07-24T08:00:00Z"),
      endsAt: new Date("2026-09-27T17:30:00Z"),
      startDate: "2026-07-24",
      endDate: "2026-09-27",
    },
  });
}
