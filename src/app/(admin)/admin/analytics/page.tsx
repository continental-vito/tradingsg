import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { loadAnalytics } from "@/server/dto/admin.dto";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const a = await loadAnalytics(competition.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {a.asOfDate
            ? `From the snapshot at the close on ${a.asOfDate}, so these are the same numbers the leaderboard shows.`
            : "No snapshot yet."}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Participants" value={String(a.participants.total)} />
        <Tile
          label="Built a portfolio"
          value={`${a.participants.invested} / ${a.participants.total}`}
        />
        <Tile label="Under management" value={a.aum.text} />
        <Tile
          label="Average positions"
          value={String(a.concentration.averagePositions)}
          hint={`largest bet averages ${(a.concentration.averageTopWeightPpm / 10_000).toFixed(1)}%`}
        />
      </dl>

      <div className="grid gap-4 sm:grid-cols-4">
        <Figure label="Best return" ratio={a.returns.best} />
        <Figure label="Mean return" ratio={a.returns.mean} />
        <Figure label="Median return" ratio={a.returns.median} />
        <Figure label="Worst return" ratio={a.returns.worst} />
      </div>

      <Card className="overflow-hidden p-0">
        <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">Every held stock</h2>
        {a.popular.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">Nobody holds anything yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Holders</th>
                  <th className="px-3 py-2.5 font-medium">Share of participants</th>
                  <th className="px-3 py-2.5 text-right font-medium">Average weight</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total held</th>
                  <th className="px-5 py-2.5 text-right font-medium">Price move</th>
                </tr>
              </thead>
              <tbody>
                {a.popular.map((s) => (
                  <tr key={s.symbol} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{s.symbol}</div>
                      <div className="text-xs text-[var(--text-muted)]">{s.name}</div>
                    </td>
                    <td className="tnum px-3 py-3 text-right">{s.holders}</td>
                    <td className="px-3 py-3">
                      {/* A bar rather than a number alone: the shape of the
                          distribution is the point, and it is read at a glance. */}
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                          <div
                            className="h-full rounded-full bg-accent-600"
                            style={{ width: `${s.holderPct}%` }}
                          />
                        </div>
                        <span className="tnum text-xs text-[var(--text-muted)]">
                          {s.holderPct}%
                        </span>
                      </div>
                    </td>
                    <td className="tnum px-3 py-3 text-right">
                      {(s.averageWeightPpm / 10_000).toFixed(1)}%
                    </td>
                    <td className="tnum px-3 py-3 text-right">{s.totalValue.text}</td>
                    <td
                      className={
                        "tnum px-5 py-3 text-right " +
                        (s.priceReturn ? toneClass(s.priceReturn.direction) : "")
                      }
                    >
                      {s.priceReturn?.text ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <dt className="text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className="tnum mt-1 text-2xl font-semibold">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

function Figure({
  label,
  ratio,
}: {
  label: string;
  ratio: { text: string; direction: -1 | 0 | 1 };
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
      <div className={"tnum mt-1 text-2xl font-semibold " + toneClass(ratio.direction)}>
        {ratio.text}
      </div>
    </div>
  );
}
