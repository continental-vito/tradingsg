import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatShares, formatPpm } from "@/server/money";

export const metadata: Metadata = { title: "Transaction history" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  INITIAL_FUNDING: "Funded",
  BUY: "Buy",
  SELL: "Sell",
  FEE: "Fee",
  ADJUSTMENT_CREDIT: "Adjustment",
  ADJUSTMENT_DEBIT: "Adjustment",
  LIQUIDATION_SELL: "Liquidation",
};

export default async function HistoryPage() {
  const user = await requireUser();

  const participant = await db.participant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: { competition: { select: { currency: true } } },
  });
  if (!participant) notFound();

  const transactions = await db.transaction.findMany({
    where: { participantId: participant.id },
    orderBy: [{ executedAt: "desc" }, { sequence: "desc" }],
    include: { stock: { select: { symbol: true, name: true } } },
    take: 500,
  });

  const currency = participant.competition.currency;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transaction history</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every change to your portfolio, in the order it was recorded.
          </p>
        </div>
        <Link
          href="/portfolio"
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-sunken)]"
        >
          Back to portfolio
        </Link>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Your transactions appear here as soon as you build your portfolio."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Allocation</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cash</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const isBuy = t.type === "BUY";
                  const isSell = t.type === "SELL" || t.type === "LIQUIDATION_SELL";
                  return (
                    <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="tnum">{t.tradeDate}</div>
                        <div className="tnum text-xs text-[var(--text-muted)]">
                          {t.executedAt.toISOString().slice(11, 16)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            "rounded px-1.5 py-0.5 text-xs font-medium " +
                            (isBuy
                              ? "bg-up-50 text-up-700"
                              : isSell
                                ? "bg-down-50 text-down-700"
                                : "bg-[var(--surface-sunken)] text-[var(--text-muted)]")
                          }
                        >
                          {TYPE_LABEL[t.type] ?? t.type}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {t.stock ? (
                          <>
                            <div className="font-medium">{t.stock.symbol}</div>
                            <div className="text-xs text-[var(--text-muted)]">{t.stock.name}</div>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="tnum px-3 py-3 text-right">
                        {t.microShareDelta === 0n
                          ? "—"
                          : formatShares(
                              t.microShareDelta < 0n ? -t.microShareDelta : t.microShareDelta,
                            )}
                      </td>
                      <td className="tnum px-3 py-3 text-right">
                        {t.priceCents === 0n ? "—" : formatCents(t.priceCents, currency)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-xs text-[var(--text-muted)]">
                        {t.prevAllocationPpm !== null && t.newAllocationPpm !== null
                          ? `${formatPpm(t.prevAllocationPpm, 1).replace("+", "")} → ${formatPpm(t.newAllocationPpm, 1).replace("+", "")}`
                          : "—"}
                      </td>
                      <td
                        className={
                          "tnum px-5 py-3 text-right " +
                          toneClass(t.cashDeltaCents > 0n ? 1 : t.cashDeltaCents < 0n ? -1 : 0)
                        }
                      >
                        <div>
                          {t.cashDeltaCents > 0n ? "+" : ""}
                          {formatCents(t.cashDeltaCents, currency)}
                        </div>
                        {t.feeCents > 0n ? (
                          <div className="text-xs text-[var(--text-muted)]">
                            incl. {formatCents(t.feeCents, currency)} fee
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
