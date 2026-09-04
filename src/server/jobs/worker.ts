/**
 * The local scheduler.
 *
 *     make worker
 *
 * Deployed on Vercel there is no long-lived process, so the same jobs are
 * invoked over HTTP by Vercel Cron instead — see src/app/api/cron and
 * vercel.json. This file exists for local development and for a self-hosted
 * deployment, and it runs the identical implementations.
 *
 * On boot it catches up: every job runs once immediately, and because each one
 * is idempotent and backfills from its last stored row, a laptop that was shut
 * for four days lands in the right state rather than with a four-day hole.
 */
import cron from "node-cron";
import { applySqlitePragmas, createPrismaClient } from "../prisma";
import { JOBS } from "./registry";

try {
  process.loadEnvFile(".env");
} catch {
  // Set directly in production.
}

const db = createPrismaClient();

async function execute(name: string, triggeredBy: "CRON" | "CATCHUP") {
  const job = JOBS.find((j) => j.name === name);
  if (!job) return;
  try {
    const outcomes = await job.run(db, { triggeredBy });
    const ran = outcomes.filter((o) => o.status !== "SKIPPED");
    if (ran.length > 0) {
      const failed = ran.filter((o) => o.status === "FAILED");
      console.info(
        `[${new Date().toISOString()}] ${name}: ${ran.length} run(s)` +
          (failed.length > 0 ? `, ${failed.length} FAILED` : ""),
      );
      for (const f of failed) console.error(`  ✗ ${f.runKey}: ${f.error}`);
    }
  } catch (error: unknown) {
    console.error(`[${new Date().toISOString()}] ${name} threw:`, error);
  }
}

async function main() {
  await applySqlitePragmas(db);

  console.info("TradingSG worker");
  for (const job of JOBS) {
    console.info(`  ${job.cron.padEnd(18)} ${job.name}`);
  }

  console.info("\nCatching up on boot…");
  // Sequential, in registry order: valuations need prices, and the leaderboard
  // needs valuations. Running them concurrently would rank a day that has not
  // been valued yet.
  for (const job of JOBS) {
    await execute(job.name, "CATCHUP");
  }
  console.info("Caught up. Waiting for the schedule.\n");

  for (const job of JOBS) {
    cron.schedule(job.cron, () => void execute(job.name, "CRON"));
  }
}

main().catch((error: unknown) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info("\nShutting down.");
    void db.$disconnect().then(() => process.exit(0));
  });
}
