/**
 * Jobs that run back to back from one daily trigger.
 *
 * GitHub Actions treats a `*\/15` schedule as best effort and, on this repo,
 * fired roughly every four to six hours — so jobs that waited for a narrow
 * evening window (the close, the valuations, the leaderboard) simply never
 * ran, and prices stopped updating without a single failed run. A daily Vercel
 * Cron is allowed on the Hobby plan and does fire every day, so every job
 * hangs off one of two of those instead (see vercel.json).
 *
 * Order matters: valuations read the closes, the leaderboard reads the
 * valuations, the backup records all three. A failed link stops the chain
 * rather than ranking on prices that were never written.
 *
 * build/check-schedule.py parses this file; keep one quoted job name per line.
 */
export const CHAINS: Record<string, readonly string[]> = {
  // After the European close. Prices update once a day by decision: everyone is
  // valued on the same close, and intraday quotes would only move a number the
  // leaderboard does not use.
  nightly: [
    "refresh-prices",
    "close-prices",
    "snapshot-valuations",
    "snapshot-leaderboard",
    "export-backup",
  ],
  // Every job here is keyed so a repeat is a no-op: build-weekly-report runs
  // once per ISO week however many mornings call it.
  //
  // The AI investors go last: a failure in one of them must not stop the
  // report, and by morning the previous close they trade on is written.
  morning: ["run-notifications", "housekeeping", "build-weekly-report", "run-ai-investors"],
};
