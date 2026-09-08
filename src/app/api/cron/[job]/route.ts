import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { applySqlitePragmas, createPrismaClient } from "@/server/prisma";
import { findJob } from "@/server/jobs/registry";

/**
 * The HTTP entry point for scheduled jobs.
 *
 * Vercel has no long-lived process to run node-cron in, so Vercel Cron calls
 * these instead — the same job implementations the CLI and the local worker
 * use. Nothing in a job knows which of the three invoked it.
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
  const job = findJob(name);
  if (!job) return notFound();

  // A dedicated client: this runs in a serverless invocation with no shared
  // module registry to reuse, and it must be disconnected before returning.
  const db = createPrismaClient();
  try {
    await applySqlitePragmas(db);
    const outcomes = await job.run(db, { triggeredBy: "HTTP" });
    const failed = outcomes.filter((o) => o.status === "FAILED");

    return NextResponse.json(
      {
        job: name,
        runs: outcomes.map((o) => ({
          runKey: o.runKey,
          status: o.status,
          items: o.itemsProcessed,
          ms: o.durationMs,
          error: o.error ?? undefined,
        })),
      },
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
