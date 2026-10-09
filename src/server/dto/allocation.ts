import type { PrismaClient } from "@/generated/prisma/client";
import type { AllocatableStock } from "@/components/allocation-editor";
import type { DateKey } from "@/lib/dates";
import { formatCents, marketValue, toPpm } from "@/server/money";
import { buildPriceBook } from "@/server/portfolio/prices";

/**
 * What the allocation editor needs: the tradable stocks with their prices and
 * current weights, and the portfolio's value at those prices.
 *
 * Shared by a participant's allocate page and the admin's AI investor page, so
 * the AI is offered exactly the list, the prices and the valuation a person is.
 * Everything is valued at the close the rebalance will execute at, so the
 * estimates on the page and the orders in the preview agree.
 */
export async function loadAllocatable(
  db: PrismaClient,
  args: {
    competitionId: string;
    currency: string;
    asOfDate: DateKey;
    cashCents: bigint;
    holdings: { stockId: string; microShares: bigint }[];
  },
): Promise<{ stocks: AllocatableStock[]; totalValueCents: bigint }> {
  const universe = await db.competitionStock.findMany({
    where: { competitionId: args.competitionId, removedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { stock: true },
  });

  // Held names are priced too, even when no longer tradable: a position left
  // in a removed stock is still worth something and is part of the total.
  const book = await buildPriceBook(
    db,
    [...new Set([...universe.map((u) => u.stockId), ...args.holdings.map((h) => h.stockId)])],
    args.asOfDate,
  );

  let holdingsValue = 0n;
  for (const holding of args.holdings) {
    holdingsValue += marketValue(holding.microShares, book.get(holding.stockId)?.priceCents ?? 0n);
  }
  const totalValueCents = args.cashCents + holdingsValue;
  const heldBy = new Map(args.holdings.map((h) => [h.stockId, h]));

  const stocks: AllocatableStock[] = universe
    .filter((u) => u.isTradable && book.get(u.stockId))
    .map((u) => {
      const price = book.get(u.stockId)?.priceCents ?? 0n;
      const holding = heldBy.get(u.stockId);
      return {
        id: u.stockId,
        symbol: u.stock.symbol,
        name: u.stock.name,
        sector: u.stock.sector,
        priceText: formatCents(price, args.currency),
        priceCents: price.toString(),
        currentWeightPpm: holding
          ? toPpm(marketValue(holding.microShares, price), totalValueCents)
          : 0,
      };
    });

  return { stocks, totalValueCents };
}
