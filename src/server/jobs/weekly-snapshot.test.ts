import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { snapshotLeaderboard } from "./leaderboard";
import { findJob } from "./registry";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;

const job = findJob("snapshot-leaderboard")!;
const weeklyDates = async () =>
  (
    await db.leaderboardSnapshot.findMany({
      where: { competitionId, kind: "WEEKLY" },
      orderBy: { asOfDate: "asc" },
      select: { asOfDate: true },
    })
  ).map((s) => s.asOfDate);

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  const competition = await seedCompetition(db, "weekly-cup");
  competitionId = competition.id;
  // A Monday start, so the first week has a mid-week day to go wrong on.
  await db.competition.update({
    where: { id: competitionId },
    data: { startDate: "2026-07-20", timezone: "Europe/Berlin" },
  });
  await seedParticipant(db, competitionId, "solo@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("weekly leaderboard snapshot", () => {
  it("replaces a mid-week weekly snapshot with Friday's close", async () => {
    // The old behaviour: the first run of a week took the weekly snapshot and
    // the ISO-week run key locked it, so Monday's report described Wednesday.
    await snapshotLeaderboard(
      { db, runKey: "seed", log: () => {} },
      { competitionId, asOfDate: "2026-07-22", kind: "WEEKLY" },
    );

    // Friday, 22:30 in Berlin — after the close.
    await job.run(db, { now: new Date("2026-07-24T20:30:00Z"), competitionSlug: "weekly-cup" });

    expect(await weeklyDates()).toEqual(["2026-07-24"]);
  });

  it("takes no weekly snapshot mid-week", async () => {
    // Ranking a Wednesday as "the week" is the bug; the next Friday is the
    // first day the week may be closed.
    await job.run(db, { now: new Date("2026-07-29T20:30:00Z"), competitionSlug: "weekly-cup" });
    expect(await weeklyDates()).toEqual(["2026-07-24"]);
  });

  it("fills in a Friday that was missed, on the next run", async () => {
    // Nights get skipped. Running on Monday must still close the week before.
    await job.run(db, { now: new Date("2026-08-03T20:30:00Z"), competitionSlug: "weekly-cup" });
    expect(await weeklyDates()).toEqual(["2026-07-24", "2026-07-31"]);
  });
});
