import { dateKeyToUtc, type DateKey } from "@/lib/dates";
import { buildPriceBook } from "@/server/portfolio/prices";
import { assertPnlIdentity } from "@/server/portfolio/invariant";
import { stateFromLedger } from "@/server/portfolio/ledger-state";
import { chainLinkedTwrPpm, periodReturnPpm, valuePortfolio } from "@/server/portfolio/value";
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

  // Read rather than assumed: the staleness limit is a configurable rule, and
  // the ladder was using a hardcoded seven days regardless of what was set.
  const settings = await db.competitionSettings.findFirst({
    where: { competitionId, supersededAt: null },
    orderBy: { revision: "desc" },
    select: { maxPriceStalenessDays: true },
  });
  const maxStalenessDays = settings?.maxPriceStalenessDays ?? 7;

  const portfolios = await db.portfolio.findMany({
    where: { competitionId, participant: { deletedAt: null } },
    include: {
      participant: { select: { id: true, initialCapitalCents: true } },
      // The position at THIS date's close, not now: catching up a missed night
      // must not value it with trades made since. Every ledger row up to and
      // including the day — a trade executes at that day's close — plus the
      // starting capital whatever its date: it is the baseline, and a launch
      // brought forward starts the competition before the date it carries.
      transactions: {
        where: { OR: [{ tradeDate: { lte: asOfDate } }, { type: "INITIAL_FUNDING" }] },
        select: {
          type: true,
          stockId: true,
          microShareDelta: true,
          cashDeltaCents: true,
          costAddedCents: true,
          costRemovedCents: true,
          realizedPnlCents: true,
          feeCents: true,
          isExternalFlow: true,
        },
      },
    },
  });
  const symbols = new Map(
    (await db.stock.findMany({ select: { id: true, symbol: true } })).map((s) => [s.id, s.symbol]),
  );

  if (portfolios.length === 0) {
    log("No portfolios to value.");
    return { itemsProcessed: 0 };
  }

  let valued = 0;
  let degraded = 0;

  for (const portfolio of portfolios) {
    const state = stateFromLedger(
      portfolio.initialCapitalCents,
      portfolio.transactions,
      (id) => symbols.get(id) ?? id,
    );
    const stockIds = state.holdings.filter((h) => h.microShares !== 0n).map((h) => h.stockId);

    const book = await buildPriceBook(db, stockIds, asOfDate, {
      maxStalenessDays,
      costBasisFallback: new Map(
        state.holdings.map((h) => [
          h.stockId,
          { microShares: h.microShares, costBasisCents: h.costBasisCents },
        ]),
      ),
    });
    if (book.quality !== "OK") degraded++;

    const value = valuePortfolio(state, book);

    // The P/L identity holds by construction for any trade history. Checking it
    // here means a bug in the ledger surfaces as a failed valuation job with a
    // named portfolio, not as an unexplained leaderboard position weeks later.
    assertPnlIdentity(portfolio.id, {
      totalValueCents: value.totalValueCents,
      initialCapitalCents: portfolio.initialCapitalCents,
      netFlowCents: state.netFlowCents,
      realizedPnlCents: state.realizedPnlCents,
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
    const flowInPeriodCents = previous ? state.netFlowCents - previous.netFlowCents : 0n;

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
    // Capital added during the week is not a gain, exactly as for the day.
    const weeklyReturnPpm = weekAgo
      ? periodReturnPpm(
          weekAgo.totalValueCents,
          value.totalValueCents,
          state.netFlowCents - weekAgo.netFlowCents,
        )
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
          netFlowCents: state.netFlowCents,
          flowInPeriodCents,
          costBasisCents: value.costBasisCents,
          realizedPnlCents: value.realizedPnlCents,
          unrealizedPnlCents: value.unrealizedPnlCents,
          cumulativeFeesCents: state.feesCents,
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
          isRankEligible: state.hasTraded && value.positionCount > 0,
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
              state.holdings.find((h) => h.stockId === holding.stockId)?.realizedPnlCents ?? 0n,
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
