import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { applySqlitePragmas, createPrismaClient } from "./prisma";

/**
 * The Prisma client for application code. The `server-only` import above is the
 * guard: importing this from a client component is a build error rather than a
 * bundle that leaks the database into the browser.
 *
 * Job entry points import ./prisma directly — see the comment there.
 */

// In development Next discards the module registry on every hot reload, and a
// fresh client per reload exhausts connections within a minute.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPragmas?: Promise<void>;
};

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Fired once per process, not awaited at import: a top-level await here would
// make every module that touches the database asynchronous to load.
globalForPrisma.prismaPragmas ??= applySqlitePragmas(db).catch((error: unknown) => {
  console.error("Failed to apply SQLite pragmas — expect SQLITE_BUSY under concurrency:", error);
});

export { applySqlitePragmas };
