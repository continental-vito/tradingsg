import type { Cents } from "@/server/money";
import type { DateKey } from "@/lib/dates";

/**
 * The seam every price crosses.
 *
 * No provider's name appears outside its own file in this directory —
 * `build/check-scripts.sh` greps for `finnhub` across `src/` and fails CI on a
 * hit anywhere else. That grep is the only thing keeping "swap the provider"
 * a configuration change rather than a project.
 */

export interface Quote {
  symbol: string;
  priceCents: Cents;
  /** When the provider last observed this price, not when we asked. */
  asOf: Date;
}

export interface DailyBar {
  symbol: string;
  tradeDate: DateKey;
  closeCents: Cents;
  openCents?: Cents;
  highCents?: Cents;
  lowCents?: Cents;
  volume?: bigint;
}

export interface MarketDataProvider {
  /** Stable identifier written to PriceHistory.source, so a row says where it came from. */
  readonly name: string;
  /** True when the bars this provider returns are generated rather than observed. */
  readonly isSynthetic: boolean;

  /** Latest price per symbol. Symbols the provider does not know are omitted, not zeroed. */
  quotes(symbols: string[]): Promise<Quote[]>;

  /** Daily closes over an inclusive date range. Non-trading days are omitted. */
  bars(symbols: string[], from: DateKey, to: DateKey): Promise<DailyBar[]>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}
