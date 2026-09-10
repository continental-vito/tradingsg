import YahooFinance from "yahoo-finance2";
import { dateKeyOf, type DateKey } from "@/lib/dates";
import { MarketDataError, type DailyBar, type MarketDataProvider, type Quote } from "./provider";

/**
 * Yahoo Finance. The only file in the codebase that knows this provider exists.
 *
 * Chosen over Finnhub because it returns HISTORICAL DAILY CANDLES for free, and
 * this app cannot value a portfolio backwards without them — Finnhub's free
 * tier has quotes only, which is why its adapter throws on bars().
 *
 * Two things about it are worth knowing before relying on it:
 *
 * 1. There has been no official public Yahoo Finance API since 2017. This is an
 *    undocumented endpoint, and the library exists to keep up with its cookie
 *    and crumb handshake. A raw fetch is answered with 429 immediately. It is
 *    appropriate for one daily job over a few dozen symbols and nothing more
 *    chatty than that.
 * 2. It answers in the LISTING's currency, which is not necessarily the
 *    competition's. See the guard in `assertEuro` below — the alternative is
 *    booking $326.57 as €326.57 and quietly corrupting every portfolio that
 *    holds it.
 */

/** The currency every price in this competition must already be quoted in. */
const REQUIRED_CURRENCY = "EUR";

export class YahooMarketDataProvider implements MarketDataProvider {
  readonly name = "yahoo";
  readonly isSynthetic = false;

  private readonly client: InstanceType<typeof YahooFinance>;

  /**
   * `symbolMap` translates our ticker to the listing to fetch — AAPL to APC.DE,
   * the Xetra line quoted in euro. Anything absent is fetched under its own
   * name.
   */
  constructor(private readonly symbolMap: ReadonlyMap<string, string> = new Map()) {
    this.client = new YahooFinance({
      // Both are informational banners the library prints on import. Neither is
      // an error, and neither belongs in a cron log.
      suppressNotices: ["yahooSurvey", "ripHistorical"],
    });
  }

  private toProvider(symbol: string): string {
    return this.symbolMap.get(symbol) ?? symbol;
  }

  private assertEuro(ourSymbol: string, providerSymbol: string, currency: string | undefined) {
    assertEuroCurrency(ourSymbol, providerSymbol, currency);
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    const out: Quote[] = [];
    for (const symbol of symbols) {
      const providerSymbol = this.toProvider(symbol);
      try {
        const q = await this.client.quote(providerSymbol);
        const price = q?.regularMarketPrice;
        if (price == null || price <= 0) continue;
        this.assertEuro(symbol, providerSymbol, q.currency);
        out.push({
          symbol,
          priceCents: BigInt(Math.round(price * 100)),
          asOf: q.regularMarketTime ? new Date(q.regularMarketTime) : new Date(),
        });
      } catch (error: unknown) {
        if (error instanceof MarketDataError) throw error;
        // One unknown ticker must not cost the whole run. It is omitted, and
        // the price ladder then carries its last close forward and flags the
        // valuation rather than pretending the holding is worthless.
        console.warn(`[yahoo] no quote for ${symbol} (${providerSymbol}):`, error);
      }
    }
    return out;
  }

  async bars(symbols: string[], from: DateKey, to: DateKey): Promise<DailyBar[]> {
    const out: DailyBar[] = [];

    for (const symbol of symbols) {
      const providerSymbol = this.toProvider(symbol);
      let result;
      try {
        result = await this.client.chart(providerSymbol, {
          period1: from,
          // Exclusive upper bound, so ask for the day after the one wanted.
          period2: addOneDay(to),
          interval: "1d",
        });
      } catch (error: unknown) {
        throw new MarketDataError(
          `Yahoo could not return history for ${symbol} (${providerSymbol}): ${error instanceof Error ? error.message : String(error)}. ` +
            `Check the ticker on finance.yahoo.com — the provider symbol is stored on the stock and can be corrected there.`,
          "HISTORY_FAILED",
        );
      }

      this.assertEuro(symbol, providerSymbol, result.meta?.currency);
      out.push(...mapBars(symbol, result.quotes ?? [], from, to));
    }

    return out;
  }
}

function toCents(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function addOneDay(key: DateKey): DateKey {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A price quoted in the wrong currency is worse than no price: the valuation
 * engine has no FX conversion and would book the number as euro. Refusing is
 * the only honest option, and the message names the fix.
 *
 * Exported so it can be tested without a network call — CI must not depend on
 * an unofficial endpoint that answers 429 to a bare request.
 */
export function assertEuroCurrency(
  ourSymbol: string,
  providerSymbol: string,
  currency: string | undefined,
): void {
  // Yahoo reports British listings as "GBp" — pence, a hundredth of a pound.
  // Named explicitly because it is the classic way to be a hundredfold wrong.
  if (currency !== REQUIRED_CURRENCY) {
    throw new MarketDataError(
      `${ourSymbol} (${providerSymbol}) is quoted in ${currency ?? "an unknown currency"}, not ${REQUIRED_CURRENCY}. ` +
        `This competition values everything in ${REQUIRED_CURRENCY} and does not convert, so the price has been refused rather than booked at the wrong scale. ` +
        `Use a ${REQUIRED_CURRENCY}-quoted listing for this stock — most US names have one on XETRA, for example AAPL as APC.DE.`,
      "WRONG_CURRENCY",
    );
  }
}

export interface RawBar {
  date?: Date | null;
  close?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

/**
 * Turns the provider's rows into bars, dropping the ones that must not be
 * stored. Exported for the same reason as the guard above.
 */
export function mapBars(
  symbol: string,
  raw: readonly RawBar[],
  from: DateKey,
  to: DateKey,
): DailyBar[] {
  const out: DailyBar[] = [];
  for (const bar of raw) {
    // The current day's bar arrives with a null close until the exchange
    // settles. Writing it would store a null price and break every valuation
    // that reads that date.
    if (bar.close == null || bar.close <= 0 || !bar.date) continue;
    const tradeDate = dateKeyOf(new Date(bar.date), "UTC");
    if (tradeDate < from || tradeDate > to) continue;
    out.push({
      symbol,
      tradeDate,
      closeCents: toCents(bar.close),
      ...(bar.high != null ? { highCents: toCents(bar.high) } : {}),
      ...(bar.low != null ? { lowCents: toCents(bar.low) } : {}),
      ...(bar.volume != null ? { volume: BigInt(Math.round(bar.volume)) } : {}),
    });
  }
  return out;
}
