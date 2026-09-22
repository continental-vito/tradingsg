import { describe, expect, it } from "vitest";
import {
  MICRO,
  PPM,
  absShares,
  allocateWeightsPpm,
  floorDiv,
  divRound,
  feeFor,
  formatPpm,
  formatShares,
  marketValue,
  purchaseCost,
  sharesFor,
  toPpm,
  type FeeConfig,
} from "./money";

const noFees: FeeConfig = {
  feeModel: "NONE",
  feeFlatCents: 0n,
  feeBps: 0,
  feeMinCents: 0n,
  feeMaxCents: null,
};

describe("rounding direction", () => {
  // Guards the rule that every rounding decision costs the participant at most
  // a cent and never pays them. A price of 333 cents with an awkward share
  // count is the adversarial case: the exact value is 333.0003 cents.
  it("floors market value and ceils purchase cost on the same inputs", () => {
    const micro = 1_000_001n; // 1.000001 shares
    const price = 333n;
    expect(marketValue(micro, price)).toBe(333n);
    expect(purchaseCost(micro, price)).toBe(334n);
  });

  it("never lets a buy-then-sell round trip create money", () => {
    // The single most important property here: at an unchanged price and with
    // no fees, a full round trip must never end with more cash than it started.
    const price = 12_345n;
    for (let cents = 1_000n; cents <= 100_000n; cents += 997n) {
      const micro = sharesFor(cents, price);
      const spent = purchaseCost(micro, price);
      const received = marketValue(micro, price);
      expect(spent).toBeGreaterThanOrEqual(received);
      // ...and it must not cost more than a cent either, or the drag would be
      // large enough to distort the leaderboard.
      expect(spent - received).toBeLessThanOrEqual(1n);
    }
  });

  it("sharesFor never returns shares the cash cannot pay for", () => {
    const price = 7_777n;
    for (let cents = 1n; cents <= 50_000n; cents += 311n) {
      const micro = sharesFor(cents, price);
      expect(purchaseCost(micro, price)).toBeLessThanOrEqual(cents + 1n);
    }
  });

  it("floors to whole shares when fractional shares are off", () => {
    // €4,812.00 of a €400.00 stock is 12.03 shares -> 12, leaving €12 in cash.
    const micro = sharesFor(481_200n, 40_000n, { fractional: false });
    expect(micro).toBe(12n * MICRO);
    expect(marketValue(micro, 40_000n)).toBe(480_000n);
  });

  it("rejects a negative price rather than returning nonsense", () => {
    expect(() => marketValue(1n, -100n)).toThrow(/negative price/);
    expect(() => sharesFor(100n, 0n)).toThrow(/price must be positive/);
  });
});

describe("divRound", () => {
  // BigInt division truncates toward zero, which would bias every negative
  // return upward — a -0.5% week would report as -0.4%.
  it("is symmetric around zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(3n, 2n)).toBe(2n);
    expect(divRound(-3n, 2n)).toBe(-2n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(divRound(-1n, 3n)).toBe(0n);
  });

  it("throws on a zero denominator instead of producing Infinity", () => {
    expect(() => divRound(1n, 0n)).toThrow(/divide by zero/);
  });
});

describe("toPpm", () => {
  it("expresses a gain of 7.43% as 74_300 ppm", () => {
    expect(toPpm(743_000n, 10_000_000n)).toBe(74_300);
  });

  it("returns zero for a zero denominator rather than throwing", () => {
    // A portfolio worth nothing has a return of nothing. This is a display
    // value on an empty state, not an error condition.
    expect(toPpm(100n, 0n)).toBe(0);
  });

  it("keeps the sign on losses", () => {
    expect(toPpm(-500_000n, 10_000_000n)).toBe(-50_000);
  });
});

describe("feeFor", () => {
  const percent: FeeConfig = {
    feeModel: "PERCENT",
    feeFlatCents: 0n,
    feeBps: 25,
    feeMinCents: 0n,
    feeMaxCents: null,
  };

  it("charges nothing when the model is NONE", () => {
    expect(feeFor(1_000_000n, noFees)).toBe(0n);
  });

  it("ceils the percentage so a fee is never rounded away to zero", () => {
    // 1 cent at 25bps is 0.0025 cents. Flooring would make small trades free
    // and let someone churn without cost.
    expect(feeFor(1n, percent)).toBe(1n);
    expect(feeFor(1_000_000n, percent)).toBe(2_500n);
  });

  it("applies the minimum only for PERCENT_WITH_MIN", () => {
    const withMin: FeeConfig = { ...percent, feeModel: "PERCENT_WITH_MIN", feeMinCents: 500n };
    expect(feeFor(1_000n, withMin)).toBe(500n);
    expect(feeFor(1_000n, percent)).toBe(3n);
  });

  it("clamps at the configured maximum", () => {
    const capped: FeeConfig = { ...percent, feeMaxCents: 1_000n };
    expect(feeFor(100_000_000n, capped)).toBe(1_000n);
  });
});

describe("allocateWeightsPpm", () => {
  // The naive per-position ratio sums to 999_99x and the donut chart grows an
  // unexplained sliver. Largest remainder makes the total exact.
  it("sums to exactly one million for three equal positions", () => {
    const weights = allocateWeightsPpm([100n, 100n, 100n], 300n);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(Number(PPM));
  });

  it("sums to exactly one million with an awkward cash remainder", () => {
    const values = [333_333n, 333_333n, 333_333n, 1n];
    const weights = allocateWeightsPpm(values, 1_000_000n);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(Number(PPM));
  });

  it("breaks remainder ties by index, so the result is stable across runs", () => {
    const first = allocateWeightsPpm([1n, 1n, 1n], 3n);
    const second = allocateWeightsPpm([1n, 1n, 1n], 3n);
    expect(first).toEqual(second);
    expect(first).toEqual([333_334, 333_333, 333_333]);
  });

  it("returns zeros rather than dividing by zero for an empty portfolio", () => {
    expect(allocateWeightsPpm([0n, 0n], 0n)).toEqual([0, 0]);
    expect(allocateWeightsPpm([], 100n)).toEqual([]);
  });
});

describe("display helpers", () => {
  it("formats ppm as a signed percentage", () => {
    expect(formatPpm(74_300)).toBe("+7.43%");
    expect(formatPpm(-50_000)).toBe("-5.00%");
    expect(formatPpm(0)).toBe("0.00%");
  });

  it("trims trailing zeros from fractional share counts", () => {
    expect(formatShares(1_500_000n)).toBe("1.5");
    expect(formatShares(12n * MICRO)).toBe("12");
    expect(formatShares(1_234_500n)).toBe("1.2345");
  });
});

describe("short positions", () => {
  // BigInt's `/` truncates toward zero, so -3.5 becomes -3. For a long that is
  // already flooring and nothing changes; for a SHORT it is the difference
  // between owing 334 and owing 333 — a liability quietly made smaller than it
  // is, in the holder's favour, which is the one direction the rounding rule
  // exists to forbid.
  it("floors toward negative infinity, not toward zero", () => {
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-8n, 2n)).toBe(-4n);
    expect(floorDiv(8n, 2n)).toBe(4n);
    expect(() => floorDiv(1n, 0n)).toThrow(/divide by zero/);
  });

  it("values a short as a negative amount, floored", () => {
    // 1.000001 shares short at 333 cents is -333.0003 cents of liability.
    expect(marketValue(-1_000_001n, 333n)).toBe(-334n);
    // The long of the same size is unchanged, so nothing about existing
    // portfolios moves.
    expect(marketValue(1_000_001n, 333n)).toBe(333n);
  });

  it("never understates a liability, at any size", () => {
    const price = 12_345n;
    for (let micro = 1n; micro < 5_000_000n; micro += 97_777n) {
      const short = marketValue(-micro, price);
      const long = marketValue(micro, price);
      // The short's liability is at least as large as the long's value — the
      // rounding goes against the holder in both directions.
      expect(-short).toBeGreaterThanOrEqual(long);
      expect(-short - long).toBeLessThanOrEqual(1n);
    }
  });

  it("sizes a short from a negative amount", () => {
    // -€10,000 of exposure at €200 is 50 shares short.
    expect(sharesFor(-1_000_000n, 20_000n)).toBe(-50n * MICRO);
    // Floored by magnitude, so a short is never opened bigger than asked for.
    const micro = sharesFor(-100_000n, 7_777n);
    expect(micro).toBeLessThan(0n);
    expect(absShares(micro)).toBeLessThanOrEqual((100_000n * MICRO) / 7_777n);
  });

  it("rounds a whole-share short down in magnitude too", () => {
    expect(sharesFor(-481_200n, 40_000n, { fractional: false })).toBe(-12n * MICRO);
  });

  it("refuses to make a negative value a slice of a pie", () => {
    // A short cannot be part of a whole. The chart splits them out; this guard
    // makes a mistake loud rather than a donut that sums to something odd.
    expect(() => allocateWeightsPpm([100n, -50n], 50n)).toThrow(/cannot be a share of a whole/);
  });

  it("gives absShares the magnitude either way", () => {
    expect(absShares(-5n)).toBe(5n);
    expect(absShares(5n)).toBe(5n);
    expect(absShares(0n)).toBe(0n);
  });
});
