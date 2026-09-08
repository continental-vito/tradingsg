import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm, formatShares } from "@/server/money";

export const metadata: Metadata = { title: "Participant" };
export const dynamic = "force-dynamic";

export default async function AdminParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const participant = await db.participant.findUnique({
    where: { id },
    include: {
      user: true,
      competition: true,
      portfolio: {
        include: {
          holdings: { include: { stock: true }, orderBy: { costBasisCents: "desc" } },
          transactions: {
            include: { stock: { select: { symbol: true } } },
            orderBy: { sequence: "desc" },
            take: 60,
          },
        },
      },
    },
  });
  if (!participant) notFound();

  const currency = participant.competition.currency;
  const latest = participant.portfolio
    ? await db.portfolioValuation.findFirst({
        where: { portfolioId: participant.portfolio.id, kind: "EOD" },
        orderBy: { asOfDate: "desc" },
        include: { holdingValuations: { include: { stock: true } } },
      })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/participants"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ← All participants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {participant.user.firstName} {participant.user.lastName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {participant.user.email}
          {participant.user.department ? ` · ${participant.user.department}` : ""} · joined{" "}
          {participant.joinedAt.toISOString().slice(0, 10)} · status{" "}
          {participant.status.toLowerCase()}
        </p>
      </div>

      {participant.adjustedByAdmin ? (
        <Card className="border-down-500/40 bg-down-50">
          <p className="text-sm text-down-700">
            This portfolio has been adjusted by an administrator. Its return is not comparable with
            the others, and it is badged on the leaderboard for that reason.
          </p>
        </Card>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-4">
        <Tile
          label="Starting capital"
          value={formatCents(participant.initialCapitalCents, currency)}
        />
        <Tile
          label="Current value"
          value={latest ? formatCents(latest.totalValueCents, currency) : "—"}
        />
        <Tile
          label="Return"
          value={latest ? formatPpm(latest.totalReturnPpm) : "—"}
          tone={latest ? (latest.totalReturnPpm > 0 ? 1 : latest.totalReturnPpm < 0 ? -1 : 0) : 0}
        />
        <Tile
          label="Realised P/L"
          value={
            participant.portfolio
              ? formatCents(participant.portfolio.realizedPnlCents, currency)
              : "—"
          }
        />
      </dl>

      {!participant.portfolio ? (
        <EmptyState title="No portfolio" body="This participant has never had a portfolio." />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">Holdings</h2>
            {participant.portfolio.holdings.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">
                Entirely in cash — {formatCents(participant.portfolio.cashCents, currency)}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                      <th className="px-5 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                      <th className="px-3 py-2.5 text-right font-medium">Cost basis</th>
                      <th className="px-3 py-2.5 text-right font-medium">Value</th>
                      <th className="px-5 py-2.5 text-right font-medium">Unrealised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participant.portfolio.holdings.map((h) => {
                      const hv = latest?.holdingValuations.find((v) => v.stockId === h.stockId);
                      return (
                        <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-5 py-3">
                            <div className="font-medium">{h.stock.symbol}</div>
                            <div className="text-xs text-[var(--text-muted)]">{h.stock.name}</div>
                          </td>
                          <td className="tnum px-3 py-3 text-right">
                            {formatShares(h.microShares)}
                          </td>
                          <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                            {formatCents(h.costBasisCents, currency)}
                          </td>
                          <td className="tnum px-3 py-3 text-right">
                            {hv ? formatCents(hv.marketValueCents, currency) : "—"}
                          </td>
                          <td
                            className={
                              "tnum px-5 py-3 text-right " +
                              toneClass(
                                (hv?.unrealizedPnlCents ?? 0n) > 0n
                                  ? 1
                                  : (hv?.unrealizedPnlCents ?? 0n) < 0n
                                    ? -1
                                    : 0,
                              )
                            }
                          >
                            {hv ? formatCents(hv.unrealizedPnlCents, currency) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-[var(--surface-sunken)]">
                      <td className="px-5 py-3 font-medium">Cash</td>
                      <td colSpan={2} />
                      <td className="tnum px-3 py-3 text-right">
                        {formatCents(participant.portfolio.cashCents, currency)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
              Transaction history
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                    <th className="px-5 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Stock</th>
                    <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-5 py-2.5 text-right font-medium">Cash after</th>
                  </tr>
                </thead>
                <tbody>
                  {participant.portfolio.transactions.map((t) => (
                    <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="tnum px-5 py-2.5 text-[var(--text-muted)]">{t.sequence}</td>
                      <td className="tnum px-3 py-2.5">{t.tradeDate}</td>
                      <td className="px-3 py-2.5">{t.type}</td>
                      <td className="px-3 py-2.5">{t.stock?.symbol ?? "—"}</td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {t.microShareDelta === 0n ? "—" : formatShares(t.microShareDelta)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {t.priceCents === 0n ? "—" : formatCents(t.priceCents, currency)}
                      </td>
                      <td className="tnum px-5 py-2.5 text-right">
                        {formatCents(t.cashAfterCents, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
              The ledger is append-only. Running balances are stored on every row, so the sequence
              above is the whole audit trail — nothing was edited after the fact.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone = 0 }: { label: string; value: string; tone?: -1 | 0 | 1 }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <dt className="text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className={"tnum mt-1 text-xl font-semibold " + toneClass(tone)}>{value}</dd>
    </div>
  );
}
