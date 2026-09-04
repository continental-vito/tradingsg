import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Constructs the Prisma client.
 *
 * Deliberately NOT carrying the `server-only` guard, unlike src/server/db.ts
 * which re-exports it. The job CLI and the cron worker are plain Node processes,
 * and `server-only` throws on import outside a React Server Component build —
 * so a single guarded module cannot serve both. `db.ts` is what application
 * code imports and it keeps the guard; this file is for the entry points that
 * have no React around them at all.
 *
 * TWO PROCESSES WRITE THIS FILE: the Next server and the job worker. Without
 * WAL, the first rebalance that lands while the nightly valuation is running
 * fails with SQLITE_BUSY — and it will happen during a demo, not during a test.
 * WAL lets readers and one writer proceed concurrently; busy_timeout makes a
 * second writer wait rather than throw. foreign_keys is off by default in
 * SQLite, which makes every onDelete rule in the schema inert — turning
 * "cascade" into "orphan".
 */
export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env — nothing can open a database without it.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const PRAGMAS = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA busy_timeout = 5000;",
  "PRAGMA foreign_keys = ON;",
  "PRAGMA synchronous = NORMAL;",
];

export async function applySqlitePragmas(client: PrismaClient): Promise<void> {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) return;
  for (const pragma of PRAGMAS) {
    await client.$executeRawUnsafe(pragma);
  }
}
