import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * A private database per test suite.
 *
 * Real PostgreSQL rather than a mock, because the things most worth testing
 * here are unique indexes, cascade behaviour and BigInt identities — and a mock
 * has none of them. It is the same engine the deployment runs on, which is the
 * point: these tests used to run on SQLite while production ran on Postgres, so
 * every dialect difference was invisible until it reached Neon.
 *
 * PGlite is PostgreSQL compiled to WASM, in-process and in-memory. No server,
 * no port, no Docker, and a fresh instance costs about a second.
 *
 * The DDL is the committed migrations themselves, read rather than regenerated:
 * spawning the Prisma CLI per suite cost more than the database did, and
 * reading the files means the tests run against exactly the SQL that
 * `prisma migrate deploy` will apply to production. EVERY migration is applied,
 * in order — reading only the baseline would leave the tests a schema behind
 * the moment a second migration was added, and passing against the wrong DDL is
 * worse than failing.
 */
export interface TestDb {
  db: PrismaClient;
  cleanup: () => Promise<void>;
}

const MIGRATIONS_DIR = "prisma/migrations";

// Read once per process rather than once per suite.
let ddl: string | undefined;
function migrationDdl(): string {
  if (ddl !== undefined) return ddl;

  // Prisma's directories are timestamp-prefixed, so lexical order is apply
  // order — the same order `prisma migrate deploy` uses.
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const statements = dirs.map((dir) =>
    readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"),
  );
  ddl = statements.join("\n");

  if (!ddl.includes("CREATE TABLE")) {
    throw new Error(
      `${MIGRATIONS_DIR} yielded no CREATE TABLE across ${dirs.length} migration(s). ` +
        "The test database would be empty and every suite would fail misleadingly.",
    );
  }
  return ddl;
}

export async function createTestDb(): Promise<TestDb> {
  const client = await PGlite.create();
  await client.exec(migrationDdl());

  const db = new PrismaClient({ adapter: new PrismaPGlite(client) });

  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      await client.close();
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
