import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedParticipant } from "@/test/db";
import { findJob } from "@/server/jobs/registry";
import { loadTradingAccess } from "@/server/portfolio/access";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { HOUSE_RULES } from "./house-rules";
import {
  preLaunchWindow,
  dueLaunches,
  enrolEveryone,
  isPreLaunch,
  launchCompetition,
  queuePreLaunchOrder,
  queuedOrder,
} from "./prelaunch";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
type Seeded = Awaited<ReturnType<typeof seedParticipant>>;
let alice: Seeded;
let bob: Seeded;

// Pre-launch runs from the 5th; the competition launches on Monday the 10th.
const DURING = "2026-08-05";
const LAUNCH = "2026-08-10";

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  const competition = await db.competition.create({
    data: {
      slug: "spring",
      name: "Spring Challenge",
      status: "REGISTRATION",
      preLaunch: true,
      startsAt: new Date(`${LAUNCH}T08:00:00Z`),
      endsAt: new Date("2026-11-01T17:30:00Z"),
      startDate: LAUNCH,
      endDate: "2026-11-01",
    },
  });
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: {
      competitionId,
      revision: 1,
      ...HOUSE_RULES,
      maxPositionPpm: 600_000,
      allowTradingBeforeStart: false,
    },
  });
  const stock = await db.stock.create({ data: { symbol: "MC", name: "LVMH" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: DURING, closeCents: 50_000n },
      // Launch day's close, which every queued order must execute at.
      { stockId, tradeDate: LAUNCH, closeCents: 55_000n },
    ],
  });
  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("before launch", () => {
  it("queues an order instead of trading, and lets it be replaced", async () => {
    expect(
      await queuePreLaunchOrder(db, {
        portfolioId: alice.portfolio.id,
        targets: [{ stockId, weightPpm: 400_000 }],
        asOfDate: DURING,
      }),
    ).toEqual({ ok: true });
    expect(
      await queuePreLaunchOrder(db, {
        portfolioId: alice.portfolio.id,
        targets: [{ stockId, weightPpm: 500_000 }],
        asOfDate: DURING,
      }),
    ).toEqual({ ok: true });

    expect(await queuedOrder(db, alice.portfolio.id)).toEqual([{ stockId, weightPpm: 500_000 }]);
    expect(await db.rebalanceRequest.count({ where: { portfolioId: alice.portfolio.id } })).toBe(1);
    // Nothing bought: the ledger still holds only the funding row.
    expect(await db.transaction.count({ where: { portfolioId: alice.portfolio.id } })).toBe(1);
  });

  it("refuses an order that breaks a rule now, rather than at launch when it is too late", async () => {
    const result = await queuePreLaunchOrder(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId, weightPpm: 900_000 }],
      asOfDate: DURING,
    });
    expect(result.ok).toBe(false);
    expect(await queuedOrder(db, bob.portfolio.id)).toBeNull();
  });

  it("enrols existing accounts that are not in the competition yet", async () => {
    await db.user.create({
      data: { email: "carol@example.com", passwordHash: "x", firstName: "Carol", lastName: "C" },
    });
    expect(await enrolEveryone(db, competitionId)).toEqual({ enrolled: 1 });
    expect(await enrolEveryone(db, competitionId)).toEqual({ enrolled: 0 });
  });

  it("values, ranks and launches nothing before the start date", async () => {
    const before = new Date(`2026-08-07T21:00:00Z`);
    expect(await dueLaunches(db, before)).toEqual([]);
    const job = findJob("snapshot-valuations");
    await job?.run(db, { now: before, triggeredBy: "CLI" });
    // Without the guard the start date was valued days early, all cash, and
    // then skipped for good.
    expect(await db.portfolioValuation.count({ where: { competitionId } })).toBe(0);
  });
});

describe("launch", () => {
  it("is due on the start date", async () => {
    const due = await dueLaunches(db, new Date(`${LAUNCH}T21:00:00Z`));
    expect(due.map((c) => c.id)).toEqual([competitionId]);
  });

  it("executes every queued order together, at the launch-day close", async () => {
    const now = new Date(`${LAUNCH}T21:00:00Z`);
    const result = await launchCompetition(db, { competitionId, asOfDate: LAUNCH, now });
    expect(result).toEqual({ launched: true, executed: 1, rejected: [] });

    const buy = await db.transaction.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, type: "BUY" },
    });
    expect(buy.priceCents).toBe(55_000n);
    expect(buy.tradeDate).toBe(LAUNCH);
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
    expect(await queuedOrder(db, alice.portfolio.id)).toBeNull();

    const competition = await db.competition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(isPreLaunch(competition)).toBe(false);
    expect(competition.status).toBe("RUNNING");
    expect(
      await db.notification.count({ where: { userId: alice.user.id, type: "TRADE_EXECUTED" } }),
    ).toBe(1);
  });

  it("does not use up anyone's rebalance token", async () => {
    const access = await loadTradingAccess(db, alice.portfolio.id, new Date(`${LAUNCH}T21:30:00Z`));
    expect(access?.tokens?.used).toBe(0);
  });

  it("happens once: a second run trades nothing", async () => {
    const again = await launchCompetition(db, { competitionId, asOfDate: LAUNCH });
    expect(again.launched).toBe(false);
    expect(
      await db.transaction.count({ where: { portfolioId: alice.portfolio.id, type: "BUY" } }),
    ).toBe(1);
  });
});

describe("the editing window", () => {
  // The schedule for the November start: build 2–6 November, launch the 9th.
  const competition = {
    startDate: "2026-11-09",
    preLaunchOpensOn: "2026-11-02",
    preLaunchClosesOn: "2026-11-06",
  };

  it("is closed before it opens, and says when it will", () => {
    const w = preLaunchWindow(competition, "2026-10-30");
    expect(w.state).toBe("BEFORE");
    expect(w.reason).toContain("Monday 2 November");
    expect(w.reason).toContain("Monday 9 November");
  });

  it("is open from the first day to the last day, inclusive", () => {
    expect(preLaunchWindow(competition, "2026-11-02").state).toBe("OPEN");
    expect(preLaunchWindow(competition, "2026-11-06").state).toBe("OPEN");
  });

  it("is closed between the last day and the launch", () => {
    const w = preLaunchWindow(competition, "2026-11-07");
    expect(w.state).toBe("CLOSED");
    expect(w.reason).toContain("Friday 6 November");
  });

  it("refuses an order outside the window on the server, whatever the page showed", async () => {
    await db.competition.update({
      where: { id: competitionId },
      data: {
        launchedAt: null,
        startDate: "2026-11-09",
        preLaunchOpensOn: "2026-11-02",
        preLaunchClosesOn: "2026-11-06",
      },
    });
    const early = await queuePreLaunchOrder(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId, weightPpm: 100_000 }],
      asOfDate: "2026-10-30",
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0]?.code).toBe("PRE_LAUNCH_CLOSED");
    expect(await queuedOrder(db, bob.portfolio.id)).toBeNull();
  });
});
