import type { PrismaClient } from "@/generated/prisma/client";
import type { DateKey } from "@/lib/dates";
import { daysBetween } from "@/lib/dates";
import type { Cents } from "@/server/money";
import { divRound, MICRO } from "@/server/money";

/**
 * Resolving a price for a stock on a date.
 *
 * The one rule that matters: a missing price is NEVER zero and the position is
 * NEVER dropped from the sum. Both fabricate a -100% loss on that holding and
 * silently rank someone last. The ladder below always produces a number, and
 * always says how confident it is.
 */

export type PricePointSource = "CLOSE" | "CARRY_FORWARD" | "INTRADAY" | "COST_BASIS";
export type PriceQuality = "OK" | "PARTIAL" | "DEGRADED";

export interface PricePoint {
  stockId: string;
  priceCents: Cents;
  source: PricePointSource;
  /** How many calendar days old the close is. 0 on the trade date itself. */
  ageDays: number;
}

export interface PriceBook {
  get(stockId: string): PricePoint | undefined;
  readonly quality: PriceQuality;
  readonly staleCount: number;
  readonly asOfDate: DateKey;
}

class Book implements PriceBook {
  constructor(
    private readonly points: Map<string, PricePoint>,
    readonly quality: PriceQuality,
    readonly staleCount: number,
    readonly asOfDate: DateKey,
  ) {}
  get(stockId: string) {
    return this.points.get(stockId);
  }
}

export interface BuildPriceBookOptions {
  /** Cost basis per holding, used only by the last rung of the ladder. */
  costBasisFallback?: Map<string, { microShares: bigint; costBasisCents: Cents }>;
  maxStalenessDays?: number;
}

/**
 * Builds the price book used to value a portfolio at `asOfDate`.
 *
 * Only immutable PriceHistory rows are read — never a live quote — which is
 * what makes a valuation reproducible: re-running it next month returns the
 * same numbers it returned today.
 *
 * The ladder, in order:
 *   1. A close on exactly `asOfDate`                     → CLOSE
 *   2. The most recent close before it                   → CARRY_FORWARD
 *      (correct for weekends, holidays and trading halts)
 *   3. As (2), but older than the staleness limit        → CARRY_FORWARD, DEGRADED
 *   4. No history at all, but the holding has a basis    → COST_BASIS, PARTIAL
 *      (contributes zero change rather than a fabricated loss)
 */
export async function buildPriceBook(
  db: PrismaClient,
  stockIds: string[],
  asOfDate: DateKey,
  options: BuildPriceBookOptions = {},
): Promise<PriceBook> {
  const maxStaleness = options.maxStalenessDays ?? 7;
  const points = new Map<string, PricePoint>();
  let stale = 0;
  let missing = 0;

  if (stockIds.length === 0) return new Book(points, "OK", 0, asOfDate);

  // One query for every stock, taking the newest non-superseded close at or
  // before the date. Doing this per stock would be N round trips per portfolio
  // per day of backfill, which is the difference between seconds and minutes.
  const rows = await db.priceHistory.findMany({
    where: { stockId: { in: stockIds }, tradeDate: { lte: asOfDate }, supersededAt: null },
    orderBy: [{ stockId: "asc" }, { tradeDate: "desc" }, { revision: "desc" }],
    select: { stockId: true, tradeDate: true, closeCents: true },
  });

  const newest = new Map<string, { tradeDate: DateKey; closeCents: bigint }>();
  for (const row of rows) {
    if (!newest.has(row.stockId)) {
      newest.set(row.stockId, { tradeDate: row.tradeDate, closeCents: row.closeCents });
    }
  }

  for (const stockId of stockIds) {
    const found = newest.get(stockId);
    if (found) {
      const ageDays = daysBetween(found.tradeDate, asOfDate);
      if (ageDays > maxStaleness) stale++;
      points.set(stockId, {
        stockId,
        priceCents: found.closeCents,
        source: ageDays === 0 ? "CLOSE" : "CARRY_FORWARD",
        ageDays,
      });
      continue;
    }

    const fallback = options.costBasisFallback?.get(stockId);
    if (fallback && fallback.microShares > 0n) {
      points.set(stockId, {
        stockId,
        priceCents: divRound(fallback.costBasisCents * MICRO, fallback.microShares),
        source: "COST_BASIS",
        ageDays: 0,
      });
      missing++;
      continue;
    }
    missing++;
  }

  const quality: PriceQuality = missing > 0 ? "PARTIAL" : stale > 0 ? "DEGRADED" : "OK";
  return new Book(points, quality, stale + missing, asOfDate);
}

export class MissingPriceError extends Error {
  constructor(symbolOrId: string, asOfDate: DateKey) {
    super(
      `No price is available for ${symbolOrId} on or before ${asOfDate}, and the holding has no cost basis to fall back on. ` +
        `Run the price backfill for this date range before valuing portfolios.`,
    );
    this.name = "MissingPriceError";
  }
}
