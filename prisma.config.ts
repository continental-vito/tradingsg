import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env implicitly from the config file, and Node has
// loaded env files natively since 20.6 — so this needs no dotenv dependency.
// A missing .env is not an error: CI and Vercel set DATABASE_URL directly.
try {
  process.loadEnvFile(".env");
} catch {
  // Not present — the variable must already be in the environment, and the
  // env() call below fails loudly by name if it is not.
}

// Prisma 7 removed `url` from the datasource block in schema.prisma; migrate and
// introspect read it from here instead. The *runtime* connection is separate —
// PrismaClient is constructed with a driver adapter in src/server/db.ts, because
// PrismaConfig has no `adapter` key. Both point at DATABASE_URL, and
// build/db-provider.sh is what swaps SQLite for Postgres across the pair.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DATABASE_URL") },
  migrations: { seed: "tsx prisma/seed.ts" },
});
