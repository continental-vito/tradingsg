import { describe, expect, it } from "vitest";
import { PPM, toPpm } from "@/server/money";
import { MissingPriceError, type PriceBook, type PricePoint } from "./prices";
import { chainLinkedTwrPpm, periodReturnPpm, valuePortfolio, type PortfolioState } from "./value";

function bookOf(prices: Record<string, [bigint, PricePoint["source"], number?]>): PriceBook {
  const points = new Map<string, PricePoint>(
    Object.entries(prices).map(([stockId, [priceCents, source, ageDays]]) => [
      stockId,
      { stockId, priceCents, source, ageDays: ageDays ?? 0 },
    ]),
  );
  return { get: (id) => points.get(id), quality: "OK", staleCount: 0, asOfDate: "2026-09-04" };
}

describe("valuePortfolio", () => {
  const state: PortfolioState = {
    cashCents: 1_000_000n, // €10,000
    initialCapitalCents: 10_000_000n, // €100,000
    holdings: [
      { stockId: "a", symbol: "AAPL", microShares: 200_000_000n, costBasisCents: 4_000_000n },
      { stockId: "b", symbol: "MSFT", microShares: 100_000_000n, costBasisCents: 5_000_000n },
    ],
  };

  it("values cash plus holdings and reports the return", () => {
    // 200 shares at €225 = €45,000; 100 at €520 = €52,000; plus €10,000 cash.
    const value = valuePortfolio(state, bookOf({ a: [22_500n, "CLOSE"], b: [52_000n, "CLOSE"] }));
    expect(value.holdingsValueCents).toBe(9_700_000n);
    expect(value.totalValueCents).toBe(10_700_000n);
    expect(value.unrealizedPnlCents).toBe(700_000n);
    expect(value.totalReturnPpm).toBe(70_000); // +7.00%
  });

  it("weights across positions and cash sum to exactly one million", () => {
    // The naive per-position ratio sums to 999_99x and the donut chart grows an
    // unexplained sliver. This is the guarantee that stops it.
    const value = valuePortfolio(state, bookOf({ a: [33_333n, "CLOSE"], b: [7_777n, "CLOSE"] }));
    const total = value.holdings.reduce((s, h) => s + h.weightPpm, 0) + value.cashWeightPpm;
    expect(total).toBe(Number(PPM));
  });

  it("excludes zero-share holdings from the position count", () => {
    const withClosed: PortfolioState = {
      ...state,
      holdings: [
        ...state.holdings,
        { stockId: "c", symbol: "NVDA", microShares: 0n, costBasisCents: 0n },
      ],
    };
    const value = valuePortfolio(
      withClosed,
      bookOf({ a: [22_500n, "CLOSE"], b: [52_000n, "CLOSE"], c: [11_280n, "CLOSE"] }),
    );
    expect(value.positionCount).toBe(2);
  });

  it("throws by name rather than valuing an unpriced holding at zero", () => {
    // Silently dropping the position fabricates a -100% loss on it and ranks
    // the participant last for a data problem that is not theirs.
    expect(() => valuePortfolio(state, bookOf({ a: [22_500n, "CLOSE"] }))).toThrow(
      MissingPriceError,
    );
    expect(() => valuePortfolio(state, bookOf({ a: [22_500n, "CLOSE"] }))).toThrow(/MSFT/);
  });

  it("values an all-cash portfolio at exactly its capital, with zero return", () => {
    const allCash: PortfolioState = {
      cashCents: 10_000_000n,
      initialCapitalCents: 10_000_000n,
      holdings: [],
    };
    const value = valuePortfolio(allCash, bookOf({}));
    expect(value.totalValueCents).toBe(10_000_000n);
    expect(value.totalReturnPpm).toBe(0);
    expect(value.cashWeightPpm).toBe(Number(PPM));
  });

  it("carries a stale price forward and says so, rather than skipping the day", () => {
    // Weekends, holidays and halts all look like this, and all are normal.
    const value = valuePortfolio(
      state,
      bookOf({ a: [22_500n, "CARRY_FORWARD", 3], b: [52_000n, "CLOSE"] }),
    );
    expect(value.holdings[0]?.priceSource).toBe("CARRY_FORWARD");
    expect(value.holdings[0]?.priceAgeDays).toBe(3);
    expect(value.totalValueCents).toBe(10_700_000n);
  });

  it("reports a loss with the sign intact", () => {
    const value = valuePortfolio(state, bookOf({ a: [10_000n, "CLOSE"], b: [20_000n, "CLOSE"] }));
    expect(value.totalValueCents).toBe(5_000_000n);
    expect(value.totalReturnPpm).toBe(-500_000); // -50.00%
    expect(value.unrealizedPnlCents).toBeLessThan(0n);
  });
});

describe("periodReturnPpm", () => {
  it("measures the change over the period", () => {
    expect(periodReturnPpm(10_000_000n, 10_340_000n)).toBe(34_000); // +3.40%
  });

  it("puts a flow into the base so it is not read as performance", () => {
    // €100,000 grows to €110,000, but €5,000 of that was credited, not earned.
    expect(periodReturnPpm(10_000_000n, 11_000_000n, 500_000n)).toBe(toPpm(500_000n, 10_500_000n));
  });
});

describe("chainLinkedTwrPpm", () => {
  it("equals the simple return when there are no external flows", () => {
    // This is the assertion that will fail loudly the day someone changes the
    // flow logic, which is exactly why it exists while both are always equal.
    const series = [
      { valueCents: 10_000_000n, flowCents: 0n },
      { valueCents: 10_200_000n, flowCents: 0n },
      { valueCents: 9_900_000n, flowCents: 0n },
      { valueCents: 10_743_000n, flowCents: 0n },
    ];
    expect(chainLinkedTwrPpm(series)).toBe(toPpm(743_000n, 10_000_000n));
  });

  it("does not credit a mid-series deposit as performance", () => {
    const withFlow = [
      { valueCents: 10_000_000n, flowCents: 0n },
      { valueCents: 15_000_000n, flowCents: 5_000_000n },
    ];
    // The portfolio went from €100k to €150k, but €50k of that walked in.
    expect(chainLinkedTwrPpm(withFlow)).toBe(0);
  });

  it("accumulates exactly over many sub-periods, with no compounding drift", () => {
    // 250 flat days must be exactly 0%, not 0.0001% of accumulated rounding.
    const flat = Array.from({ length: 250 }, () => ({
      valueCents: 10_000_000n,
      flowCents: 0n,
    }));
    expect(chainLinkedTwrPpm(flat)).toBe(0);
  });

  it("returns zero for a series too short to have a return", () => {
    expect(chainLinkedTwrPpm([])).toBe(0);
    expect(chainLinkedTwrPpm([{ valueCents: 10_000_000n, flowCents: 0n }])).toBe(0);
  });
});
