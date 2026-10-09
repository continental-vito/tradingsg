#!/usr/bin/env node
/**
 * Applies pending database migrations during a Vercel PRODUCTION build, before
 * the new code is built — so a release that adds a migration needs nobody to
 * run `prisma migrate deploy` by hand, and the code never goes live against a
 * schema it does not match.
 *
 * Production only. Preview deployments share the production database (see
 * docs/deployment.md), and a preview of an unmerged branch must not change the
 * schema everyone is using. Local builds, `make ci` and GitHub Actions have no
 * VERCEL_ENV and skip this entirely.
 *
 * Migrations need Neon's DIRECT endpoint: Prisma's migration engine takes a
 * session-level advisory lock, which the pooler does not carry across
 * statements. The app's DATABASE_URL is the pooled one, and the direct host is
 * the same name without "-pooler", so it is derived rather than being a second
 * secret to keep in sync. A URL without "-pooler" is used as it is.
 *
 * A failed migration fails the build. Deploying code against a schema it does
 * not match is worse than keeping the previous deployment live.
 */
import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") {
  console.info(`migrate-on-deploy: skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
  process.exit(0);
}

const pooled = process.env.DATABASE_URL;
if (!pooled) {
  console.error("migrate-on-deploy: DATABASE_URL is not set in the Vercel project.");
  process.exit(1);
}

let direct;
try {
  const url = new URL(pooled);
  url.hostname = url.hostname.replace("-pooler.", ".");
  direct = url.toString();
} catch {
  console.error("migrate-on-deploy: DATABASE_URL is not a valid connection string.");
  process.exit(1);
}

console.info("migrate-on-deploy: applying pending migrations over the direct connection");
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: direct },
});
process.exit(result.status ?? 1);
