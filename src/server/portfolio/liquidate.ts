import type { PrismaClient } from "@/generated/prisma/client";
import type { DateKey } from "@/lib/dates";
import { daysBetween } from "@/lib/dates";
import { marketValue, type Cents } from "@/server/money";
import { assertPortfolioInvariants } from "./invariant";

/**
 * Force-liquidating a stock that has stopped pricing.
 *
 * A delisted or suspended name would otherwise have its last close carried
 * forward for the rest of the competition: everyone holding it would be frozen
 * at a price that no longer means anything, and the longer it went on the more
 * the ranking would reflect a number nobody could trade at.
 *
 * So the position is sold at the last close that DID exist, for everyone at
 * once, and the proceeds go to cash. Three properties make that defensible
 * rather than arbitrary:
 *
 *   - it is the same price for every holder, so nobody is advantaged;
 *   - no fee is charged, because this is not a trade anybody chose to make;
 *   - it is an ordinary SELL in the ledger (typed LIQUIDATION_SELL), so the
 *     reconciliation invariants apply to it exactly as they do to a real one.
 */

export interface LiquidationResult {
  symbol: string;
  priceCents: Cents;
  tradeDate: DateKey;
  holdersLiquidated: number;
  proceedsCents: Cents;
}

export class LiquidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LiquidationError";
  }
}

/**
 * Stocks whose most recent close is older than the staleness limit while the
 * competition is still running — the candidates for liquidation.
 */
export async function findStalePricedStocks(
  db: PrismaClient,
  competitionId: string,
  asOfDate: DateKey,
  maxStalenessDays: number,
): Promise<{ stockId: string; symbol: string; lastTradeDate: DateKey | null; ageDays: number }[]> {
  const universe = await db.competitionStock.findMany({
    where: { competitionId },
    include: { stock: { select: { id: true, symbol: true } } },
  });

  const out = [];
  for (const row of universe) {
    const held = await db.holding.count({
      where: { stockId: row.stockId, microShares: { gt: 0n }, portfolio: { competitionId } },
    });
    if (held === 0) continue;

    const latest = await db.priceHistory.findFirst({
      where: { stockId: row.stockId, supersededAt: null, tradeDate: { lte: asOfDate } },
      orderBy: [{ tradeDate: "desc" }, { revision: "desc" }],
      select: { tradeDate: true },
    });

    const ageDays = latest ? daysBetween(latest.tradeDate, asOfDate) : Number.MAX_SAFE_INTEGER;
    if (ageDays > maxStalenessDays) {
      out.push({
        stockId: row.stockId,
        symbol: row.stock.symbol,
        lastTradeDate: latest?.tradeDate ?? null,
        ageDays,
      });
    }
  }
  return out;
}

export async function liquidateStock(
  db: PrismaClient,
  args: { competitionId: string; stockId: string; asOfDate: DateKey; reason: string },
): Promise<LiquidationResult> {
  const stock = await db.stock.findUniqueOrThrow({
    where: { id: args.stockId },
    select: { symbol: true },
  });

  const lastClose = await db.priceHistory.findFirst({
    where: { stockId: args.stockId, supersededAt: null, tradeDate: { lte: args.asOfDate } },
    orderBy: [{ tradeDate: "desc" }, { revision: "desc" }],
    select: { closeCents: true, tradeDate: true },
  });

  if (!lastClose || lastClose.closeCents <= 0n) {
    throw new LiquidationError(
      `${stock.symbol} has never had a price, so there is nothing to liquidate it at. Remove it from the competition instead — no valuation has ever used it.`,
      "NO_PRICE_EVER",
    );
  }

  const holdings = await db.holding.findMany({
    where: {
      stockId: args.stockId,
      microShares: { gt: 0n },
      portfolio: { competitionId: args.competitionId },
    },
    include: {
      portfolio: {
        select: { id: true, participantId: true, transactionSeq: true, cashCents: true },
      },
    },
  });

  let proceedsTotal = 0n;

  for (const holding of holdings) {
    // The same rounding a real sale uses, so a liquidation and a sale of the
    // same position at the same price produce the same cash to the cent.
    const gross = marketValue(holding.microShares, lastClose.closeCents);
    const costRemoved = holding.costBasisCents;
    const realized = gross - costRemoved;
    const sequence = holding.portfolio.transactionSeq + 1;
    const cashAfter = holding.portfolio.cashCents + gross;

    await db.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          portfolioId: holding.portfolioId,
          participantId: holding.portfolio.participantId,
          stockId: args.stockId,
          sequence,
          type: "LIQUIDATION_SELL",
          tradeDate: args.asOfDate,
          microShareDelta: -holding.microShares,
          priceCents: lastClose.closeCents,
          grossCents: gross,
          // No fee: nobody chose to make this trade.
          feeCents: 0n,
          cashDeltaCents: gross,
          costRemovedCents: costRemoved,
          realizedPnlCents: realized,
          cashAfterCents: cashAfter,
          microSharesAfter: 0n,
          isExternalFlow: false,
          note: args.reason,
        },
      });

      await tx.holding.update({
        where: { id: holding.id },
        data: {
          microShares: 0n,
          // Zero, not pro-rata: the whole position went, so the whole basis
          // goes with it. A residual on a closed holding reads as infinite
          // unrealised P/L.
          costBasisCents: 0n,
          realizedPnlCents: { increment: realized },
          lastTradedAt: new Date(),
        },
      });

      await tx.portfolio.update({
        where: { id: holding.portfolioId },
        data: {
          cashCents: cashAfter,
          costBasisCents: { decrement: costRemoved },
          realizedPnlCents: { increment: realized },
          transactionSeq: sequence,
          version: { increment: 1 },
        },
      });

      await assertPortfolioInvariants(tx as unknown as PrismaClient, holding.portfolioId);
    });

    proceedsTotal += gross;
  }

  // Blocked from further buying, but never deleted: the transactions that
  // reference it have to keep resolving.
  await db.competitionStock.updateMany({
    where: { competitionId: args.competitionId, stockId: args.stockId },
    data: { isTradable: false, removedAt: new Date() },
  });

  return {
    symbol: stock.symbol,
    priceCents: lastClose.closeCents,
    tradeDate: lastClose.tradeDate,
    holdersLiquidated: holdings.length,
    proceedsCents: proceedsTotal,
  };
}
