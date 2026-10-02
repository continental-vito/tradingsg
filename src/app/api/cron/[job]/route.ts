import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createPrismaClient } from "@/server/prisma";
import { CHAINS } from "@/server/jobs/chains";
import { findJob } from "@/server/jobs/registry";

/**
 * The HTTP entry point for scheduled jobs.
 *
 * Vercel has no long-lived process to run node-cron in, so Vercel Cron calls
 * these instead — the same job implementations the CLI and the local worker
 * use. Nothing in a job knows which of the three invoked it. A name in
 * CHAINS runs several jobs in order; any other name runs that one job.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own when that
 * variable is set, which is why the same check serves it and manual calls.
 *
 * Without CRON_SECRET set, this returns 404 rather than standing open. An
 * unauthenticated endpoint that can regenerate every valuation in the
 * competition is worse than a job that does not run, and 404 rather than 401
 * means an unauthorised caller does not even learn the route exists.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const notFound = () => new NextResponse("Not found", { status: 404 });

export async function POST(request: Request, context: { params: Promise<{ job: string }> }) {
  if (!env.CRON_SECRET) return notFound();

  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${env.CRON_SECRET}`) return notFound();

  const { job: name } = await context.params;
  const names = CHAINS[name] ?? [name];
  const jobs = names.map(findJob);
  if (jobs.some((j) => !j)) return notFound();

  // A dedicated client: this runs in a serverless invocation with no shared
  // module registry to reuse, and it must be disconnected before returning.
  const db = createPrismaClient();
  try {
    const runs = [];
    for (const job of jobs) {
      if (!job) continue;
      const outcomes = await job.run(db, { triggeredBy: "HTTP" });
      runs.push(
        ...outcomes.map((o) => ({
          job: job.name,
          runKey: o.runKey,
          status: o.status,
          items: o.itemsProcessed,
          ms: o.durationMs,
          error: o.error ?? undefined,
        })),
      );
      // Each link reads what the one before wrote. Ranking on valuations that
      // were never computed would publish a wrong leaderboard, which is worse
      // than a missing one — so a failure stops the chain, loudly.
      if (outcomes.some((o) => o.status === "FAILED")) break;
    }
    const failed = runs.filter((r) => r.status === "FAILED");

    return NextResponse.json(
      { job: name, runs },
      // A failed job must not answer 200. A scheduler that reports success on a
      // failed nightly valuation is worse than no scheduler.
      { status: failed.length > 0 ? 500 : 200 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { job: name, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await db.$disconnect();
  }
}

/** GET is allowed for the same job, because some schedulers only issue GETs. */
export async function GET(request: Request, context: { params: Promise<{ job: string }> }) {
  return POST(request, context);
}
