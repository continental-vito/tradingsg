import { PrismaPg } from "@prisma/adapter-pg";
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
  // Loaded here as well as in src/lib/env.ts, because a plain-Node script that
  // imports only this module gets no .env otherwise. The job CLI works today
  // only because it happens to pull env.ts in transitively, and relying on an
  // import graph for that is the kind of thing that breaks the next script
  // somebody writes.
  if (!url && !process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Absent is fine — CI and Vercel set the variable directly, and the
      // error below names it either way.
    }
    url = process.env.DATABASE_URL;
  }

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env — nothing can open a database without it.",
    );
  }
  return new PrismaClient({
    adapter: adapterFor(url),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * The adapter is chosen from the connection string, not from a build flag and
 * not by rewriting this file.
 *
 * build/db-provider.sh used to patch the adapter import when switching dialects
 * — and it patched src/server/db.ts, which stopped containing the adapter when
 * the client factory moved here. Its regexes then matched nothing, silently, so
 * `make db-provider-postgres` reported success while leaving the runtime on
 * SQLite: the schema said PostgreSQL, the driver opened a file, and the failure
 * surfaced as an unrelated error at the first query. Deriving it from the URL
 * removes the second place that had to agree.
 *
 * Note that the Prisma *schema*'s `provider` still has to match — that one is
 * genuinely build-time, because it decides the SQL that gets generated. See
 * docs/deployment.md.
 */
function adapterFor(url: string) {
  if (url.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL points at a SQLite file, but this project runs on PostgreSQL " +
        "everywhere — development, tests and production alike.\n" +
        "For a local database with nothing to install, run `make dev-db` in another " +
        "terminal and set:\n" +
        "  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres",
    );
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    // One connection per serverless invocation. A pool would be worse than
    // useless here: each invocation is its own short-lived process, so pooled
    // connections are never reused and simply accumulate against the server's
    // limit until it starts refusing new ones. Pooling belongs in front of
    // Postgres (PgBouncer, or Neon's pooled endpoint), not in the function.
    return new PrismaPg({ connectionString: url, max: 1 });
  }
  throw new Error(
    `DATABASE_URL must be a postgres:// connection string. Got: ${url.slice(0, 12)}…`,
  );
}
