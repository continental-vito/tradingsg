import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { commitRebalance } from "./commit";
import { checkPortfolioInvariants } from "./invariant";
import { buildPriceBook } from "./prices";
import { valuePortfolio, type PortfolioState } from "./value";
import { buildExports } from "@/server/backup/export";
import { snapshotValuations } from "@/server/jobs/valuations";

/**
 * Shorting, end to end through the real commit path.
 *
 * The properties that matter are not "a short can be opened" but that every
 * identity the rest of the app rests on survives one: cash still equals the
 * ledger, value minus capital still equals realised plus unrealised, and a
 * short still cannot make money appear.
 */

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

const OPEN = "2026-07-24";
const FELL = "2026-07-27";
const ROSE = "2026-07-28";

async function allowShorting(on: boolean, extra: Record<string, unknown> = {}) {
  const current = await db.competitionSettings.findFirstOrThrow({
    where: { competitionId, supersededAt: null },
  });
  await db.competitionSettings.update({
    where: { id: current.id },
    data: { allowShort: on, ...extra },
  });
}

async function stateOf(portfolioId: string): Promise<PortfolioState> {
  const p = await db.portfolio.findUniqueOrThrow({
    where: { id: portfolioId },
    include: { holdings: { include: { stock: true } } },
  });
  return {
    cashCents: p.cashCents,
    initialCapitalCents: p.initialCapitalCents,
    netFlowCents: p.netFlowCents,
    realizedPnlCents: p.realizedPnlCents,
    holdings: p.holdings.map((h) => ({
      stockId: h.stockId,
      symbol: h.stock.symbol,
      microShares: h.microShares,
      costBasisCents: h.costBasisCents,
    })),
  };
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000, allowShort: true },
  });

  const stock = await db.stock.create({ data: { symbol: "TSLA", name: "Tesla" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: OPEN, closeCents: 20_000n, revision: 1 }, // €200
      { stockId, tradeDate: FELL, closeCents: 16_000n, revision: 1 }, // €160
      { stockId, tradeDate: ROSE, closeCents: 25_000n, revision: 1 }, // €250
    ],
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
}, 90_000);

afterAll(async () => {
  await cleanup();
});

describe("opening a short", () => {
  it("raises cash, owes shares, and keeps the ledger reconciling", async () => {
    const result = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [{ stockId, weightPpm: -200_000 }], // short 20%
      idempotencyKey: "open-short",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(result.ok).toBe(true);

    const holding = await db.holding.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, stockId },
    });
    // 20% of €100,000 at €200 is 100 shares, owed rather than owned.
    expect(holding.microShares).toBe(-100n * 1_000_000n);
    // The proceeds are a NEGATIVE basis, which is what makes value - basis
    // report the right P/L without a second formula.
    expect(holding.costBasisCents).toBe(-2_000_000n);

    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
    });
    // Cash went UP: the short sold something it did not have.
    expect(portfolio.cashCents).toBe(12_000_000n);

    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });

  it("is still worth exactly the starting capital the moment it opens", async () => {
    // Cash €120,000 plus a €20,000 liability is €100,000. A short must not
    // create or destroy value on the way in.
    const book = await buildPriceBook(db, [stockId], OPEN);
    const value = valuePortfolio(await stateOf(alice.portfolio.id), book);
    expect(value.totalValueCents).toBe(10_000_000n);
    expect(value.totalReturnPpm).toBe(0);
    expect(value.holdings[0]?.marketValueCents).toBe(-2_000_000n);
    expect(value.shortExposurePpm).toBe(200_000);
    expect(value.grossExposurePpm).toBe(200_000);
  });

  it("gains when the price falls, and the P/L identity holds", async () => {
    const book = await buildPriceBook(db, [stockId], FELL);
    const value = valuePortfolio(await stateOf(alice.portfolio.id), book);
    // Shorted 100 at €200, now €160: a €4,000 gain.
    expect(value.totalValueCents).toBe(10_400_000n);
    expect(value.unrealizedPnlCents).toBe(400_000n);
    expect(value.totalReturnPpm).toBe(40_000);
    expect(value.totalValueCents - 10_000_000n - 0n).toBe(
      value.realizedPnlCents + value.unrealizedPnlCents,
    );
  });

  it("loses when the price rises", async () => {
    const book = await buildPriceBook(db, [stockId], ROSE);
    const value = valuePortfolio(await stateOf(alice.portfolio.id), book);
    // Now €250: a €5,000 loss, and a short's loss has no ceiling.
    expect(value.totalValueCents).toBe(9_500_000n);
    expect(value.unrealizedPnlCents).toBe(-500_000n);
  });
});

describe("closing a short", () => {
  it("realises the gain and leaves no residual basis", async () => {
    const result = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [],
      idempotencyKey: "close-short",
      periodKey: null,
      asOfDate: FELL,
    });
    expect(result.ok).toBe(true);

    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
      include: { holdings: true },
    });
    // Bought back 100 at €160 for €16,000, having taken €20,000: +€4,000.
    expect(portfolio.realizedPnlCents).toBe(400_000n);
    expect(portfolio.cashCents).toBe(10_400_000n);
    expect(portfolio.holdings.every((h) => h.microShares === 0n)).toBe(true);
    // A residual on a closed position reads as infinite unrealised P/L.
    expect(portfolio.holdings.every((h) => h.costBasisCents === 0n)).toBe(true);

    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });
});

describe("crossing zero", () => {
  it("treats long-to-short as two events, not one", async () => {
    const bob = await seedParticipant(db, competitionId, "bob@example.com");

    await commitRebalance(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId, weightPpm: 500_000 }],
      idempotencyKey: "bob-long",
      periodKey: null,
      asOfDate: OPEN,
    });

    // From half the portfolio long, straight to a fifth short.
    const flip = await commitRebalance(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId, weightPpm: -200_000 }],
      idempotencyKey: "bob-flip",
      periodKey: null,
      asOfDate: ROSE,
    });
    expect(flip.ok).toBe(true);
    if (!flip.ok) return;

    // Selling the long and opening the short have different cost bases and
    // different realised P/L, so they cannot be one order.
    expect(flip.plan.orders).toHaveLength(2);
    expect(flip.plan.orders.every((o) => o.side === "SELL")).toBe(true);
    expect(flip.plan.orders.filter((o) => o.opensShort)).toHaveLength(1);
    expect(flip.plan.orders.filter((o) => !o.opensShort)).toHaveLength(1);

    const holding = await db.holding.findFirstOrThrow({
      where: { portfolioId: bob.portfolio.id, stockId },
    });
    expect(holding.microShares).toBeLessThan(0n);
    expect(holding.costBasisCents).toBeLessThan(0n);
    expect(await checkPortfolioInvariants(db, bob.portfolio.id)).toEqual([]);
  });
});

describe("the limits that make shorting survivable", () => {
  it("refuses a short when the competition does not allow one", async () => {
    await allowShorting(false);
    const carol = await seedParticipant(db, competitionId, "carol@example.com");
    const result = await commitRebalance(db, {
      portfolioId: carol.portfolio.id,
      targets: [{ stockId, weightPpm: -100_000 }],
      idempotencyKey: "carol-denied",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("NEGATIVE_WEIGHT");
    await allowShorting(true);
  });

  it("caps a single short tighter than a holding", async () => {
    // A long can only go to zero; a short can go to any price. So the cap on
    // one is not the cap on the other.
    const dave = await seedParticipant(db, competitionId, "dave@example.com");
    const result = await commitRebalance(db, {
      portfolioId: dave.portfolio.id,
      targets: [{ stockId, weightPpm: -900_000 }],
      idempotencyKey: "dave-huge",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("SHORT_ABOVE_MAX");
    expect(result.errors[0]?.message).toMatch(/lose more than it makes|allows in one short/);
  });

  it("caps total exposure once shorts are counted at their size", async () => {
    await allowShorting(true, { maxGrossExposurePpm: 1_200_000, maxShortPositionPpm: 1_000_000 });
    const second = await db.stock.create({ data: { symbol: "WGT", name: "Weight Test" } });
    await db.competitionStock.create({ data: { competitionId, stockId: second.id } });
    await db.priceHistory.create({
      data: { stockId: second.id, tradeDate: OPEN, closeCents: 10_000n, revision: 1 },
    });

    const erin = await seedParticipant(db, competitionId, "erin@example.com");
    const result = await commitRebalance(db, {
      portfolioId: erin.portfolio.id,
      // Net 60%, but 100% long plus 40% short is 140% of exposure.
      targets: [
        { stockId: second.id, weightPpm: 1_000_000 },
        { stockId, weightPpm: -400_000 },
      ],
      idempotencyKey: "erin-gross",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("GROSS_EXPOSURE_EXCEEDED");

    await allowShorting(true, { maxGrossExposurePpm: 1_500_000, maxShortPositionPpm: 200_000 });
  });

  it("never lets a short create money at unchanged prices", async () => {
    // The property the whole design rests on, now in both directions: opening
    // a short and closing it again at the same price can only cost fees and
    // rounding, never pay.
    const frank = await seedParticipant(db, competitionId, "frank@example.com");
    const opened = await commitRebalance(db, {
      portfolioId: frank.portfolio.id,
      targets: [{ stockId, weightPpm: -150_000 }],
      idempotencyKey: "frank-open",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const closed = await commitRebalance(db, {
      portfolioId: frank.portfolio.id,
      targets: [],
      idempotencyKey: "frank-close",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    expect(closed.plan.postValueCents).toBeLessThanOrEqual(opened.plan.postValueCents);
    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: frank.portfolio.id },
    });
    expect(portfolio.cashCents).toBeLessThanOrEqual(10_000_000n);
    expect(await checkPortfolioInvariants(db, frank.portfolio.id)).toEqual([]);
  });
});

/**
 * Four separate places filtered holdings with `microShares > 0n`, written when
 * a holding could only be empty or long. Each silently dropped every short:
 * the participant's live view kept the cash a short sale raised but lost the
 * liability that justified it, the nightly job never fetched a price for the
 * shorted stock, and the recovery CSV — whose entire purpose is rebuilding a
 * portfolio — omitted the position. All four fail the same way, by making a
 * portfolio look richer than it is rather than by raising an error.
 */
describe("a short is never filtered out of a holdings list", () => {
  it("survives valuation, the snapshot job, and the backup export", async () => {
    const bob = await seedParticipant(db, competitionId, "filter-bob@example.com");
    const opened = await commitRebalance(db, {
      portfolioId: bob.portfolio.id,
      targets: [{ stockId, weightPpm: -150_000 }],
      idempotencyKey: "filter-open",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(opened.ok).toBe(true);

    const raw = await db.holding.findMany({ where: { portfolioId: bob.portfolio.id } });
    const open = raw.filter((h) => h.microShares !== 0n);
    expect(open).toHaveLength(1);
    expect(open[0]!.microShares).toBeLessThan(0n);

    // Valuation counts it, and counts it against the portfolio.
    const state = await stateOf(bob.portfolio.id);
    const book = await buildPriceBook(db, [stockId], OPEN, { maxStalenessDays: 5 });
    const valued = valuePortfolio(state, book);
    expect(valued.holdings).toHaveLength(1);
    expect(valued.shortExposurePpm).toBeGreaterThan(0);
    // The short raised cash, so cash alone exceeds the portfolio's worth. The
    // total is only right if the liability was subtracted.
    expect(valued.cashCents).toBeGreaterThan(valued.totalValueCents);
    expect(valued.totalValueCents).toBe(10_000_000n);

    // The nightly job must price the shorted stock and write a row for it. If
    // it filters the short out of stockIds, the price book has no entry and the
    // valuation either throws or quietly values the liability at nothing.
    const job = await snapshotValuations(
      { db, runKey: "short-filter-regression", log: () => {} },
      { competitionId, asOfDate: OPEN },
    );
    expect(job.itemsProcessed).toBeGreaterThan(0);
    const snapshot = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: bob.portfolio.id, asOfDate: OPEN },
      include: { holdingValuations: true },
    });
    expect(snapshot.holdingValuations).toHaveLength(1);
    expect(snapshot.holdingValuations[0]!.microShares).toBeLessThan(0n);
    expect(snapshot.totalValueCents).toBe(10_000_000n);

    // The recovery CSV must carry it too: a backup that omits a position
    // cannot rebuild the portfolio, which is the only reason it exists.
    const files = await buildExports(db, competitionId, OPEN);
    const holdingsCsv = files.find((f) => f.kind === "holdings");
    expect(holdingsCsv).toBeDefined();
    const line = holdingsCsv!.content
      .split("\n")
      .find((row) => row.includes("filter-bob@example.com"));
    expect(line).toBeDefined();
    expect(line).toContain("TSLA");
    // The share count is negative, which is what makes it a short on restore.
    expect(line).toMatch(/"-\d+"/);
  }, 60_000);
});

/**
 * Weights had three different denominators: longs were allocated among
 * themselves, while shorts and cash were measured against net value. A 30%
 * position displayed as 26.1%, the donut summed to 105%, and none of the
 * numbers matched what the participant had typed — all without any error.
 */
describe("weights with a short in the book", () => {
  it("sum to 100% and reproduce the percentages that were entered", async () => {
    const carol = await seedParticipant(db, competitionId, "weights-carol@example.com");
    const second = await db.stock.create({ data: { symbol: "DENOM", name: "Denominator Test" } });
    await db.competitionStock.create({ data: { competitionId, stockId: second.id } });
    await db.priceHistory.create({
      data: { stockId: second.id, tradeDate: OPEN, closeCents: 10_000n, revision: 1 },
    });

    const committed = await commitRebalance(db, {
      portfolioId: carol.portfolio.id,
      targets: [
        { stockId, weightPpm: 300_000 }, // long 30%
        { stockId: second.id, weightPpm: -150_000 }, // short 15%
      ],
      idempotencyKey: "weights-short",
      periodKey: null,
      asOfDate: OPEN,
    });
    expect(committed.ok).toBe(true);

    const state = await stateOf(carol.portfolio.id);
    const book = await buildPriceBook(db, [stockId, second.id], OPEN, { maxStalenessDays: 5 });
    const valued = valuePortfolio(state, book);

    const long = valued.holdings.find((h) => h.stockId === stockId);
    const short = valued.holdings.find((h) => h.stockId === second.id);
    expect(long?.weightPpm).toBe(300_000);
    expect(short?.weightPpm).toBe(-150_000);
    // Cash is the balance: 100 − 30 + 15, because the short sale's proceeds
    // are sitting in it.
    expect(valued.cashWeightPpm).toBe(850_000);

    const sum = valued.holdings.reduce((a, h) => a + h.weightPpm, 0) + valued.cashWeightPpm;
    expect(sum).toBe(1_000_000);
  }, 60_000);
});
