import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The Prisma client singleton.
 *
 * TWO PROCESSES WRITE THIS FILE: the Next.js server and the job worker. Without
 * WAL, the first rebalance that lands while the nightly valuation job is running
 * fails with SQLITE_BUSY — and it will happen during a demo, not during a test.
 * WAL lets readers and one writer proceed concurrently; busy_timeout makes a
 * second writer wait rather than throw immediately.
 *
 * foreign_keys is off by default in SQLite. Every onDelete rule in the schema is
 * inert without it, which turns "cascade" into "orphan".
 */
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env — the app cannot open a database without it.",
    );
  }

  const adapter = new PrismaBetterSqlite3({ url });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return client;
}

/**
 * In development Next.js discards the module registry on every hot reload, and
 * a fresh PrismaClient per reload exhausts connections within a minute.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

/**
 * Applied once per process. `PRAGMA journal_mode` is persistent in the database
 * file, but the other two are per-connection and must be re-applied.
 */
let pragmasApplied = false;

export async function applySqlitePragmas(client: PrismaClient = db): Promise<void> {
  if (pragmasApplied) return;
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) {
    pragmasApplied = true;
    return;
  }
  await client.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
  await client.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
  await client.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  pragmasApplied = true;
}
