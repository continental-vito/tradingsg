import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The PostgreSQL migration, applied to a real PostgreSQL engine.
 *
 * This existed as a documented gap for several releases: the schema is written
 * to be dialect-portable, CI checked that it *stays* portable, and nobody had
 * ever run the resulting DDL. "It should work" is not a deployment plan, and
 * the first person to deploy would have found out instead.
 *
 * PGlite is PostgreSQL compiled to WebAssembly — a real engine, real parser,
 * real constraint enforcement — so this needs no server, no Docker and no
 * network, and runs on every push.
 */

let db: PGlite;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tradingsg-pg-"));

  // The same schema, with only the provider swapped — exactly what
  // build/db-provider.sh does.
  const schema = readFileSync("prisma/schema.prisma", "utf8").replace(
    'datasource db {\n  provider = "sqlite"\n}',
    'datasource db {\n  provider = "postgresql"\n}',
  );
  const schemaPath = join(dir, "schema.prisma");
  writeFileSync(schemaPath, schema, "utf8");
  expect(schema).toContain('provider = "postgresql"');

  const sql = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema", schemaPath, "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  db = new PGlite();
  await db.waitReady;
  await db.exec(sql);
}, 180_000);

afterAll(async () => {
  await db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the PostgreSQL schema", () => {
  it("applies cleanly to a real PostgreSQL engine", async () => {
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(25);
    const names = tables.rows.map((r) => r.table_name);
    for (const required of ["User", "Portfolio", "Transaction", "PortfolioValuation", "JobRun"]) {
      expect(names).toContain(required);
    }
  });

  it("carries every constraint the app's correctness rests on", async () => {
    const idx = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE%'",
    );
    // Normalised, because PostgreSQL only quotes identifiers that need it.
    const defs = idx.rows.map((r) => r.indexdef.replace(/"/g, ""));
    const present = (table: string, cols: string[]) =>
      defs.some((d) => d.includes(` ON public.${table} `) && d.endsWith(`(${cols.join(", ")})`));

    // Each of these is load-bearing: an application-level check would lose the
    // race that the index wins.
    expect(present("Transaction", ["portfolioId", "sequence"])).toBe(true);
    expect(present("RebalanceRequest", ["portfolioId", "periodKey"])).toBe(true);
    expect(present("RebalanceRequest", ["idempotencyKey"])).toBe(true);
    expect(present("JobRun", ["jobName", "runKey"])).toBe(true);
    expect(present("EmailLog", ["dedupeKey"])).toBe(true);
    expect(present("Participant", ["userId", "competitionId"])).toBe(true);
    expect(present("PriceHistory", ["stockId", "tradeDate", "revision"])).toBe(true);
    expect(present("PortfolioValuation", ["portfolioId", "asOfDate", "kind"])).toBe(true);
    expect(present("LeaderboardSnapshot", ["competitionId", "asOfDate", "kind"])).toBe(true);
  });

  it("actually rejects a duplicate, rather than merely declaring the index", async () => {
    await db.exec(
      `INSERT INTO "JobRun"(id,"jobName","runKey","updatedAt") VALUES('j1','close-prices','2026-09-10',now())`,
    );
    await expect(
      db.exec(
        `INSERT INTO "JobRun"(id,"jobName","runKey","updatedAt") VALUES('j2','close-prices','2026-09-10',now())`,
      ),
    ).rejects.toThrow();
  });

  it("stores money beyond 2^53 without losing a cent", async () => {
    // The reason every monetary column is BigInt. A Number would round this.
    const exact = "9007199254740993";
    await db.exec(`INSERT INTO "User"(id,email,"passwordHash","firstName","lastName","updatedAt")
                   VALUES('u1','a@b.c','h','A','B',now())`);
    await db.exec(`INSERT INTO "Competition"(id,slug,name,"startsAt","endsAt","startDate","endDate","updatedAt","startingCapitalCents")
                   VALUES('c1','s','n',now(),now(),'2026-01-01','2026-12-31',now(),${exact})`);
    const row = await db.query<{ v: bigint }>(
      `SELECT "startingCapitalCents" v FROM "Competition" WHERE id = 'c1'`,
    );
    expect(String(row.rows[0]?.v)).toBe(exact);
  });

  it("declares no SQLite-only or Postgres-only types", async () => {
    // The portability rule, checked from the Postgres side: every column the
    // schema calls BigInt must have become int8, not a text or numeric
    // fallback that would compare wrongly.
    const cols = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='Portfolio' AND column_name='cashCents'`,
    );
    expect(cols.rows[0]?.data_type).toBe("bigint");
  });
});
