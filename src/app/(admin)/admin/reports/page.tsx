import type { Metadata } from "next";
import Link from "next/link";
import { buildReportAction } from "@/app/actions/reports";
import { BuildReportForm } from "@/components/report-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const [reports, hasWeeklySnapshot] = await Promise.all([
    db.weeklyReport.findMany({
      where: { competitionId: competition.id },
      orderBy: [{ weekNumber: "desc" }, { revision: "desc" }],
      include: { _count: { select: { entries: true } } },
    }),
    db.leaderboardSnapshot.count({ where: { competitionId: competition.id, kind: "WEEKLY" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly reports</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {reports.length} built · each one downloads as a PDF
        </p>
      </div>

      {hasWeeklySnapshot === 0 ? (
        <Alert>
          There is no weekly leaderboard snapshot yet, so a report has nothing truthful to describe.
          Run <code>make job NAME=snapshot-leaderboard</code> first — a report must never invent
          standings the site does not show.
        </Alert>
      ) : (
        <Card>
          <h2 className="mb-4 text-sm font-medium">Build a report</h2>
          <BuildReportForm competitionId={competition.id} build={buildReportAction} />
        </Card>
      )}

      {reports.length === 0 ? (
        <EmptyState title="No reports yet" body="Build one above, then download it as a PDF." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Week</th>
                  <th className="px-3 py-2.5 font-medium">Period</th>
                  <th className="px-3 py-2.5 text-right font-medium">Participants</th>
                  <th className="px-3 py-2.5 font-medium">Built</th>
                  <th className="px-5 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{r.isoWeek}</div>
                      {r.revision > 1 ? (
                        <div className="text-xs text-[var(--text-muted)]">rev {r.revision}</div>
                      ) : null}
                    </td>
                    <td className="tnum px-3 py-3 text-xs text-[var(--text-muted)]">
                      {r.periodStartDate} → {r.periodEndDate}
                    </td>
                    <td className="tnum px-3 py-3 text-right">{r._count.entries}</td>
                    <td className="tnum px-3 py-3 text-xs text-[var(--text-muted)]">
                      {r.builtAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="space-x-4 px-5 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/admin/reports/${r.id}`}
                        className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        View
                      </Link>
                      <a
                        href={`/api/admin/reports/${r.id}/pdf`}
                        className="text-sm font-medium text-accent-600 hover:text-accent-700"
                      >
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
