import { dateKeyOf, type DateKey } from "@/lib/dates";
import { MarketDataError, type DailyBar, type MarketDataProvider, type Quote } from "./provider";

/**
 * Finnhub adapter.
 *
 * The only file in the codebase that knows this provider exists — the name is
 * grepped for by build/check-scripts.sh and must not appear anywhere else.
 *
 * Finnhub's free tier does not include historical daily candles. `bars()`
 * therefore throws a message that says exactly that and names the alternative,
 * rather than returning an empty array which would read as "the market was
 * closed for six weeks" and quietly rank everyone at 0%.
 */

const BASE = "https://finnhub.io/api/v1";

interface FinnhubQuote {
  c: number; // current
  pc: number; // previous close
  t: number; // unix seconds
}

function toCents(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

export class FinnhubMarketDataProvider implements MarketDataProvider {
  readonly name = "finnhub";
  readonly isSynthetic = false;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new MarketDataError(
        "Finnhub was selected but no API key was given. Set FINNHUB_API_KEY, or set MARKET_DATA_PROVIDER=mock.",
        "MISSING_API_KEY",
      );
    }
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("token", this.apiKey);

    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (response.status === 429) {
      throw new MarketDataError(
        "Finnhub rate limit reached. The free tier allows about 60 requests a minute; the price job will retry on its next run.",
        "RATE_LIMITED",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new MarketDataError(
        "Finnhub rejected the API key. Check FINNHUB_API_KEY in .env.",
        "BAD_API_KEY",
      );
    }
    if (!response.ok) {
      throw new MarketDataError(
        `Finnhub returned ${response.status} for ${path}. Prices were not updated on this run.`,
        "UPSTREAM_ERROR",
      );
    }
    return (await response.json()) as T;
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    const out: Quote[] = [];
    for (const symbol of symbols) {
      const q = await this.get<FinnhubQuote>("/quote", { symbol });
      // Finnhub answers an unknown symbol with zeroes rather than an error.
      // Passing that through would value the holding at nothing, so an unknown
      // symbol is omitted instead — the price ladder then carries the last
      // known close forward and flags the valuation, which is the truthful
      // outcome.
      if (!q.c || q.c <= 0) continue;
      out.push({
        symbol,
        priceCents: toCents(q.c),
        asOf: q.t ? new Date(q.t * 1000) : new Date(),
      });
    }
    return out;
  }

  async bars(_symbols: string[], _from: DateKey, _to: DateKey): Promise<DailyBar[]> {
    throw new MarketDataError(
      "Historical daily candles are not available on Finnhub's free tier. " +
        "Backfill history with MARKET_DATA_PROVIDER=mock, or upgrade the plan and implement /stock/candle here.",
      "HISTORY_UNSUPPORTED",
    );
  }

  /** Exposed so the price job can record the date a quote belongs to. */
  static tradeDateOf(quote: Quote, timezone: string): DateKey {
    return dateKeyOf(quote.asOf, timezone);
  }
}
