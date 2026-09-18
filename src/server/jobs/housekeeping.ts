import type { JobContext, JobResult } from "./run";

/**
 * Deleting what has stopped being useful.
 *
 * Every one of these tables grows forever otherwise. Sessions, reset tokens and
 * notifications all carry an expiry that nothing acted on, which made the
 * column a description rather than a rule — and over a competition with a
 * hundred people that is thousands of dead rows nobody will ever read.
 *
 * Everything here is deliberately conservative: expired means well past
 * expired, so a clock skew or a late job cannot delete something still in use.
 */

const DAY = 86_400_000;

export async function runHousekeeping(ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const now = Date.now();
  const counts: Record<string, number> = {};

  // Revoked or expired sessions, kept a month so "who was signed in when this
  // happened" is still answerable after an incident.
  counts.sessions = (
    await db.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - 30 * DAY) } },
          { revokedAt: { lt: new Date(now - 30 * DAY) } },
        ],
      },
    })
  ).count;

  // A reset token is single-use and short-lived; a week past expiry is
  // generous.
  counts.resetTokens = (
    await db.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(now - 7 * DAY) } },
    })
  ).count;

  // Notifications carry their own expiry. Read ones go sooner, because a
  // notification you have already seen has done its job.
  counts.notifications = (
    await db.notification.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date(now) } }, { readAt: { lt: new Date(now - 60 * DAY) } }],
      },
    })
  ).count;

  // Job history, kept long enough to answer "did the nightly valuation run last
  // month?" and no longer.
  counts.jobRuns = (
    await db.jobRun.deleteMany({
      where: {
        status: { in: ["SUCCEEDED", "SKIPPED"] },
        startedAt: { lt: new Date(now - 90 * DAY) },
      },
    })
  ).count;

  // A run still marked RUNNING with no heartbeat for an hour is a process that
  // died. Left alone it holds its lock until something reclaims it, so it is
  // marked failed rather than deleted — the failure is worth seeing.
  counts.staleLocks = (
    await db.jobRun.updateMany({
      where: { status: "RUNNING", heartbeatAt: { lt: new Date(now - 60 * 60_000) } },
      data: { status: "FAILED", error: "No heartbeat — the process that claimed this run died." },
    })
  ).count;

  // Rejected rebalance previews. They are kept briefly so a participant can be
  // told why yesterday's submission bounced, not forever.
  counts.rejectedRebalances = (
    await db.rebalanceRequest.deleteMany({
      where: { status: "REJECTED", submittedAt: { lt: new Date(now - 14 * DAY) } },
    })
  ).count;

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const detail = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  log(total === 0 ? "nothing to clean up" : `removed ${total}: ${detail}`);

  return { itemsProcessed: total, detail: counts };
}
