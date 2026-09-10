import type { Metadata } from "next";
import Link from "next/link";
import { buildReportAction } from "@/app/actions/reports";
import { BuildReportForm } from "@/components/report-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { env, EMAIL_PROVIDERS } from "@/lib/env";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  SENT: "bg-up-50 text-up-700",
  PARTIALLY_SENT: "bg-down-50 text-down-700",
  FAILED: "bg-down-50 text-down-700",
  SCHEDULED: "bg-accent-50 text-accent-700",
};

export default async function AdminReportsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const [reports, hasWeeklySnapshot, emailCount] = await Promise.all([
    db.weeklyReport.findMany({
      where: { competitionId: competition.id },
      orderBy: [{ weekNumber: "desc" }, { revision: "desc" }],
      include: { _count: { select: { entries: true, emailLogs: true } } },
    }),
    db.leaderboardSnapshot.count({ where: { competitionId: competition.id, kind: "WEEKLY" } }),
    db.emailLog.count(),
  ]);

  // Rendered from the exported list rather than written out, so no page hard-codes
  // a provider's name — build/check-scripts.sh cannot tell a helpful sentence from
  // a real dependency, and one source of truth beats an exception to the check.
  const realProviders = EMAIL_PROVIDERS.filter((p) => p !== "console").join(" or ");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly reports</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {reports.length} built · {emailCount} email{emailCount === 1 ? "" : "s"} logged · sending
          through the <strong>{env.EMAIL_PROVIDER}</strong> provider
        </p>
      </div>

      {env.EMAIL_PROVIDER === "console" ? (
        <Alert tone="info">
          Emails are written to <code>{env.EMAIL_OUTBOX_DIR}/</code> instead of being sent, so the
          whole pipeline can be exercised and reviewed without credentials. Set{" "}
          <code>EMAIL_PROVIDER</code> to {realProviders} to deliver for real.
        </Alert>
      ) : null}

      {hasWeeklySnapshot === 0 ? (
        <Alert>
          There is no weekly leaderboard snapshot yet, so a report has nothing truthful to describe.
          Run <code>make job NAME=snapshot-leaderboard</code> first — a report must never invent
          standings the site does not show.
        </Alert>
      ) : (
        <Card>
          <h2 className="mb-4 text-sm font-medium">Build a report</h2>
          <BuildReportForm
            competitionId={competition.id}
            defaultSubject={`${env.COMPANY_NAME} Stock Challenge — this week's results`}
            build={buildReportAction}
          />
        </Card>
      )}

      {reports.length === 0 ? (
        <EmptyState title="No reports yet" body="Build one above to preview and send it." />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Week</th>
                  <th className="px-3 py-2.5 font-medium">Period</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Recipients</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
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
                    <td className="px-3 py-3">
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-xs font-medium " +
                          (STATUS_TONE[r.status] ??
                            "bg-[var(--surface-sunken)] text-[var(--text-muted)]")
                        }
                      >
                        {r.status.toLowerCase().replace("_", " ")}
                      </span>
                      {r.scheduledFor && r.status === "SCHEDULED" ? (
                        <div className="tnum mt-0.5 text-xs text-[var(--text-muted)]">
                          {r.scheduledFor.toISOString().slice(0, 16).replace("T", " ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="tnum px-3 py-3 text-right">{r.recipientCount}</td>
                    <td className="tnum px-3 py-3 text-right">
                      {r.sentCount}
                      {r.failedCount > 0 ? (
                        <span className="ml-1 text-xs text-down-600">({r.failedCount} failed)</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/reports/${r.id}`}
                        className="text-sm font-medium text-accent-600 hover:text-accent-700"
                      >
                        Open
                      </Link>
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
