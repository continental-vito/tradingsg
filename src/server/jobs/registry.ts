import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, dateKeyOf, eachTradingDay, isoWeekOf, type DateKey } from "@/lib/dates";
import { backfillPrices, missingTradingDays, refreshQuoteCache } from "./prices";
import { snapshotLeaderboard } from "./leaderboard";
import { snapshotValuations } from "./valuations";
import { runJob, type JobOutcome } from "./run";

/**
 * Every scheduled job, in one place, with one implementation each.
 *
 * Three entry points share these: the CLI (`make job NAME=…`), the local
 * node-cron worker (`make worker`), and `POST /api/cron/<name>` for Vercel,
 * which has no long-lived process to run a cron in. Nothing in a job knows
 * which of the three invoked it.
 */

export interface JobDefinition {
  name: string;
  description: string;
  /** node-cron expression, used only by the local worker. */
  cron: string;
  /** Identifies one logical execution. The unique index on it is the lock. */
  runKeyFor: (now: Date, timezone: string) => string;
  run: (db: PrismaClient, args: JobArgs) => Promise<JobOutcome[]>;
}

export interface JobArgs {
  now?: Date;
  force?: boolean;
  triggeredBy?: "CRON" | "CLI" | "HTTP" | "CATCHUP";
  /** Restrict to one competition. Default: every competition that is running. */
  competitionSlug?: string;
}

async function activeCompetitions(db: PrismaClient, slug?: string) {
  return db.competition.findMany({
    where: {
      deletedAt: null,
      ...(slug ? { slug } : { status: { in: ["RUNNING", "REGISTRATION", "PAUSED"] } }),
    },
    select: { id: true, slug: true, timezone: true, startDate: true, endDate: true },
  });
}

/** Never value or rank a date after the competition ended. */
function clampToCompetition(date: DateKey, startDate: DateKey, endDate: DateKey): DateKey {
  if (date < startDate) return startDate;
  if (date > endDate) return endDate;
  return date;
}

export const JOBS: JobDefinition[] = [
  {
    name: "refresh-prices",
    description: "Update the cached latest quote for every stock.",
    cron: "*/15 8-22 * * 1-5",
    runKeyFor: (now) => `tick:${Math.floor(now.getTime() / 900_000)}`,
    run: async (db, args) => {
      const now = args.now ?? new Date();
      return [
        await runJob(
          db,
          {
            jobName: "refresh-prices",
            runKey: `tick:${Math.floor(now.getTime() / 900_000)}`,
            triggeredBy: args.triggeredBy,
            force: args.force,
          },
          async (ctx) => {
            const updated = await refreshQuoteCache(ctx.db, "cache");
            ctx.log(`refreshed ${updated} quotes`);
            return { itemsProcessed: updated };
          },
        ),
      ];
    },
  },

  {
    name: "close-prices",
    description: "Write today's closing price for every stock, backfilling any missed days.",
    cron: "30 22 * * 1-5",
    runKeyFor: (now, tz) => dateKeyOf(now, tz),
    run: async (db, args) => {
      const now = args.now ?? new Date();
      const outcomes: JobOutcome[] = [];
      for (const competition of await activeCompetitions(db, args.competitionSlug)) {
        const today = clampToCompetition(
          dateKeyOf(now, competition.timezone),
          competition.startDate,
          competition.endDate,
        );
        // Catch-up runs ascending: prevClose and the generator's walk both
        // depend on the day before, so order is not cosmetic here.
        const days = await missingTradingDays(db, competition.startDate, today);
        if (days.length === 0) continue;
        outcomes.push(
          await runJob(
            db,
            {
              jobName: "close-prices",
              runKey: `${competition.slug}:${today}`,
              triggeredBy: args.triggeredBy,
              force: args.force,
            },
            (ctx) =>
              backfillPrices(ctx, {
                from: days[0] ?? competition.startDate,
                to: days[days.length - 1] ?? today,
                anchorDate: competition.startDate,
              }),
          ),
        );
      }
      return outcomes;
    },
  },

  {
    name: "snapshot-valuations",
    description: "Value every portfolio at the close, backfilling any missed days.",
    cron: "0 23 * * *",
    runKeyFor: (now, tz) => dateKeyOf(now, tz),
    run: async (db, args) => {
      const now = args.now ?? new Date();
      const outcomes: JobOutcome[] = [];
      for (const competition of await activeCompetitions(db, args.competitionSlug)) {
        const today = clampToCompetition(
          dateKeyOf(now, competition.timezone),
          competition.startDate,
          competition.endDate,
        );
        const last = await db.portfolioValuation.findFirst({
          where: { competitionId: competition.id, kind: "EOD" },
          orderBy: { asOfDate: "desc" },
          select: { asOfDate: true },
        });
        const from = last ? addDays(last.asOfDate, 1) : competition.startDate;
        // Strictly ascending: previousValuationId and the TWR chain both depend
        // on the row before, so a gap filled out of order corrupts both.
        for (const day of eachTradingDay(from, today)) {
          outcomes.push(
            await runJob(
              db,
              {
                jobName: "snapshot-valuations",
                runKey: `${competition.slug}:${day}`,
                triggeredBy: args.triggeredBy,
                force: args.force,
              },
              (ctx) => snapshotValuations(ctx, { competitionId: competition.id, asOfDate: day }),
            ),
          );
        }
      }
      return outcomes;
    },
  },

  {
    name: "snapshot-leaderboard",
    description: "Rank every participant and store the standings.",
    cron: "15 23 * * *",
    runKeyFor: (now, tz) => dateKeyOf(now, tz),
    run: async (db, args) => {
      const now = args.now ?? new Date();
      const outcomes: JobOutcome[] = [];
      for (const competition of await activeCompetitions(db, args.competitionSlug)) {
        const today = clampToCompetition(
          dateKeyOf(now, competition.timezone),
          competition.startDate,
          competition.endDate,
        );
        const last = await db.leaderboardSnapshot.findFirst({
          where: { competitionId: competition.id, kind: "DAILY" },
          orderBy: { asOfDate: "desc" },
          select: { asOfDate: true },
        });
        const from = last ? addDays(last.asOfDate, 1) : competition.startDate;
        for (const day of eachTradingDay(from, today)) {
          outcomes.push(
            await runJob(
              db,
              {
                jobName: "snapshot-leaderboard",
                runKey: `${competition.slug}:DAILY:${day}`,
                triggeredBy: args.triggeredBy,
                force: args.force,
              },
              (ctx) =>
                snapshotLeaderboard(ctx, {
                  competitionId: competition.id,
                  asOfDate: day,
                  kind: "DAILY",
                }),
            ),
          );
          // Sunday also closes the competition week.
          if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0 || day === today) {
            outcomes.push(
              await runJob(
                db,
                {
                  jobName: "snapshot-leaderboard",
                  runKey: `${competition.slug}:WEEKLY:${isoWeekOf(day)}`,
                  triggeredBy: args.triggeredBy,
                  force: args.force,
                },
                (ctx) =>
                  snapshotLeaderboard(ctx, {
                    competitionId: competition.id,
                    asOfDate: day,
                    kind: "WEEKLY",
                  }),
              ),
            );
          }
        }
      }
      return outcomes;
    },
  },
];

export function findJob(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}
