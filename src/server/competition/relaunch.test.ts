import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { snapshotValuations } from "@/server/jobs/valuations";
import { commitRebalance } from "@/server/portfolio/commit";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { relaunchCompetition, type RelaunchResult } from "./relaunch";
import { CAC40_UNIVERSE, UNIVERSE } from "./universe";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let oldStockId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;
let bob: Awaited<ReturnType<typeof seedParticipant>>;
let result: RelaunchResult;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  // A trial run: Alice bought Apple, which is not in the CAC 40.
  const apple = await db.stock.create({ data: { symbol: "AAPL", name: "Apple" } });
  oldStockId = apple.id;
  await db.competitionStock.create({ data: { competitionId, stockId: apple.id } });
  await db.priceHistory.create({
    data: { stockId: apple.id, tradeDate: "2026-07-24", closeCents: 20_000n },
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
  const bought = await commitRebalance(db, {
    portfolioId: alice.portfolio.id,
    targets: [{ stockId: apple.id, weightPpm: 800_000 }],
    idempotencyKey: "alice-trial",
    periodKey: null,
    asOfDate: "2026-07-24",
  });
  expect(bought.ok).toBe(true);
  await db.participant.update({ where: { id: bob.participant.id }, data: { status: "WITHDRAWN" } });
  await snapshotValuations(
    { db, runKey: "test", log: () => {} },
    { competitionId, asOfDate: "2026-07-24" },
  );

  result = await relaunchCompetition(db, { competitionId, now: new Date("2026-08-05T10:00:00Z") });
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("relaunchCompetition", () => {
  it("makes the CAC 40, Bitcoin and the S&P 500 ETF the only tradable names", async () => {
    expect(CAC40_UNIVERSE).toHaveLength(40);
    expect(new Set(UNIVERSE.map((u) => u.symbol)).size).toBe(UNIVERSE.length);

    const tradable = await db.competitionStock.findMany({
      where: { competitionId, removedAt: null },
      include: { stock: true },
    });
    expect(tradable.map((t) => t.stock.symbol).sort()).toEqual(
      UNIVERSE.map((u) => u.symbol).sort(),
    );
    expect(tradable.map((t) => t.stock.symbol)).toEqual(
      expect.arrayContaining(["MC", "TTE", "BTC", "SXR8"]),
    );
    // Every price fetched must already be in euro; nothing else is booked.
    expect(tradable.every((t) => t.stock.currency === "EUR")).toBe(true);
    expect(result.stocksRemoved).toBe(1);
  });

  it("removes the old names without deleting them, and stops pricing them", async () => {
    const apple = await db.competitionStock.findFirstOrThrow({
      where: { competitionId, stockId: oldStockId },
      include: { stock: true },
    });
    expect(apple.removedAt).not.toBeNull();
    expect(apple.isTradable).toBe(false);
    // Soft-deleted: history kept, no longer fetched by the nightly job.
    expect(apple.stock.deletedAt).not.toBeNull();
    expect(await db.priceHistory.count({ where: { stockId: oldStockId } })).toBe(1);
  });

  it("puts every portfolio back to its starting capital in cash, with a ledger that reconciles", async () => {
    for (const p of [alice, bob]) {
      const portfolio = await db.portfolio.findUniqueOrThrow({
        where: { id: p.portfolio.id },
        include: { holdings: true, transactions: true, rebalanceRequests: true },
      });
      expect(portfolio.cashCents).toBe(10_000_000n);
      expect(portfolio.initialCapitalCents).toBe(10_000_000n);
      expect(portfolio.holdings).toHaveLength(0);
      expect(portfolio.rebalanceRequests).toHaveLength(0);
      expect(portfolio.transactions.map((t) => t.type)).toEqual(["INITIAL_FUNDING"]);
      expect(portfolio.status).toBe("DRAFT");
      expect(portfolio.setupCompletedAt).toBeNull();
      expect(await checkPortfolioInvariants(db, p.portfolio.id)).toEqual([]);
    }
    expect(result.portfoliosReset).toBe(2);
    expect(await db.portfolioValuation.count({ where: { competitionId } })).toBe(0);
  });

  it("keeps the people, and an administrator's decision about them", async () => {
    const a = await db.participant.findUniqueOrThrow({ where: { id: alice.participant.id } });
    const b = await db.participant.findUniqueOrThrow({ where: { id: bob.participant.id } });
    expect(a.status).toBe("REGISTERED");
    expect(a.activatedAt).toBeNull();
    expect(a.initialCapitalCents).toBe(10_000_000n);
    expect(b.status).toBe("WITHDRAWN");
  });

  it("adds the 1% fee and one rebalance a week as a new rules revision", async () => {
    const settings = await db.competitionSettings.findMany({
      where: { competitionId },
      orderBy: { revision: "asc" },
    });
    expect(settings).toHaveLength(2);
    expect(settings[0]?.supersededAt).not.toBeNull();
    expect(settings[1]).toMatchObject({
      revision: 2,
      supersededAt: null,
      feeModel: "PERCENT",
      feeBps: 100,
      tradingMode: "ONCE_PER_PERIOD",
      periodUnit: "WEEK",
      maxChangesPerPeriod: 1,
      // Everything else carried over from the revision it replaced.
      maxPositionPpm: 1_000_000,
    });
  });
});
