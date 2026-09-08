import "server-only";
import { db } from "@/server/db";
import { toPpm } from "@/server/money";
import { money, ratio, type MoneyDto, type RatioDto } from "./serialize";

/**
 * Competition analytics.
 *
 * Read from the last leaderboard snapshot and its valuations rather than
 * recomputed, so the admin's numbers and the participants' numbers are the same
 * numbers. An analytics page that quietly disagrees with the leaderboard is how
 * a "the app is wrong" conversation starts.
 */

export interface StockPopularity {
  symbol: string;
  name: string;
  holders: number;
  holderPct: number;
  averageWeightPpm: number;
  totalValue: MoneyDto;
  priceReturn: RatioDto | null;
}

export interface AnalyticsDto {
  participants: { total: number; invested: number; ranked: number };
  returns: { mean: RatioDto; median: RatioDto; best: RatioDto; worst: RatioDto };
  aum: MoneyDto;
  asOfDate: string | null;
  popular: StockPopularity[];
  /**
   * Mean of each portfolio's largest position weight. A competition where the
   * average biggest bet is 80% is a coin-flipping contest, and the admin should
   * be able to see that before the prize is handed out.
   */
  concentration: { averageTopWeightPpm: number; averagePositions: number };
}

export async function loadAnalytics(competitionId: string): Promise<AnalyticsDto> {
  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: { entries: true },
  });

  const [total, invested] = await Promise.all([
    db.participant.count({ where: { competitionId, deletedAt: null } }),
    db.portfolio.count({ where: { competitionId, setupCompletedAt: { not: null } } }),
  ]);

  const competition = await db.competition.findUniqueOrThrow({
    where: { id: competitionId },
    select: { currency: true },
  });
  const currency = competition.currency;

  const ranked = (snapshot?.entries ?? []).filter((e) => e.rank !== null);
  const returns = ranked.map((e) => e.totalReturnPpm).sort((a, b) => a - b);
  const mean =
    returns.length > 0 ? Math.round(returns.reduce((a, b) => a + b, 0) / returns.length) : 0;

  const holdingValuations = snapshot
    ? await db.holdingValuation.findMany({
        where: { valuation: { competitionId, asOfDate: snapshot.asOfDate, kind: "EOD" } },
        include: { stock: { select: { symbol: true, name: true, id: true } } },
      })
    : [];

  const byStock = new Map<
    string,
    { symbol: string; name: string; holders: number; weightSum: number; value: bigint }
  >();
  for (const hv of holdingValuations) {
    if (hv.microShares <= 0n) continue;
    const entry = byStock.get(hv.stockId) ?? {
      symbol: hv.stock.symbol,
      name: hv.stock.name,
      holders: 0,
      weightSum: 0,
      value: 0n,
    };
    entry.holders += 1;
    entry.weightSum += hv.weightPpm;
    entry.value += hv.marketValueCents;
    byStock.set(hv.stockId, entry);
  }

  // Each stock's own price move over the competition, so the admin can see
  // whether a popular name was actually a good one.
  const priceMoves = new Map<string, number>();
  for (const stockId of byStock.keys()) {
    const [first, last] = await Promise.all([
      db.priceHistory.findFirst({
        where: { stockId, supersededAt: null },
        orderBy: { tradeDate: "asc" },
        select: { closeCents: true },
      }),
      db.priceHistory.findFirst({
        where: { stockId, supersededAt: null },
        orderBy: { tradeDate: "desc" },
        select: { closeCents: true },
      }),
    ]);
    if (first && last && first.closeCents > 0n) {
      priceMoves.set(stockId, toPpm(last.closeCents - first.closeCents, first.closeCents));
    }
  }

  const popular: StockPopularity[] = [...byStock.entries()]
    .map(([stockId, e]) => ({
      symbol: e.symbol,
      name: e.name,
      holders: e.holders,
      holderPct: invested > 0 ? Math.round((e.holders / invested) * 100) : 0,
      averageWeightPpm: e.holders > 0 ? Math.round(e.weightSum / e.holders) : 0,
      totalValue: money(e.value, currency),
      priceReturn: priceMoves.has(stockId) ? ratio(priceMoves.get(stockId) ?? 0) : null,
    }))
    .sort((a, b) => b.holders - a.holders || b.averageWeightPpm - a.averageWeightPpm);

  // Concentration: the largest single weight in each portfolio, averaged.
  const topWeightByValuation = new Map<string, number>();
  const positionsByValuation = new Map<string, number>();
  for (const hv of holdingValuations) {
    if (hv.microShares <= 0n) continue;
    topWeightByValuation.set(
      hv.valuationId,
      Math.max(topWeightByValuation.get(hv.valuationId) ?? 0, hv.weightPpm),
    );
    positionsByValuation.set(hv.valuationId, (positionsByValuation.get(hv.valuationId) ?? 0) + 1);
  }
  const topWeights = [...topWeightByValuation.values()];
  const positionCounts = [...positionsByValuation.values()];

  return {
    participants: { total, invested, ranked: ranked.length },
    returns: {
      mean: ratio(mean),
      median: ratio(
        returns.length === 0
          ? 0
          : returns.length % 2 === 1
            ? (returns[(returns.length - 1) / 2] ?? 0)
            : Math.round(
                ((returns[returns.length / 2 - 1] ?? 0) + (returns[returns.length / 2] ?? 0)) / 2,
              ),
      ),
      best: ratio(returns[returns.length - 1] ?? 0),
      worst: ratio(returns[0] ?? 0),
    },
    aum: money(snapshot?.totalAumCents ?? 0n, currency),
    asOfDate: snapshot?.asOfDate ?? null,
    popular,
    concentration: {
      averageTopWeightPpm:
        topWeights.length > 0
          ? Math.round(topWeights.reduce((a, b) => a + b, 0) / topWeights.length)
          : 0,
      averagePositions:
        positionCounts.length > 0
          ? Math.round((positionCounts.reduce((a, b) => a + b, 0) / positionCounts.length) * 10) /
            10
          : 0,
    },
  };
}
