import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { CASH_COLOR, topNWithOther } from "@/components/charts/palette";
import { Avatar } from "@/components/avatar";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { canViewOthersHoldings, requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm, formatShares, toPpm } from "@/server/money";

export const metadata: Metadata = { title: "Participant" };
export const dynamic = "force-dynamic";

/**
 * Another participant's portfolio, when the competition allows it.
 *
 * Read from the last committed valuation, never live: everyone looking at
 * somebody else sees the same figures the leaderboard ranked them on. Only the
 * viewer's own dashboard gets a live view.
 */
export default async function ParticipantPortfolioPage({
  params,
}: {
  params: Promise<{ participantId: string }>;
}) {
  const user = await requireUser();
  const { participantId } = await params;

  const participant = await db.participant.findFirst({
    where: { id: participantId, deletedAt: null },
    include: {
      user: { select: { department: true, avatarUrl: true } },
      competition: {
        include: {
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
        },
      },
      portfolio: { select: { id: true, setupCompletedAt: true } },
    },
  });
  // A participant in a competition this viewer is not in, and one that does not
  // exist, are the same answer.
  if (!participant) notFound();

  const viewer = await db.participant.findFirst({
    where: { userId: user.id, competitionId: participant.competitionId, deletedAt: null },
    select: { id: true },
  });
  if (!viewer && user.role !== "ADMIN") notFound();

  const settings = participant.competition.settings[0];
  const isSelf = viewer?.id === participant.id;

  if (!isSelf && !canViewOthersHoldings(user, settings?.showOthersHoldings ?? false)) {
    return (
      <div className="space-y-4">
        <Link
          href="/leaderboard"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ← Leaderboard
        </Link>
        <EmptyState
          title="Portfolios are private in this competition"
          body={`You can see where ${participant.displayName} stands, but not what they hold. The administrator decides whether portfolios are visible to everyone.`}
        />
      </div>
    );
  }

  const valuation = participant.portfolio
    ? await db.portfolioValuation.findFirst({
        where: { portfolioId: participant.portfolio.id, kind: "EOD" },
        orderBy: { asOfDate: "desc" },
        include: { holdingValuations: { include: { stock: true } } },
      })
    : null;

  const currency = participant.competition.currency;
  const holdings = (valuation?.holdingValuations ?? [])
    .slice()
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : -1));

  // Shorts cannot be slices of a whole — same split as the participant's own
  // portfolio view, so another person's page reads the same way as your own.
  const longs = holdings.filter((h) => h.microShares > 0n);
  const shorts = holdings.filter((h) => h.microShares < 0n);
  const slices = topNWithOther(longs, 7, (h) => ({
    key: h.stockId,
    label: h.stock.symbol,
    valueCents: h.marketValueCents,
    weightPpm: h.weightPpm,
  }));
  const cashWeight = valuation ? toPpm(valuation.cashCents, valuation.totalValueCents) : 0;
  if (cashWeight > 0 && valuation) {
    slices.push({
      key: "__cash",
      label: "Cash",
      valueCents: valuation.cashCents.toString(),
      weightPpm: cashWeight,
      color: CASH_COLOR,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/leaderboard"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ← Leaderboard
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <Avatar name={participant.displayName} avatarUrl={participant.user.avatarUrl} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{participant.displayName}</h1>
            <p className="text-sm text-[var(--text-muted)]">
              {participant.user.department ?? "—"}
              {valuation ? ` · valued at the close on ${valuation.asOfDate}` : ""}
            </p>
          </div>
        </div>
      </div>

      {!valuation ? (
        <EmptyState
          title="Nothing to show yet"
          body={`${participant.displayName} has not been valued yet — they may not have built a portfolio.`}
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Card>
              <dt className="text-sm text-[var(--text-muted)]">Portfolio value</dt>
              <dd className="tnum mt-1 text-2xl font-semibold">
                {formatCents(valuation.totalValueCents, currency)}
              </dd>
            </Card>
            <Card>
              <dt className="text-sm text-[var(--text-muted)]">Return</dt>
              <dd
                className={
                  "tnum mt-1 text-2xl font-semibold " +
                  toneClass(
                    valuation.totalReturnPpm > 0 ? 1 : valuation.totalReturnPpm < 0 ? -1 : 0,
                  )
                }
              >
                {formatPpm(valuation.totalReturnPpm)}
              </dd>
            </Card>
            <Card>
              <dt className="text-sm text-[var(--text-muted)]">Positions</dt>
              <dd className="tnum mt-1 text-2xl font-semibold">{valuation.positionCount}</dd>
            </Card>
          </dl>

          {holdings.length > 0 ? (
            <Card>
              <h2 className="mb-4 text-sm font-medium text-[var(--text-muted)]">Allocation</h2>
              <AllocationDonut
                slices={slices}
                centerLabel={shorts.length > 0 ? "Long" : "Positions"}
                centerValue={String(longs.length)}
              />

              {shorts.length > 0 ? (
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <h3 className="text-xs font-medium text-[var(--text-muted)]">
                    Short — a liability, so not shown above
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {shorts.map((h) => (
                      <li key={h.stockId} className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-[3px] border border-down-500 bg-down-50"
                        />
                        <span className="min-w-0 flex-1 truncate">{h.stock.symbol}</span>
                        <span className="tnum text-down-600">{formatPpm(h.weightPpm)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card className="overflow-hidden p-0">
            <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">Holdings</h2>
            {holdings.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">
                Entirely in cash — {formatCents(valuation.cashCents, currency)}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                      <th className="px-5 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                      <th className="px-3 py-2.5 text-right font-medium">Value</th>
                      <th className="px-3 py-2.5 text-right font-medium">Weight</th>
                      <th className="px-5 py-2.5 text-right font-medium">Gain / loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-5 py-3">
                          <div className="font-medium">{h.stock.symbol}</div>
                          <div className="text-xs text-[var(--text-muted)]">{h.stock.name}</div>
                        </td>
                        <td className="tnum px-3 py-3 text-right">{formatShares(h.microShares)}</td>
                        <td className="tnum px-3 py-3 text-right">
                          {formatCents(h.marketValueCents, currency)}
                        </td>
                        <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                          {(h.weightPpm / 10_000).toFixed(1)}%
                        </td>
                        <td
                          className={
                            "tnum px-5 py-3 text-right " +
                            toneClass(
                              h.positionReturnPpm > 0 ? 1 : h.positionReturnPpm < 0 ? -1 : 0,
                            )
                          }
                        >
                          <div>{formatCents(h.unrealizedPnlCents, currency)}</div>
                          <div className="text-xs">{formatPpm(h.positionReturnPpm)}</div>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[var(--surface-sunken)]">
                      <td className="px-5 py-3 font-medium">Cash</td>
                      <td />
                      <td className="tnum px-3 py-3 text-right">
                        {formatCents(valuation.cashCents, currency)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                        {(cashWeight / 10_000).toFixed(1)}%
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
