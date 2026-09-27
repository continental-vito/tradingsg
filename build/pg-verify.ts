/**
 * Proves the PostgreSQL deployment path actually works, rather than asserting
 * the schema is portable and hoping.
 *
 * docs/deployment.md previously said, accurately, that the Postgres migration
 * set had never been run against a live PostgreSQL. This closes that: it
 * applies the generated DDL over a real Postgres wire connection and then
 * drives the application's own client against it.
 *
 *     make ci-postgres
 *
 * The server is PGlite — PostgreSQL 18 compiled to WASM — behind a TCP socket,
 * so this needs no Docker, no cloud account and no credentials. PGlite serves
 * one connection at a time, which is why `prisma migrate dev` cannot be used
 * here (its engine takes advisory locks on a second connection); the DDL is
 * generated with `prisma migrate diff` and applied directly, which exercises
 * the same SQL.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const ddlPath = process.argv[2];
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!ddlPath) throw new Error("usage: tsx build/pg-verify.ts <ddl.sql>");

  const bootstrap = new Client({ connectionString: url });
  await bootstrap.connect();
  await bootstrap.query(readFileSync(ddlPath, "utf8"));
  await bootstrap.end();
  console.info("  ✓ the generated DDL applies over a real Postgres connection");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  try {
    // Beyond 2^53. Money is BigInt precisely so this cannot silently round, and
    // a driver that hands back a JS number would lose the last digit.
    const huge = 9_007_199_254_740_993n;
    const competition = await prisma.competition.create({
      data: {
        name: "PG Verify",
        slug: `pg-verify-${Date.now()}`,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
        startDate: "2026-09-27",
        endDate: "2026-12-31",
        startingCapitalCents: huge,
      },
    });
    const read = await prisma.competition.findUniqueOrThrow({ where: { id: competition.id } });
    if (read.startingCapitalCents !== huge) {
      throw new Error(
        `BigInt round-trip lost precision: wrote ${huge}, read ${read.startingCapitalCents}`,
      );
    }
    console.info("  ✓ BigInt money survives a round trip beyond 2^53");

    const email = `pg-verify-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: "x", firstName: "P", lastName: "G" },
    });
    let rejected = false;
    try {
      await prisma.user.create({
        data: { email, passwordHash: "x", firstName: "P", lastName: "G" },
      });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("a duplicate email was accepted — the unique index is not being enforced");
    }
    console.info("  ✓ a unique index genuinely rejects a duplicate");

    // Every rebalance runs inside one of these.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { firstName: "Updated" } });
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (after.firstName !== "Updated") throw new Error("the transaction did not commit");
    console.info("  ✓ a transaction commits");
  } finally {
    await prisma.$disconnect();
  }
}

// Called rather than top-level-awaited: tsx transforms this file to CommonJS,
// where top-level await is a syntax error.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
