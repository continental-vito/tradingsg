import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { commitRebalance } from "@/server/portfolio/commit";
import { checkPortfolioInvariants } from "./invariant";
import { findStalePricedStocks, liquidateStock, LiquidationError } from "./liquidate";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let goodId: string;
let staleId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;
let bob: Awaited<ReturnType<typeof seedParticipant>>;

const DAY_ONE = "2026-07-24";
const TODAY = "2026-09-01";

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  const good = await db.stock.create({ data: { symbol: "SAP", name: "SAP" } });
  const stale = await db.stock.create({ data: { symbol: "GONE", name: "Delisted Co" } });
  goodId = good.id;
  staleId = stale.id;

  for (const id of [goodId, staleId]) {
    await db.competitionStock.create({ data: { competitionId, stockId: id } });
    await db.priceHistory.create({
      data: { stockId: id, tradeDate: DAY_ONE, closeCents: 10_000n, revision: 1 },
    });
  }
  // Only the good one keeps pricing.
  await db.priceHistory.create({
    data: { stockId: goodId, tradeDate: TODAY, closeCents: 12_000n, revision: 1 },
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");

  for (const p of [alice, bob]) {
    await commitRebalance(db, {
      portfolioId: p.portfolio.id,
      targets: [
        { stockId: goodId, weightPpm: 500_000 },
        { stockId: staleId, weightPpm: 500_000 },
      ],
      idempotencyKey: `liq-${p.participant.id}`,
      periodKey: null,
      asOfDate: DAY_ONE,
    });
  }
}, 90_000);

afterAll(async () => {
  await cleanup();
});

describe("findStalePricedStocks", () => {
  it("finds a held stock that has stopped pricing, and ignores one that has not", async () => {
    const stale = await findStalePricedStocks(db, competitionId, TODAY, 7);
    expect(stale.map((s) => s.symbol)).toEqual(["GONE"]);
    expect(stale[0]?.lastTradeDate).toBe(DAY_ONE);
    expect(stale[0]?.ageDays).toBeGreaterThan(7);
  });

  it("ignores a stale stock nobody holds", async () => {
    const orphan = await db.stock.create({ data: { symbol: "NOBODY", name: "Unheld" } });
    await db.competitionStock.create({ data: { competitionId, stockId: orphan.id } });
    await db.priceHistory.create({
      data: { stockId: orphan.id, tradeDate: DAY_ONE, closeCents: 500n, revision: 1 },
    });
    const stale = await findStalePricedStocks(db, competitionId, TODAY, 7);
    expect(stale.map((s) => s.symbol)).not.toContain("NOBODY");
  });
});

describe("liquidateStock", () => {
  it("sells every holder at the same last-known close, without a fee", async () => {
    const before = await db.portfolio.findUniqueOrThrow({ where: { id: alice.portfolio.id } });

    const result = await liquidateStock(db, {
      competitionId,
      stockId: staleId,
      asOfDate: TODAY,
      reason: "Delisted — liquidated at the last available close",
    });

    expect(result.holdersLiquidated).toBe(2);
    // The last close that existed, not the date of the liquidation.
    expect(result.priceCents).toBe(10_000n);
    expect(result.tradeDate).toBe(DAY_ONE);

    const tx = await db.transaction.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, type: "LIQUIDATION_SELL" },
    });
    // Nobody chose to make this trade, so nobody pays for it.
    expect(tx.feeCents).toBe(0n);
    expect(tx.microSharesAfter).toBe(0n);
    expect(tx.isExternalFlow).toBe(false);

    const after = await db.portfolio.findUniqueOrThrow({ where: { id: alice.portfolio.id } });
    expect(after.cashCents).toBe(before.cashCents + tx.grossCents);
  });

  it("leaves every ledger invariant intact", async () => {
    for (const p of [alice, bob]) {
      expect(await checkPortfolioInvariants(db, p.portfolio.id)).toEqual([]);
    }
  });

  it("closes the position without leaving a residual cost basis", async () => {
    // A residual on a zero-share holding reads as infinite unrealised P/L.
    const holding = await db.holding.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, stockId: staleId },
    });
    expect(holding.microShares).toBe(0n);
    expect(holding.costBasisCents).toBe(0n);
  });

  it("blocks further buying but never deletes the stock", async () => {
    const row = await db.competitionStock.findFirstOrThrow({
      where: { competitionId, stockId: staleId },
    });
    expect(row.isTradable).toBe(false);
    expect(row.removedAt).not.toBeNull();
    // The transactions referencing it must keep resolving.
    expect(await db.stock.findUnique({ where: { id: staleId } })).not.toBeNull();
  });

  it("treats every holder identically", async () => {
    const [a, b] = await Promise.all([
      db.transaction.findFirstOrThrow({
        where: { portfolioId: alice.portfolio.id, type: "LIQUIDATION_SELL" },
      }),
      db.transaction.findFirstOrThrow({
        where: { portfolioId: bob.portfolio.id, type: "LIQUIDATION_SELL" },
      }),
    ]);
    // Same price, same treatment — nobody is advantaged by when it ran.
    expect(a.priceCents).toBe(b.priceCents);
    expect(a.grossCents).toBe(b.grossCents);
  });

  it("refuses a stock that has never had a price, and says what to do instead", async () => {
    const never = await db.stock.create({ data: { symbol: "NEVER", name: "Never Priced" } });
    await db.competitionStock.create({ data: { competitionId, stockId: never.id } });
    await expect(
      liquidateStock(db, { competitionId, stockId: never.id, asOfDate: TODAY, reason: "x" }),
    ).rejects.toThrow(LiquidationError);
    await expect(
      liquidateStock(db, { competitionId, stockId: never.id, asOfDate: TODAY, reason: "x" }),
    ).rejects.toThrow(/Remove it from the competition instead/);
  });
});
