import { describe, expect, it } from "vitest";
import { MarketDataError } from "./provider";
import { assertEuroCurrency, mapBars, type RawBar } from "./yahoo";

/**
 * No network. CI must not depend on an unofficial endpoint that answers 429 to
 * a bare request — these cover the two rules that would silently corrupt
 * portfolios if they regressed.
 */

describe("assertEuroCurrency", () => {
  it("accepts a euro listing", () => {
    expect(() => assertEuroCurrency("AAPL", "APC.DE", "EUR")).not.toThrow();
  });

  // The whole reason the universe uses XETRA lines. Apple at $326.57 booked as
  // €326.57 would silently misprice every portfolio holding it, and nothing
  // downstream could tell.
  it("refuses a dollar listing rather than booking it as euro", () => {
    expect(() => assertEuroCurrency("AAPL", "AAPL", "USD")).toThrow(MarketDataError);
    expect(() => assertEuroCurrency("AAPL", "AAPL", "USD")).toThrow(/quoted in USD/);
    // The message has to name the fix, not just the problem.
    expect(() => assertEuroCurrency("AAPL", "AAPL", "USD")).toThrow(/APC\.DE/);
  });

  it("refuses GBp, which is pence and a hundredfold error", () => {
    // Shell's London line returns 3533.00 GBp — that is £35.33, not £3,533.
    expect(() => assertEuroCurrency("SHEL", "SHEL.L", "GBp")).toThrow(/GBp/);
  });

  it("refuses a missing currency instead of assuming euro", () => {
    expect(() => assertEuroCurrency("X", "X", undefined)).toThrow(/unknown currency/);
  });
});

describe("mapBars", () => {
  const from = "2026-09-01";
  const to = "2026-09-04";
  const bar = (day: string, close: number | null): RawBar => ({
    date: new Date(`${day}T00:00:00.000Z`),
    close,
    high: close === null ? null : close + 1,
    low: close === null ? null : close - 1,
    volume: 1234,
  });

  it("converts a close to integer cents", () => {
    const [mapped] = mapBars("SAP", [bar("2026-09-02", 182.86)], from, to);
    expect(mapped?.closeCents).toBe(18_286n);
    expect(mapped?.tradeDate).toBe("2026-09-02");
  });

  // The trap: European symbols return today's bar with a null close until the
  // exchange settles. Storing it writes a null price and breaks every
  // valuation that reads that date.
  it("drops the unsettled bar rather than storing a null price", () => {
    const mapped = mapBars("SAP", [bar("2026-09-02", 182.86), bar("2026-09-03", null)], from, to);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.tradeDate).toBe("2026-09-02");
  });

  it("drops a zero or negative close", () => {
    expect(mapBars("SAP", [bar("2026-09-02", 0)], from, to)).toHaveLength(0);
    expect(mapBars("SAP", [bar("2026-09-02", -5)], from, to)).toHaveLength(0);
  });

  it("drops bars outside the range asked for", () => {
    const mapped = mapBars(
      "SAP",
      [bar("2026-08-31", 100), bar("2026-09-02", 101), bar("2026-09-09", 102)],
      from,
      to,
    );
    expect(mapped.map((b) => b.tradeDate)).toEqual(["2026-09-02"]);
  });

  it("keeps high, low and volume when present and omits them when not", () => {
    const [withExtras] = mapBars("SAP", [bar("2026-09-02", 100)], from, to);
    expect(withExtras?.highCents).toBe(10_100n);
    expect(withExtras?.lowCents).toBe(9_900n);
    expect(withExtras?.volume).toBe(1234n);

    const [bare] = mapBars(
      "SAP",
      [{ date: new Date("2026-09-02T00:00:00.000Z"), close: 100 }],
      from,
      to,
    );
    expect(bare?.highCents).toBeUndefined();
    expect(bare?.volume).toBeUndefined();
  });
});
