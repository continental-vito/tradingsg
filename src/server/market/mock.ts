import { eachTradingDay, type DateKey } from "@/lib/dates";
import type { DailyBar, MarketDataProvider, Quote } from "./provider";

/**
 * A deterministic synthetic market.
 *
 * This is not a toy. It is the default provider, it needs no API key, it works
 * offline, and it is what generates the weeks of history the demo data needs.
 * Two properties make it useful rather than merely present:
 *
 * 1. DETERMINISM. The price of a symbol on a date is a pure function of
 *    (seed, symbol, date). Re-running the backfill produces byte-identical
 *    bars, so a valuation computed today and recomputed next month agree — and
 *    a reseed does not silently reshuffle the demo leaderboard.
 *
 * 2. A SHARED MARKET FACTOR. Independent random walks give thirty participants
 *    thirty uncorrelated portfolios, which converge on the same return and make
 *    the leaderboard meaningless noise. Real portfolios move together because
 *    the market does. Each day's move is a market component plus an
 *    idiosyncratic one, scaled by the stock's own beta and volatility, so
 *    diversification behaves the way a participant expects it to.
 */

/** Deterministic 32-bit hash. Same string, same number, on every machine. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform in [0, 1) from a 32-bit state. */
function uniform(state: number): number {
  let x = state;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 4294967296;
}

/** Standard normal via Box-Muller, from two deterministic uniforms. */
function normal(seedA: number, seedB: number): number {
  const u1 = Math.max(uniform(seedA), 1e-9);
  const u2 = uniform(seedB);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface MockStockProfile {
  symbol: string;
  anchorCents: bigint;
  /** Annualised drift in basis points. 900 = +9%/year. */
  driftBps: number;
  /** Daily volatility in basis points. 145 = 1.45% a day. */
  volBps: number;
}

/** Trading days in a year, for converting annual drift to a daily step. */
const TRADING_DAYS = 252;

export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock";
  readonly isSynthetic = true;

  private readonly profiles: Map<string, MockStockProfile>;

  constructor(
    profiles: MockStockProfile[],
    private readonly seed: number,
    /** The date the anchor prices are true on. The series is generated forward from here. */
    private readonly anchorDate: DateKey,
  ) {
    this.profiles = new Map(profiles.map((p) => [p.symbol, p]));
  }

  /**
   * The market's move on a given day, shared by every symbol. This is what
   * makes a portfolio of eight names behave like a portfolio rather than like
   * eight independent coin flips.
   */
  private marketMove(tradeDate: DateKey): number {
    return normal(
      hash(`${this.seed}:market:${tradeDate}`),
      hash(`${this.seed}:market2:${tradeDate}`),
    );
  }

  /**
   * A stock's beta to the shared factor, derived from its symbol so it is
   * stable. Spread across roughly 0.55–1.45, which is a realistic range.
   */
  private betaOf(symbol: string): number {
    return 0.55 + uniform(hash(`${this.seed}:beta:${symbol}`)) * 0.9;
  }

  private closeOn(profile: MockStockProfile, tradeDate: DateKey): bigint {
    const days = eachTradingDay(this.anchorDate, tradeDate);
    const beta = this.betaOf(profile.symbol);
    const dailyDrift = profile.driftBps / 10_000 / TRADING_DAYS;
    const dailyVol = profile.volBps / 10_000;

    // Log-space accumulation, so the series can never go negative and a -50%
    // day followed by a +50% day does not return to par (it should not).
    let logPrice = Math.log(Number(profile.anchorCents));

    for (const day of days) {
      if (day === this.anchorDate) continue;
      const idiosyncratic = normal(
        hash(`${this.seed}:${profile.symbol}:${day}`),
        hash(`${this.seed}:${profile.symbol}:${day}:b`),
      );
      // Beta-weighted market move plus the stock's own noise. The 0.75/0.66
      // split keeps total variance close to the configured volatility.
      const shock = dailyVol * (beta * 0.75 * this.marketMove(day) + 0.66 * idiosyncratic);
      logPrice += dailyDrift - (dailyVol * dailyVol) / 2 + shock;
    }

    const cents = Math.round(Math.exp(logPrice));
    // A price of zero would make sharesFor throw and a holding unvaluable. One
    // cent is the floor, and reaching it means the generator is misconfigured.
    return BigInt(Math.max(1, cents));
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    const today = new Date().toISOString().slice(0, 10);
    return symbols.flatMap((symbol) => {
      const profile = this.profiles.get(symbol);
      if (!profile) return [];
      return [{ symbol, priceCents: this.closeOn(profile, today), asOf: new Date() }];
    });
  }

  async bars(symbols: string[], from: DateKey, to: DateKey): Promise<DailyBar[]> {
    const out: DailyBar[] = [];
    for (const symbol of symbols) {
      const profile = this.profiles.get(symbol);
      if (!profile) continue;
      for (const tradeDate of eachTradingDay(from, to)) {
        const closeCents = this.closeOn(profile, tradeDate);
        // Intraday range around the close, deterministic like everything else.
        const spread = uniform(hash(`${this.seed}:${symbol}:${tradeDate}:hl`)) * 0.012;
        const high = BigInt(Math.round(Number(closeCents) * (1 + spread)));
        const low = BigInt(Math.round(Number(closeCents) * (1 - spread)));
        out.push({
          symbol,
          tradeDate,
          closeCents,
          highCents: high,
          lowCents: low < 1n ? 1n : low,
          volume: BigInt(
            Math.round(
              500_000 + uniform(hash(`${this.seed}:${symbol}:${tradeDate}:v`)) * 4_000_000,
            ),
          ),
        });
      }
    }
    return out;
  }
}
