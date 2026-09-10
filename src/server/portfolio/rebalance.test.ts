import { describe, expect, it } from "vitest";
import { PPM, type FeeConfig } from "@/server/money";
import type { PriceBook, PricePoint } from "./prices";
import { planRebalance, type TradingRules } from "./rebalance";
import type { PortfolioState } from "./value";

const SYMBOLS: Record<string, string> = { a: "AAPL", b: "MSFT", c: "NVDA" };
const symbolOf = (id: string) => SYMBOLS[id] ?? id;

function bookOf(prices: Record<string, bigint>): PriceBook {
  const points = new Map<string, PricePoint>(
    Object.entries(prices).map(([stockId, priceCents]) => [
      stockId,
      { stockId, priceCents, source: "CLOSE" as const, ageDays: 0 },
    ]),
  );
  return { get: (id) => points.get(id), quality: "OK", staleCount: 0, asOfDate: "2026-09-04" };
}

const noFees: FeeConfig = {
  feeModel: "NONE",
  feeFlatCents: 0n,
  feeBps: 0,
  feeMinCents: 0n,
  feeMaxCents: null,
};

function rulesOf(overrides: Partial<TradingRules> = {}): TradingRules {
  return {
    minPositionPpm: 0,
    maxPositionPpm: 1_000_000,
    minPositionCents: 0n,
    minPositions: 0,
    maxPositions: null,
    allowCash: true,
    minCashPpm: 0,
    maxCashPpm: 1_000_000,
    cashToleranceCents: 100n,
    allowFractionalShares: true,
    minTradeMicroShares: 1_000n,
    minTradeValueCents: 100n,
    fees: noFees,
    universe: new Set(["a", "b", "c"]),
    ...overrides,
  };
}

const emptyPortfolio: PortfolioState = {
  cashCents: 10_000_000n, // €100,000
  holdings: [],
  initialCapitalCents: 10_000_000n,
};

function expectOk(result: ReturnType<typeof planRebalance>) {
  if (!result.ok) {
    throw new Error(`expected a plan, got errors: ${result.errors.map((e) => e.code).join(", ")}`);
  }
  return result.plan;
}

describe("planRebalance — value conservation", () => {
  // THE test. A rebalance is a transformation of value, not a source of it.
  // If this ever fails, someone can farm return by trading.
  it("never increases portfolio value, with or without fees", () => {
    const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });
    const feeConfigs: FeeConfig[] = [
      noFees,
      { feeModel: "PERCENT", feeFlatCents: 0n, feeBps: 25, feeMinCents: 0n, feeMaxCents: null },
      { feeModel: "FLAT", feeFlatCents: 500n, feeBps: 0, feeMinCents: 0n, feeMaxCents: null },
    ];

    for (const fees of feeConfigs) {
      const plan = expectOk(
        planRebalance({
          state: emptyPortfolio,
          targets: [
            { stockId: "a", weightPpm: 400_000 },
            { stockId: "b", weightPpm: 350_000 },
            { stockId: "c", weightPpm: 250_000 },
          ],
          book,
          rules: rulesOf({ fees }),
          symbolOf,
        }),
      );
      expect(plan.postValueCents).toBeLessThanOrEqual(plan.preValueCents);
      // And everything lost is accounted for as fees plus rounding — no gap.
      expect(plan.preValueCents - plan.postValueCents).toBe(
        plan.totalFeeCents + plan.roundingDragCents,
      );
    }
  });

  it("loses only fees and at most a cent per leg to rounding", () => {
    const book = bookOf({ a: 33_333n, b: 7_777n, c: 123_457n });
    const plan = expectOk(
      planRebalance({
        state: emptyPortfolio,
        targets: [
          { stockId: "a", weightPpm: 333_333 },
          { stockId: "b", weightPpm: 333_333 },
          { stockId: "c", weightPpm: 333_334 },
        ],
        book,
        rules: rulesOf(),
        symbolOf,
      }),
    );
    // Purchase cost CEILs, so a buy pays at most one cent more than the shares
    // it receives are worth. That is the drag, it is bounded by one cent per
    // leg, and it is always against the participant — never in their favour.
    expect(plan.totalFeeCents).toBe(0n);
    expect(plan.roundingDragCents).toBeGreaterThanOrEqual(0n);
    expect(plan.roundingDragCents).toBeLessThanOrEqual(BigInt(plan.orders.length));
    expect(plan.postValueCents).toBeLessThanOrEqual(plan.preValueCents);
  });

  it("a round trip through cash and back costs only fees", () => {
    const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });
    const invested = expectOk(
      planRebalance({
        state: emptyPortfolio,
        targets: [
          { stockId: "a", weightPpm: 500_000 },
          { stockId: "b", weightPpm: 500_000 },
        ],
        book,
        rules: rulesOf(),
        symbolOf,
      }),
    );

    const afterInvest: PortfolioState = {
      cashCents: invested.projectedCashCents,
      holdings: invested.projectedHoldings.map((h) => ({
        stockId: h.stockId,
        symbol: h.symbol,
        microShares: h.microShares,
        costBasisCents: h.costBasisCents,
      })),
      initialCapitalCents: 10_000_000n,
    };

    // Sell everything back to cash at the same prices.
    const liquidated = expectOk(
      planRebalance({ state: afterInvest, targets: [], book, rules: rulesOf(), symbolOf }),
    );

    expect(liquidated.postValueCents).toBeLessThanOrEqual(invested.postValueCents);
    // Selling the whole position uses the same marketValue function the
    // valuation does, so a full liquidation is exactly value-preserving.
    expect(liquidated.postValueCents).toBe(invested.postValueCents);
    expect(liquidated.projectedHoldings).toHaveLength(0);
  });

  it("repeated pointless rebalancing at unchanged prices cannot accumulate value", () => {
    const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });
    const rules = rulesOf();
    let state = emptyPortfolio;
    let previousValue = state.cashCents;

    for (let round = 0; round < 8; round++) {
      // Alternate between two allocations, forever, at frozen prices.
      const targets =
        round % 2 === 0
          ? [
              { stockId: "a", weightPpm: 600_000 },
              { stockId: "b", weightPpm: 400_000 },
            ]
          : [
              { stockId: "b", weightPpm: 600_000 },
              { stockId: "c", weightPpm: 400_000 },
            ];
      const plan = expectOk(planRebalance({ state, targets, book, rules, symbolOf }));
      expect(plan.postValueCents).toBeLessThanOrEqual(previousValue);
      previousValue = plan.postValueCents;
      state = {
        cashCents: plan.projectedCashCents,
        holdings: plan.projectedHoldings.map((h) => ({
          stockId: h.stockId,
          symbol: h.symbol,
          microShares: h.microShares,
          costBasisCents: h.costBasisCents,
        })),
        initialCapitalCents: 10_000_000n,
      };
    }
  });
});

describe("planRebalance — cost basis", () => {
  it("leaves no residual basis when a position is fully sold", () => {
    // Without the full-liquidation short-circuit, pro-rata rounding leaves ±1
    // cent of basis on zero shares, which reads as infinite unrealised P/L.
    const book = bookOf({ a: 33_333n });
    const state: PortfolioState = {
      cashCents: 0n,
      holdings: [
        { stockId: "a", symbol: "AAPL", microShares: 3_000_003n, costBasisCents: 1_000_001n },
      ],
      initialCapitalCents: 1_000_001n,
    };
    const plan = expectOk(planRebalance({ state, targets: [], book, rules: rulesOf(), symbolOf }));
    expect(plan.projectedHoldings).toHaveLength(0);
    expect(plan.orders[0]?.costRemovedCents).toBe(1_000_001n);
  });

  it("capitalises buy fees into cost basis", () => {
    const book = bookOf({ a: 10_000n });
    const fees: FeeConfig = {
      feeModel: "FLAT",
      feeFlatCents: 1_000n,
      feeBps: 0,
      feeMinCents: 0n,
      feeMaxCents: null,
    };
    const plan = expectOk(
      planRebalance({
        state: emptyPortfolio,
        targets: [{ stockId: "a", weightPpm: 1_000_000 }],
        book,
        rules: rulesOf({ fees }),
        symbolOf,
      }),
    );
    const buy = plan.orders[0];
    expect(buy?.side).toBe("BUY");
    // A fresh position opens with unrealised P/L of exactly minus the fee.
    expect(buy?.costAddedCents).toBe((buy?.grossCents ?? 0n) + (buy?.feeCents ?? 0n));
  });
});

describe("planRebalance — rules, validated against the projected end state", () => {
  const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });

  it("refuses allocations over 100% and names the excess", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [
        { stockId: "a", weightPpm: 700_000 },
        { stockId: "b", weightPpm: 330_000 },
      ],
      book,
      rules: rulesOf(),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("WEIGHTS_EXCEED_100");
    expect(result.errors[0]?.message).toContain("103%");
    expect(result.errors[0]?.message).toContain("3%");
  });

  it("enforces the position cap on what would actually be held", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [
        { stockId: "a", weightPpm: 450_000 },
        { stockId: "b", weightPpm: 550_000 },
      ],
      book,
      rules: rulesOf({ maxPositionPpm: 300_000 }),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("POSITION_ABOVE_MAX");
    expect(result.errors[0]?.message).toMatch(/caps any single stock at 30%/);
  });

  it("honours a per-stock cap override", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [{ stockId: "a", weightPpm: 500_000 }],
      book,
      rules: rulesOf({
        maxPositionPpm: 1_000_000,
        maxWeightOverridesPpm: new Map([["a", 200_000]]),
      }),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("POSITION_ABOVE_MAX");
  });

  it("refuses to leave cash when the competition forbids it", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [{ stockId: "a", weightPpm: 900_000 }],
      book,
      rules: rulesOf({ allowCash: false }),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("CASH_NOT_ALLOWED");
    expect(result.errors[0]?.message).toContain("10%");
  });

  it("rejects a stock outside the competition's universe", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [{ stockId: "zzz", weightPpm: 1_000_000 }],
      book: bookOf({ zzz: 100n }),
      rules: rulesOf(),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("STOCK_NOT_IN_UNIVERSE");
  });

  it("rejects a duplicated stock rather than silently summing it", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [
        { stockId: "a", weightPpm: 400_000 },
        { stockId: "a", weightPpm: 400_000 },
      ],
      book,
      rules: rulesOf(),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("DUPLICATE_STOCK");
  });

  it("allows selling a suspended stock but not buying more of it", () => {
    const state: PortfolioState = {
      cashCents: 5_000_000n,
      holdings: [
        { stockId: "a", symbol: "AAPL", microShares: 100_000_000n, costBasisCents: 2_000_000n },
      ],
      initialCapitalCents: 10_000_000n,
    };
    const sell = planRebalance({
      state,
      targets: [{ stockId: "a", weightPpm: 100_000 }],
      book,
      rules: rulesOf({ notBuyable: new Set(["a"]) }),
      symbolOf,
    });
    expect(sell.ok).toBe(true);

    const buy = planRebalance({
      state,
      targets: [{ stockId: "a", weightPpm: 900_000 }],
      book,
      rules: rulesOf({ notBuyable: new Set(["a"]) }),
      symbolOf,
    });
    expect(buy.ok).toBe(false);
    if (buy.ok) return;
    expect(buy.errors.map((e) => e.code)).toContain("STOCK_NOT_TRADABLE");
  });

  it("explains whole-share rounding rather than silently leaving cash", () => {
    const plan = expectOk(
      planRebalance({
        state: emptyPortfolio,
        targets: [{ stockId: "b", weightPpm: 1_000_000 }],
        book,
        rules: rulesOf({ allowFractionalShares: false }),
        symbolOf,
      }),
    );
    const holding = plan.projectedHoldings[0];
    // €100,000 / €389.00 is 257.06 shares -> 257, and the rest stays in cash.
    expect(holding?.microShares).toBe(257n * 1_000_000n);
    expect(plan.projectedCashCents).toBeGreaterThan(0n);
    expect(plan.warnings.map((w) => w.code)).toContain("FRACTIONAL_NOT_ALLOWED");
  });

  it("skips a dust-sized change instead of generating a fee for nothing", () => {
    const state: PortfolioState = {
      cashCents: 50n,
      holdings: [
        { stockId: "a", symbol: "AAPL", microShares: 466_200_000n, costBasisCents: 9_999_950n },
      ],
      initialCapitalCents: 10_000_000n,
    };
    const plan = expectOk(
      planRebalance({
        state,
        targets: [{ stockId: "a", weightPpm: 999_995 }],
        book,
        rules: rulesOf(),
        symbolOf,
      }),
    );
    expect(plan.orders).toHaveLength(0);
    expect(plan.warnings.map((w) => w.code)).toContain("NO_CHANGES");
  });

  it("reports no price rather than valuing a stock at zero", () => {
    const result = planRebalance({
      state: emptyPortfolio,
      targets: [{ stockId: "c", weightPpm: 1_000_000 }],
      book: bookOf({ a: 100n, b: 100n }),
      rules: rulesOf(),
      symbolOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("NO_PRICE_AVAILABLE");
    expect(result.errors[0]?.message).toContain("NVDA");
  });
});

describe("planRebalance — ordering", () => {
  it("puts every sell before every buy, so cash is never over-committed", () => {
    const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });
    const state: PortfolioState = {
      cashCents: 0n,
      holdings: [
        { stockId: "a", symbol: "AAPL", microShares: 300_000_000n, costBasisCents: 6_000_000n },
        { stockId: "b", symbol: "MSFT", microShares: 100_000_000n, costBasisCents: 4_000_000n },
      ],
      initialCapitalCents: 10_000_000n,
    };
    const plan = expectOk(
      planRebalance({
        state,
        targets: [
          { stockId: "a", weightPpm: 200_000 },
          { stockId: "b", weightPpm: 300_000 },
          { stockId: "c", weightPpm: 500_000 },
        ],
        book,
        rules: rulesOf(),
        symbolOf,
      }),
    );
    const sides = plan.orders.map((o) => o.side);
    const firstBuy = sides.indexOf("BUY");
    const lastSell = sides.lastIndexOf("SELL");
    expect(firstBuy === -1 || lastSell < firstBuy).toBe(true);
    expect(plan.projectedCashCents).toBeGreaterThanOrEqual(0n);
  });

  it("projected weights plus cash account for the whole portfolio", () => {
    const book = bookOf({ a: 21_450n, b: 38_900n, c: 11_280n });
    const plan = expectOk(
      planRebalance({
        state: emptyPortfolio,
        targets: [
          { stockId: "a", weightPpm: 300_000 },
          { stockId: "b", weightPpm: 300_000 },
          { stockId: "c", weightPpm: 400_000 },
        ],
        book,
        rules: rulesOf(),
        symbolOf,
      }),
    );
    const total =
      plan.projectedHoldings.reduce((s, h) => s + h.weightPpm, 0) + plan.projectedCashWeightPpm;
    // Per-position ratios round independently, so allow a few ppm of slack —
    // the exact-to-one-million guarantee belongs to allocateWeightsPpm, which
    // the valuation uses.
    expect(Math.abs(total - Number(PPM))).toBeLessThanOrEqual(5);
  });
});
