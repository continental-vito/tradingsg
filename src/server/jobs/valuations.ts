import { dateKeyToUtc, type DateKey } from "@/lib/dates";
import { buildPriceBook } from "@/server/portfolio/prices";
import { assertPnlIdentity } from "@/server/portfolio/invariant";
import {
  chainLinkedTwrPpm,
  periodReturnPpm,
  valuePortfolio,
  type PortfolioState,
} from "@/server/portfolio/value";
import type { JobContext, JobResult } from "./run";

/**
 * The daily valuation.
 *
 * Reads only immutable PriceHistory, never a live quote, so re-running it for a
 * past date produces byte-identical numbers. `previousValuationId` chains the
 * rows rather than date arithmetic finding "yesterday": over a weekend Monday's
 * daily return is measured against Friday, and a market holiday must not
 * silently become a 0% day.
 *
 * Idempotent on (portfolioId, asOfDate, kind): the child HoldingValuation set
 * can change between runs, so the row is deleted and rebuilt rather than
 * upserted in place.
 */
export async function snapshotValuations(
  ctx: JobContext,
  args: { competitionId: string; asOfDate: DateKey },
): Promise<JobResult> {
  const { db, log } = ctx;
  const { competitionId, asOfDate } = args;

  const portfolios = await db.portfolio.findMany({
    where: { competitionId, participant: { deletedAt: null } },
    include: {
      holdings: { include: { stock: { select: { symbol: true } } } },
      participant: { select: { id: true, initialCapitalCents: true } },
    },
  });

  if (portfolios.length === 0) {
    log("No portfolios to value.");
    return { itemsProcessed: 0 };
  }

  let valued = 0;
  let degraded = 0;

  for (const portfolio of portfolios) {
    const stockIds = portfolio.holdings.filter((h) => h.microShares > 0n).map((h) => h.stockId);

    const book = await buildPriceBook(db, stockIds, asOfDate, {
      costBasisFallback: new Map(
        portfolio.holdings.map((h) => [
          h.stockId,
          { microShares: h.microShares, costBasisCents: h.costBasisCents },
        ]),
      ),
    });
    if (book.quality !== "OK") degraded++;

    const state: PortfolioState = {
      cashCents: portfolio.cashCents,
      initialCapitalCents: portfolio.initialCapitalCents,
      netFlowCents: portfolio.netFlowCents,
      realizedPnlCents: portfolio.realizedPnlCents,
      holdings: portfolio.holdings.map((h) => ({
        stockId: h.stockId,
        symbol: h.stock.symbol,
        microShares: h.microShares,
        costBasisCents: h.costBasisCents,
        realizedPnlCents: h.realizedPnlCents,
      })),
    };

    const value = valuePortfolio(state, book);

    // The P/L identity holds by construction for any trade history. Checking it
    // here means a bug in the ledger surfaces as a failed valuation job with a
    // named portfolio, not as an unexplained leaderboard position weeks later.
    assertPnlIdentity(portfolio.id, {
      totalValueCents: value.totalValueCents,
      initialCapitalCents: portfolio.initialCapitalCents,
      netFlowCents: portfolio.netFlowCents,
      realizedPnlCents: portfolio.realizedPnlCents,
      unrealizedPnlCents: value.unrealizedPnlCents,
    });

    const previous = await db.portfolioValuation.findFirst({
      where: { portfolioId: portfolio.id, kind: "EOD", asOfDate: { lt: asOfDate } },
      orderBy: { asOfDate: "desc" },
    });

    // Zero on the first valuation, NOT minus the initial capital. The starting
    // grant is the baseline the return is measured FROM, not a flow that
    // happened during the period. Treating it as a flow made the first chain
    // link's base zero, which the TWR skips — so every portfolio's return was
    // measured from its first close rather than from its starting capital, and
    // the leaderboard disagreed with the value column beside it.
    const flowInPeriodCents = previous ? portfolio.netFlowCents - previous.netFlowCents : 0n;

    const dailyReturnPpm = previous
      ? periodReturnPpm(previous.totalValueCents, value.totalValueCents, flowInPeriodCents)
      : null;

    // A week ago by valuation row, not by calendar subtraction.
    const weekAgo = await db.portfolioValuation.findFirst({
      where: {
        portfolioId: portfolio.id,
        kind: "EOD",
        asOfDate: { lte: shiftDate(asOfDate, -7) },
      },
      orderBy: { asOfDate: "desc" },
    });
    const weeklyReturnPpm = weekAgo
      ? periodReturnPpm(weekAgo.totalValueCents, value.totalValueCents)
      : null;

    // Strictly BEFORE this date. A re-run finds its own previous row still
    // present — it is deleted further down — and including it would put the
    // same day in the chain twice.
    const series = await db.portfolioValuation.findMany({
      where: { portfolioId: portfolio.id, kind: "EOD", asOfDate: { lt: asOfDate } },
      orderBy: { asOfDate: "asc" },
      select: { totalValueCents: true, flowInPeriodCents: true },
    });
    const twrPpm = chainLinkedTwrPpm([
      { valueCents: portfolio.initialCapitalCents, flowCents: 0n },
      ...series.map((s) => ({ valueCents: s.totalValueCents, flowCents: s.flowInPeriodCents })),
      { valueCents: value.totalValueCents, flowCents: flowInPeriodCents },
    ]);

    await db.$transaction(async (tx) => {
      const existing = await tx.portfolioValuation.findUnique({
        where: {
          portfolioId_asOfDate_kind: { portfolioId: portfolio.id, asOfDate, kind: "EOD" },
        },
        select: { id: true },
      });
      if (existing) {
        await tx.holdingValuation.deleteMany({ where: { valuationId: existing.id } });
        await tx.portfolioValuation.delete({ where: { id: existing.id } });
      }

      const created = await tx.portfolioValuation.create({
        data: {
          portfolioId: portfolio.id,
          participantId: portfolio.participantId,
          competitionId,
          asOfDate,
          asOfAt: dateKeyToUtc(asOfDate),
          kind: "EOD",
          cashCents: value.cashCents,
          holdingsValueCents: value.holdingsValueCents,
          totalValueCents: value.totalValueCents,
          initialCapitalCents: portfolio.initialCapitalCents,
          netFlowCents: portfolio.netFlowCents,
          flowInPeriodCents,
          costBasisCents: value.costBasisCents,
          realizedPnlCents: value.realizedPnlCents,
          unrealizedPnlCents: value.unrealizedPnlCents,
          cumulativeFeesCents: portfolio.totalFeesCents,
          totalReturnPpm: value.totalReturnPpm,
          twrPpm,
          dailyReturnPpm,
          weeklyReturnPpm,
          periodReturnPpm: dailyReturnPpm,
          positionCount: value.positionCount,
          priceQuality: book.quality,
          stalePriceCount: book.staleCount,
          // A portfolio that has never bought anything is all cash at exactly
          // 0.00%. It is excluded from the ranking, not ranked mid-table.
          isRankEligible: portfolio.setupCompletedAt !== null && value.positionCount > 0,
          previousValuationId: previous?.id ?? null,
        },
      });

      for (const holding of value.holdings) {
        await tx.holdingValuation.create({
          data: {
            valuationId: created.id,
            stockId: holding.stockId,
            microShares: holding.microShares,
            priceCents: holding.priceCents,
            priceSource: holding.priceSource,
            priceAgeDays: holding.priceAgeDays,
            marketValueCents: holding.marketValueCents,
            costBasisCents: holding.costBasisCents,
            unrealizedPnlCents: holding.unrealizedPnlCents,
            realizedPnlCents:
              portfolio.holdings.find((h) => h.stockId === holding.stockId)?.realizedPnlCents ?? 0n,
            weightPpm: holding.weightPpm,
            positionReturnPpm: holding.positionReturnPpm,
            dayChangePpm: null,
          },
        });
      }

      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { updatedAt: new Date() },
      });
    });

    valued++;
  }

  log(
    `valued ${valued} portfolios at ${asOfDate}${degraded > 0 ? ` (${degraded} with degraded prices)` : ""}`,
  );
  return { itemsProcessed: valued, detail: { asOfDate, degraded } };
}

function shiftDate(key: DateKey, days: number): DateKey {
  const d = dateKeyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
