import type { PrismaClient } from "@/generated/prisma/client";
import { eachTradingDay, type DateKey } from "@/lib/dates";
import { createMarketDataProvider } from "@/server/market";
import type { MockStockProfile } from "@/server/market/mock";
import type { JobContext, JobResult } from "./run";

/**
 * Writing price history.
 *
 * Idempotent by construction: bars are upserted on (stockId, tradeDate,
 * revision), so running the backfill ten times writes the same rows ten times.
 * That is what makes it safe to re-run after a crash and safe to catch up a
 * missed day without either needing a special case.
 *
 * Backfill runs in ascending date order, because `prevCloseCents` and the mock
 * generator's walk both depend on the day before.
 */

/** Deterministic 32-bit hash — same symbol, same number, on every machine. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Profiles for the synthetic generator, derived from the database rather than
 * from a fixture — so a stock an admin adds next week gets a plausible series
 * without anyone editing code, and `src/` never imports the demo data.
 *
 * The anchor is the stock's last known close; drift and volatility are derived
 * from the symbol, so they are stable across runs and spread across a realistic
 * range instead of making every name behave identically.
 */
export async function deriveMockProfiles(db: PrismaClient): Promise<MockStockProfile[]> {
  const stocks = await db.stock.findMany({
    where: { deletedAt: null },
    select: { symbol: true, lastPriceCents: true },
  });
  return stocks.map((stock) => {
    const seed = hash(stock.symbol);
    return {
      symbol: stock.symbol,
      // €50.00 is a neutral default for a stock that has never been priced.
      anchorCents: stock.lastPriceCents ?? 5_000n,
      // Annual drift spread across roughly -8% to +26%.
      driftBps: -800 + ((seed >>> 3) % 3_400),
      // Daily volatility across roughly 0.7% to 3.5%.
      volBps: 70 + ((seed >>> 11) % 280),
    };
  });
}

export async function backfillPrices(
  ctx: JobContext,
  args: { from: DateKey; to: DateKey; anchorDate?: DateKey; profiles?: MockStockProfile[] },
): Promise<JobResult> {
  const { db, log } = ctx;
  const anchorDate = args.anchorDate ?? args.from;

  const stocks = await db.stock.findMany({
    where: { deletedAt: null },
    select: { id: true, symbol: true },
  });
  if (stocks.length === 0) {
    log("No stocks exist yet — nothing to price.");
    return { itemsProcessed: 0 };
  }

  const profiles = args.profiles ?? (await deriveMockProfiles(db));
  const provider = createMarketDataProvider(profiles, anchorDate);
  const symbols = stocks.map((s) => s.symbol);
  const bars = await provider.bars(symbols, args.from, args.to);

  log(`${provider.name}: ${bars.length} bars, ${symbols.length} stocks, ${args.from}..${args.to}`);

  const idBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));
  const sorted = [...bars].sort((a, b) =>
    a.symbol === b.symbol
      ? a.tradeDate.localeCompare(b.tradeDate)
      : a.symbol.localeCompare(b.symbol),
  );

  let written = 0;
  let previousSymbol = "";
  let previousClose: bigint | null = null;

  for (const bar of sorted) {
    const stockId = idBySymbol.get(bar.symbol);
    if (!stockId) continue;
    if (bar.symbol !== previousSymbol) {
      previousSymbol = bar.symbol;
      previousClose = null;
    }
    const data = {
      closeCents: bar.closeCents,
      highCents: bar.highCents ?? null,
      lowCents: bar.lowCents ?? null,
      volume: bar.volume ?? null,
      prevCloseCents: previousClose,
      source: provider.name,
      isSynthetic: provider.isSynthetic,
    };
    await db.priceHistory.upsert({
      where: { stockId_tradeDate_revision: { stockId, tradeDate: bar.tradeDate, revision: 1 } },
      update: data,
      create: { stockId, tradeDate: bar.tradeDate, revision: 1, ...data },
    });
    previousClose = bar.closeCents;
    written++;
  }

  const cached = await refreshQuoteCache(db, provider.name);
  log(`wrote ${written} price rows, refreshed ${cached} quotes`);
  return { itemsProcessed: written, detail: { from: args.from, to: args.to } };
}

/**
 * The newest close doubles as the quote cache on Stock, so a page wanting "the
 * current price" does not have to find the newest PriceHistory row itself.
 */
export async function refreshQuoteCache(db: PrismaClient, source: string): Promise<number> {
  const stocks = await db.stock.findMany({ where: { deletedAt: null }, select: { id: true } });
  let updated = 0;
  for (const stock of stocks) {
    const latest = await db.priceHistory.findFirst({
      where: { stockId: stock.id, supersededAt: null },
      orderBy: [{ tradeDate: "desc" }, { revision: "desc" }],
      select: { closeCents: true, tradeDate: true },
    });
    if (!latest) continue;
    await db.stock.update({
      where: { id: stock.id },
      data: {
        lastPriceCents: latest.closeCents,
        lastPriceAt: new Date(`${latest.tradeDate}T22:00:00Z`),
        lastPriceSource: source,
      },
    });
    updated++;
  }
  return updated;
}

/**
 * Trading days between the last stored close and `throughDate`. A job that has
 * never run backfills the whole competition; one that ran yesterday writes one
 * day. Neither needs a different code path.
 */
export async function missingTradingDays(
  db: PrismaClient,
  fromDate: DateKey,
  throughDate: DateKey,
): Promise<DateKey[]> {
  const latest = await db.priceHistory.findFirst({
    orderBy: { tradeDate: "desc" },
    select: { tradeDate: true },
  });
  const start = latest && latest.tradeDate > fromDate ? latest.tradeDate : fromDate;
  return eachTradingDay(start, throughDate);
}
