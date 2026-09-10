import { env } from "@/lib/env";
import { FinnhubMarketDataProvider } from "./finnhub";
import { MockMarketDataProvider, type MockStockProfile } from "./mock";
import type { MarketDataProvider } from "./provider";

export type { DailyBar, MarketDataProvider, Quote } from "./provider";
export { MarketDataError } from "./provider";

/**
 * Resolves the configured provider.
 *
 * The mock provider needs each stock's anchor price and volatility. Callers
 * supply them — the price job derives them from the database, the seed passes
 * the hand-tuned fixture values — so that this module never reaches for the
 * database itself and stays importable from the job runtime, which has no
 * React around it.
 */
export function createMarketDataProvider(
  profiles: MockStockProfile[] = [],
  anchorDate = "2026-01-02",
): MarketDataProvider {
  switch (env.MARKET_DATA_PROVIDER) {
    case "finnhub":
      return new FinnhubMarketDataProvider(env.FINNHUB_API_KEY ?? "");
    case "mock":
      return new MockMarketDataProvider(profiles, env.MOCK_MARKET_SEED, anchorDate);
  }
}
