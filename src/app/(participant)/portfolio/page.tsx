import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { CASH_COLOR, topNWithOther } from "@/components/charts/palette";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireUser } from "@/server/auth/guard";
import { loadDashboard } from "@/server/dto/portfolio.dto";

export const metadata: Metadata = { title: "Portfolio" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await requireUser();
  const data = await loadDashboard(user.id);
  if (!data) notFound();

  const { holdings, headline } = data;

  const slices = topNWithOther(holdings, 7, (h) => ({
    key: h.stockId,
    label: h.symbol,
    valueCents: BigInt(h.value.cents),
    weightPpm: h.weightPpm,
  }));
  if (headline.cashWeightPpm > 0) {
    slices.push({
      key: "__cash",
      label: "Cash",
      valueCents: headline.cash.cents,
      weightPpm: headline.cashWeightPpm,
      color: CASH_COLOR,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your portfolio</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {holdings.length} position{holdings.length === 1 ? "" : "s"} ·{" "}
            {headline.currentValue.text}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/portfolio/history"
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-sunken)]"
          >
            Transaction history
          </Link>
          <Link
            href="/portfolio/allocate"
            className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            Change allocation
          </Link>
        </div>
      </div>

      {holdings.length === 0 ? (
        <EmptyState
          title="You hold no positions"
          body={`Your whole portfolio — ${headline.cash.text} — is sitting in cash. Allocate it to appear on the leaderboard.`}
          action={
            <Link
              href="/portfolio/allocate"
              className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              Build my portfolio
            </Link>
          }
        />
      ) : (
        <>
          <Card>
            <h2 className="mb-4 text-sm font-medium text-[var(--text-muted)]">Allocation</h2>
            <AllocationDonut
              slices={slices}
              centerLabel="Value"
              centerValue={headline.currentValue.text}
            />
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                    <th className="px-5 py-2.5 font-medium">Stock</th>
                    <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-3 py-2.5 text-right font-medium">Cost basis</th>
                    <th className="px-3 py-2.5 text-right font-medium">Value</th>
                    <th className="px-3 py-2.5 text-right font-medium">Weight</th>
                    <th className="px-5 py-2.5 text-right font-medium">Unrealised</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.stockId} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium">{h.symbol}</div>
                        <div className="text-xs text-[var(--text-muted)]">{h.name}</div>
                      </td>
                      <td className="tnum px-3 py-3 text-right">{h.shares.text}</td>
                      <td className="tnum px-3 py-3 text-right">{h.price.text}</td>
                      <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                        {h.costBasis.text}
                      </td>
                      <td className="tnum px-3 py-3 text-right">{h.value.text}</td>
                      <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                        {h.weightText}
                      </td>
                      <td
                        className={
                          "tnum px-5 py-3 text-right " + toneClass(h.gainLossRatio.direction)
                        }
                      >
                        <div>{h.gainLoss.text}</div>
                        <div className="text-xs">{h.gainLossRatio.text}</div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[var(--surface-sunken)]">
                    <td className="px-5 py-3 font-medium">Cash</td>
                    <td colSpan={3} />
                    <td className="tnum px-3 py-3 text-right">{headline.cash.text}</td>
                    <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                      {(headline.cashWeightPpm / 10_000).toFixed(1)}%
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
