/**
 * Run one job, once.
 *
 *     make job NAME=snapshot-valuations
 *     npm run job -- snapshot-valuations --force --competition=autumn-2026
 *     npm run job -- --list
 *
 * Same implementation the cron worker and the HTTP route use — this is only a
 * different way in, which is what makes "run it by hand and see what happens" a
 * real debugging option rather than a separate code path that drifts.
 */
import { applySqlitePragmas, createPrismaClient } from "../prisma";
import { JOBS, findJob } from "./registry";

try {
  process.loadEnvFile(".env");
} catch {
  // CI and production set the variables directly.
}

function usage(): never {
  console.info("Usage: npm run job -- <name> [--force] [--competition=<slug>]\n");
  console.info("Jobs:");
  for (const job of JOBS) {
    console.info(`  ${job.name.padEnd(22)} ${job.description}`);
    console.info(`  ${"".padEnd(22)} cron: ${job.cron}`);
  }
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--"));
  if (!name || args.includes("--list") || args.includes("--help")) usage();

  const job = findJob(name);
  if (!job) {
    console.error(`No job called "${name}".\n`);
    usage();
  }

  const db = createPrismaClient();
  await applySqlitePragmas(db);

  const competitionSlug = args.find((a) => a.startsWith("--competition="))?.split("=")[1];

  console.info(`▸ ${job.name}`);
  const outcomes = await job.run(db, {
    force: args.includes("--force"),
    triggeredBy: "CLI",
    ...(competitionSlug ? { competitionSlug } : {}),
  });

  await db.$disconnect();

  if (outcomes.length === 0) {
    console.info("  nothing to do");
    return;
  }

  let failed = 0;
  for (const outcome of outcomes) {
    const mark = outcome.status === "SUCCEEDED" ? "✓" : outcome.status === "SKIPPED" ? "–" : "✗";
    console.info(
      `  ${mark} ${outcome.runKey}  ${outcome.itemsProcessed} item(s)  ${outcome.durationMs}ms` +
        (outcome.error ? `\n      ${outcome.error}` : ""),
    );
    if (outcome.status === "FAILED") failed++;
  }

  // A job that failed must not exit 0. A pipeline that reports success on a
  // failed nightly valuation is worse than no pipeline.
  if (failed > 0) {
    console.error(`\n✗ ${failed} run(s) failed`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Job runner failed:", error);
  process.exit(1);
});
