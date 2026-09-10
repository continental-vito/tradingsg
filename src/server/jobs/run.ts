import { hostname } from "node:os";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The job runner.
 *
 * `JobRun` has a unique index on (jobName, runKey), and that index IS the lock.
 * A second concurrent run of the same job for the same key fails its INSERT and
 * reports SKIPPED, rather than two processes valuing every portfolio at once
 * and racing each other's writes. An application-level "is it running?" check
 * loses that race regularly; a unique constraint does not.
 */

export interface JobContext {
  db: PrismaClient;
  runKey: string;
  log: (message: string) => void;
}

export interface JobResult {
  itemsProcessed: number;
  itemsFailed?: number;
  detail?: Record<string, unknown>;
}

export interface JobOutcome {
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  runKey: string;
  durationMs: number;
  itemsProcessed: number;
  error?: string;
}

/** A run still marked RUNNING with no heartbeat for this long is presumed dead. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export async function runJob(
  db: PrismaClient,
  args: {
    jobName: string;
    runKey: string;
    triggeredBy?: "CRON" | "CLI" | "HTTP" | "CATCHUP";
    force?: boolean;
  },
  body: (ctx: JobContext) => Promise<JobResult>,
): Promise<JobOutcome> {
  const { jobName, runKey, triggeredBy = "CLI", force = false } = args;
  const startedAt = Date.now();

  const existing = await db.jobRun.findUnique({
    where: { jobName_runKey: { jobName, runKey } },
  });

  if (existing) {
    const isStale =
      existing.status === "RUNNING" && Date.now() - existing.heartbeatAt.getTime() > STALE_LOCK_MS;

    if (existing.status === "RUNNING" && !isStale) {
      return {
        status: "SKIPPED",
        runKey,
        durationMs: 0,
        itemsProcessed: 0,
        error: `${jobName} is already running for ${runKey} (started ${existing.startedAt.toISOString()}).`,
      };
    }
    if (existing.status === "SUCCEEDED" && !force) {
      return {
        status: "SKIPPED",
        runKey,
        durationMs: 0,
        itemsProcessed: 0,
        error: `${jobName} already succeeded for ${runKey}. Re-run with --force to repeat it.`,
      };
    }
    // A stale or failed run is reclaimed rather than blocking forever. Every
    // job below is idempotent, so repeating one is safe by design.
    await db.jobRun.update({
      where: { id: existing.id },
      data: {
        status: "RUNNING",
        triggeredBy,
        startedAt: new Date(),
        heartbeatAt: new Date(),
        finishedAt: null,
        error: null,
        attempt: existing.attempt + 1,
        hostname: hostname(),
      },
    });
  } else {
    try {
      await db.jobRun.create({
        data: { jobName, runKey, status: "RUNNING", triggeredBy, hostname: hostname() },
      });
    } catch {
      // Lost the race to another process. That is the lock working.
      return {
        status: "SKIPPED",
        runKey,
        durationMs: 0,
        itemsProcessed: 0,
        error: `${jobName} for ${runKey} was claimed by another process.`,
      };
    }
  }

  const heartbeat = setInterval(() => {
    void db.jobRun
      .update({
        where: { jobName_runKey: { jobName, runKey } },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => {
        // A missed heartbeat only risks the lock being reclaimed early; it is
        // not worth failing the job that is otherwise making progress.
      });
  }, 10_000);
  heartbeat.unref?.();

  const lines: string[] = [];
  try {
    const result = await body({
      db,
      runKey,
      log: (message) => {
        lines.push(message);
        console.info(`  ${message}`);
      },
    });
    const durationMs = Date.now() - startedAt;
    await db.jobRun.update({
      where: { jobName_runKey: { jobName, runKey } },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        durationMs,
        itemsProcessed: result.itemsProcessed,
        itemsFailed: result.itemsFailed ?? 0,
        resultJson: JSON.stringify({ ...result.detail, log: lines }),
      },
    });
    return {
      status: "SUCCEEDED",
      runKey,
      durationMs,
      itemsProcessed: result.itemsProcessed,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    // The whole message, not a status code: a job that failed at 03:00 is read
    // hours later by someone with no other context.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await db.jobRun.update({
      where: { jobName_runKey: { jobName, runKey } },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        durationMs,
        error: message,
        resultJson: JSON.stringify({ log: lines }),
      },
    });
    return { status: "FAILED", runKey, durationMs, itemsProcessed: 0, error: message };
  } finally {
    clearInterval(heartbeat);
  }
}
