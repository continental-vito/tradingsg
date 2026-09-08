import type { Metadata } from "next";
import { addStockAction, removeStockAction } from "@/app/actions/admin";
import { AddStockForm, RemoveStockButton } from "@/components/admin-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";

export const metadata: Metadata = { title: "Stocks" };
export const dynamic = "force-dynamic";

export default async function AdminStocksPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const universe = await db.competitionStock.findMany({
    where: { competitionId: competition.id },
    orderBy: [{ removedAt: "asc" }, { sortOrder: "asc" }],
    include: {
      stock: {
        include: {
          _count: {
            select: { holdings: { where: { microShares: { gt: 0n } } }, prices: true },
          },
        },
      },
    },
  });

  const active = universe.filter((u) => u.removedAt === null);
  const removed = universe.filter((u) => u.removedAt !== null);
  const unpriced = active.filter((u) => u.stock.lastPriceCents === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stocks</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {active.length} tradable in {competition.name}
          {removed.length > 0 ? ` · ${removed.length} removed` : ""}
        </p>
      </div>

      {unpriced.length > 0 ? (
        <Alert tone="info">
          {unpriced.length} stock{unpriced.length === 1 ? " has" : "s have"} no price yet, so{" "}
          {unpriced.length === 1 ? "it cannot" : "they cannot"} be traded. Run{" "}
          <code>make job NAME=close-prices</code> to write prices for{" "}
          {unpriced.map((u) => u.stock.symbol).join(", ")}.
        </Alert>
      ) : null}

      <Card>
        <h2 className="mb-4 text-sm font-medium">Add a stock</h2>
        <AddStockForm competitionId={competition.id} addStock={addStockAction} />
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-5 py-2.5 font-medium">Ticker</th>
                <th className="px-3 py-2.5 font-medium">Company</th>
                <th className="px-3 py-2.5 font-medium">Sector</th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">History</th>
                <th className="px-3 py-2.5 text-right font-medium">Holders</th>
                <th className="px-5 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {universe.map((u) => (
                <tr
                  key={u.id}
                  className={
                    "border-b border-[var(--border)] last:border-0 " +
                    (u.removedAt !== null ? "opacity-55" : "")
                  }
                >
                  <td className="px-5 py-3 font-medium">
                    {u.stock.symbol}
                    {u.removedAt !== null ? (
                      <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                        removed
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{u.stock.name}</td>
                  <td className="px-3 py-3 text-[var(--text-muted)]">{u.stock.sector ?? "—"}</td>
                  <td className="tnum px-3 py-3 text-right">
                    {u.stock.lastPriceCents !== null ? (
                      formatCents(u.stock.lastPriceCents, competition.currency)
                    ) : (
                      <span className="text-down-600">no price</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                    {u.stock._count.prices} days
                  </td>
                  <td className="tnum px-3 py-3 text-right">{u.stock._count.holdings}</td>
                  <td className="px-5 py-3 text-right">
                    {u.removedAt === null ? (
                      <RemoveStockButton
                        competitionId={competition.id}
                        stockId={u.stockId}
                        symbol={u.stock.symbol}
                        holders={u.stock._count.holdings}
                        removeStock={removeStockAction}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
          Removing a stock is reversible and never deletes anything. Existing positions stay valued
          and can be sold; only new purchases are blocked. Hard-deleting one mid-competition would
          orphan every transaction that references it.
        </p>
      </Card>
    </div>
  );
}
