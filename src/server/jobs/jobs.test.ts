import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { commitRebalance } from "@/server/portfolio/commit";
import { snapshotLeaderboard } from "./leaderboard";
import { snapshotValuations } from "./valuations";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;
let bob: Awaited<ReturnType<typeof seedParticipant>>;
const stockIds: Record<string, string> = {};

const DAY_ONE = "2026-07-24";
const DAY_TWO = "2026-07-27";

const ctx = () => ({ db, runKey: "test", log: () => {} });

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;

  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  for (const [symbol, day1, day2] of [
    ["AAPL", 20_000n, 22_000n],
    ["MSFT", 40_000n, 38_000n],
  ] as const) {
    const stock = await db.stock.create({ data: { symbol, name: symbol } });
    stockIds[symbol] = stock.id;
    await db.competitionStock.create({ data: { competitionId, stockId: stock.id } });
    await db.priceHistory.createMany({
      data: [
        { stockId: stock.id, tradeDate: DAY_ONE, closeCents: day1, revision: 1 },
        { stockId: stock.id, tradeDate: DAY_TWO, closeCents: day2, revision: 1 },
      ],
    });
  }

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("commitRebalance", () => {
  it("writes a ledger that reconciles exactly", async () => {
    const result = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [
        { stockId: stockIds.AAPL ?? "", weightPpm: 600_000 },
        { stockId: stockIds.MSFT ?? "", weightPpm: 400_000 },
      ],
      idempotencyKey: "alice-initial",
      periodKey: "2026-W30",
      asOfDate: DAY_ONE,
    });
    expect(result.ok).toBe(true);

    // Every invariant, checked against the ledger rather than the code that
    // wrote it. This is the assertion that would catch money appearing.
    const violations = await checkPortfolioInvariants(db, alice.portfolio.id);
    expect(violations).toEqual([]);

    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
      include: { holdings: true, transactions: true },
    });
    // 60% of €100,000 at €200.00 = 300 shares; 40% at €400.00 = 100 shares.
    const aapl = portfolio.holdings.find((h) => h.stockId === stockIds.AAPL);
    expect(aapl?.microShares).toBe(300n * 1_000_000n);
    // INITIAL_FUNDING plus two buys, sequences 1..3 with no gap.
    expect(portfolio.transactions.map((t) => t.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(portfolio.setupCompletedAt).not.toBeNull();
  });

  it("replays an identical submission instead of trading twice", async () => {
    // A double-click, a retried server action, or a flaky network replaying the
    // POST must not buy the portfolio twice.
    const before = await db.transaction.count({ where: { portfolioId: alice.portfolio.id } });
    const again = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [{ stockId: stockIds.AAPL ?? "", weightPpm: 1_000_000 }],
      idempotencyKey: "alice-initial",
      periodKey: "2026-W30",
      asOfDate: DAY_ONE,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.replayed).toBe(true);
    expect(await db.transaction.count({ where: { portfolioId: alice.portfolio.id } })).toBe(before);
  });

  it("refuses a second change in the same period at the database level", async () => {
    // The unique index on (portfolioId, periodKey) is what actually enforces
    // "one change per week" under a concurrent double-submit. An application
    // count check loses that race.
    await expect(
      db.rebalanceRequest.create({
        data: {
          portfolioId: alice.portfolio.id,
          status: "COMMITTED",
          idempotencyKey: "alice-second-attempt",
          periodKey: "2026-W30",
          targetsJson: "[]",
          quotesJson: "[]",
        },
      }),
    ).rejects.toThrow();
  });

  it("records a rejection without consuming the period's allowed change", async () => {
    const rejected = await commitRebalance(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId: stockIds.AAPL ?? "", weightPpm: 1_500_000 }],
      idempotencyKey: "bob-too-much",
      periodKey: "2026-W30",
      asOfDate: DAY_ONE,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors.map((e) => e.code)).toContain("WEIGHTS_EXCEED_100");

    const row = await db.rebalanceRequest.findUniqueOrThrow({
      where: { idempotencyKey: "bob-too-much" },
    });
    expect(row.status).toBe("REJECTED");
    // Null, so the corrected submission can still use this week's change.
    expect(row.periodKey).toBeNull();
  });

  it("lets the corrected submission through afterwards", async () => {
    const fixed = await commitRebalance(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId: stockIds.MSFT ?? "", weightPpm: 500_000 }],
      idempotencyKey: "bob-corrected",
      periodKey: "2026-W30",
      asOfDate: DAY_ONE,
    });
    expect(fixed.ok).toBe(true);
    expect(await checkPortfolioInvariants(db, bob.portfolio.id)).toEqual([]);
  });
});

describe("snapshotValuations", () => {
  it("values every portfolio and is idempotent on re-run", async () => {
    await snapshotValuations(ctx(), { competitionId, asOfDate: DAY_ONE });
    const first = await db.portfolioValuation.findMany({
      where: { competitionId, asOfDate: DAY_ONE },
      orderBy: { portfolioId: "asc" },
      select: { portfolioId: true, totalValueCents: true, totalReturnPpm: true },
    });
    expect(first).toHaveLength(2);

    // Re-running for the same date must change nothing — that is what makes a
    // missed day safe to catch up and a crashed job safe to repeat.
    await snapshotValuations(ctx(), { competitionId, asOfDate: DAY_ONE });
    const second = await db.portfolioValuation.findMany({
      where: { competitionId, asOfDate: DAY_ONE },
      orderBy: { portfolioId: "asc" },
      select: { portfolioId: true, totalValueCents: true, totalReturnPpm: true },
    });
    expect(second).toEqual(first);
    expect(await db.portfolioValuation.count({ where: { competitionId, asOfDate: DAY_ONE } })).toBe(
      2,
    );
  });

  it("moves the valuation when prices move, and keeps the P/L identity", async () => {
    await snapshotValuations(ctx(), { competitionId, asOfDate: DAY_TWO });
    const valuation = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: DAY_TWO },
    });
    // AAPL 200 -> 220 on 60%, MSFT 400 -> 380 on 40%: net positive.
    expect(valuation.totalReturnPpm).toBeGreaterThan(0);
    expect(valuation.totalValueCents - valuation.initialCapitalCents - valuation.netFlowCents).toBe(
      valuation.realizedPnlCents + valuation.unrealizedPnlCents,
    );
    // The chain is explicit, not inferred from the calendar.
    expect(valuation.previousValuationId).not.toBeNull();
  });

  it("agrees with the simple return while there are no external flows", async () => {
    const valuation = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: DAY_TWO },
    });
    expect(valuation.netFlowCents).toBe(0n);
    expect(valuation.twrPpm).toBe(valuation.totalReturnPpm);
  });
});

describe("snapshotLeaderboard", () => {
  it("ranks the participants and is idempotent on re-run", async () => {
    await snapshotLeaderboard(ctx(), { competitionId, asOfDate: DAY_TWO, kind: "DAILY" });
    const read = async () =>
      db.leaderboardSnapshotEntry.findMany({
        where: { snapshot: { competitionId, asOfDate: DAY_TWO, kind: "DAILY" } },
        orderBy: { displayOrder: "asc" },
        select: { participantId: true, rank: true, totalReturnPpm: true },
      });

    const first = await read();
    expect(first).toHaveLength(2);
    expect(first[0]?.rank).toBe(1);

    await snapshotLeaderboard(ctx(), { competitionId, asOfDate: DAY_TWO, kind: "DAILY" });
    expect(await read()).toEqual(first);
    expect(
      await db.leaderboardSnapshot.count({
        where: { competitionId, asOfDate: DAY_TWO, kind: "DAILY" },
      }),
    ).toBe(1);
  });

  it("leaves a participant who never invested unranked", async () => {
    const carol = await seedParticipant(db, competitionId, "carol@example.com");
    await snapshotValuations(ctx(), { competitionId, asOfDate: DAY_TWO });
    await snapshotLeaderboard(ctx(), { competitionId, asOfDate: DAY_TWO, kind: "DAILY" });

    const entry = await db.leaderboardSnapshotEntry.findFirstOrThrow({
      where: {
        participantId: carol.participant.id,
        snapshot: { competitionId, asOfDate: DAY_TWO, kind: "DAILY" },
      },
    });
    // All cash is exactly 0.00%. Ranking that mid-table, ahead of everyone who
    // is down, would reward not playing.
    expect(entry.rank).toBeNull();
    expect(entry.isRanked).toBe(false);
    expect(entry.unrankedReason).toBe("NOT_INVESTED");
    // ...and they are ordered after every ranked entry.
    expect(entry.displayOrder).toBe(3);
  });
});
