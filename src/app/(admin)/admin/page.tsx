import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { formatRemaining } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { loadAnalytics } from "@/server/dto/admin.dto";
import { formatCents } from "@/server/money";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });

  if (!competition) {
    return (
      <EmptyState
        title="No competition yet"
        body="Create a competition to open registration and let people build portfolios."
      />
    );
  }

  const [analytics, stockCount, recentJobs] = await Promise.all([
    loadAnalytics(competition.id),
    db.competitionStock.count({ where: { competitionId: competition.id, removedAt: null } }),
    db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{competition.name}</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {competition.status.toLowerCase()} · {formatRemaining(competition.endsAt)} remaining
            {analytics.asOfDate ? ` · valued to ${analytics.asOfDate}` : " · not yet valued"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminLink href="/admin/participants">Participants</AdminLink>
          <AdminLink href="/admin/stocks">Stocks</AdminLink>
          <AdminLink href="/admin/settings">Settings</AdminLink>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Participants"
          value={String(analytics.participants.total)}
          hint={`${analytics.participants.invested} have built a portfolio`}
        />
        <Tile
          label="Ranked"
          value={String(analytics.participants.ranked)}
          hint={`${analytics.participants.total - analytics.participants.ranked} not yet invested`}
        />
        <Tile label="Stocks available" value={String(stockCount)} />
        <Tile label="Under management" value={analytics.aum.text} />
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-[var(--text-muted)]">Returns</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <Figure label="Best" ratio={analytics.returns.best} />
            <Figure label="Worst" ratio={analytics.returns.worst} />
            <Figure label="Mean" ratio={analytics.returns.mean} />
            <Figure label="Median" ratio={analytics.returns.median} />
          </dl>
          <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
            Average largest position{" "}
            <strong className="tnum font-medium text-[var(--text)]">
              {(analytics.concentration.averageTopWeightPpm / 10_000).toFixed(1)}%
            </strong>{" "}
            across{" "}
            <strong className="tnum font-medium text-[var(--text)]">
              {analytics.concentration.averagePositions}
            </strong>{" "}
            positions. A competition where the average biggest bet is very high is closer to a coin
            flip than a test of judgement.
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-medium text-[var(--text-muted)]">Scheduled jobs</h2>
          {recentJobs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Nothing has run yet. Start the worker with <code>make worker</code>, or run one job
              with <code>make job NAME=snapshot-valuations</code>.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {recentJobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={
                        "size-1.5 shrink-0 rounded-full " +
                        (job.status === "SUCCEEDED"
                          ? "bg-up-500"
                          : job.status === "FAILED"
                            ? "bg-down-500"
                            : "bg-[var(--color-ink-400)]")
                      }
                    />
                    <span className="truncate">{job.jobName}</span>
                    <span className="truncate text-xs text-[var(--text-muted)]">{job.runKey}</span>
                  </span>
                  <span className="tnum shrink-0 text-xs text-[var(--text-muted)]">
                    {job.itemsProcessed} · {job.durationMs ?? 0}ms
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">Most held stocks</h2>
          <Link
            href="/admin/analytics"
            className="text-sm font-medium text-accent-600 hover:text-accent-700"
          >
            Full analytics
          </Link>
        </div>
        {analytics.popular.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">Nobody holds anything yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Holders</th>
                  <th className="px-3 py-2.5 text-right font-medium">Average weight</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total held</th>
                  <th className="px-5 py-2.5 text-right font-medium">Price move</th>
                </tr>
              </thead>
              <tbody>
                {analytics.popular.slice(0, 8).map((s) => (
                  <tr key={s.symbol} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{s.symbol}</div>
                      <div className="text-xs text-[var(--text-muted)]">{s.name}</div>
                    </td>
                    <td className="tnum px-3 py-3 text-right">
                      {s.holders}
                      <span className="ml-1 text-xs text-[var(--text-muted)]">
                        ({s.holderPct}%)
                      </span>
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

      <p className="text-xs text-[var(--text-muted)]">
        Starting capital {formatCents(competition.startingCapitalCents, competition.currency)} ·
        competition runs {competition.startDate} to {competition.endDate}
      </p>
    </div>
  );
}

function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--surface-sunken)]"
    >
      {children}
    </Link>
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
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className={"tnum text-lg font-semibold " + toneClass(ratio.direction)}>{ratio.text}</dd>
    </div>
  );
}
