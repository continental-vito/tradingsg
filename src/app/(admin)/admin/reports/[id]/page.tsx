import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm } from "@/server/money";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function AdminReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const report = await db.weeklyReport.findUnique({
    where: { id },
    include: {
      competition: { select: { name: true, currency: true } },
      entries: {
        orderBy: [{ rank: "asc" }, { participantId: "asc" }],
        include: {
          participant: { select: { displayName: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!report) notFound();

  const currency = report.competition.currency;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/reports"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ← All reports
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{report.isoWeek}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {report.periodStartDate} to {report.periodEndDate} · {report.entries.length} participants
          {report.revision > 1 ? ` · revision ${report.revision}` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-sm font-medium text-[var(--text-muted)]">Preview</h2>
            <a
              href={`/api/admin/reports/${report.id}/pdf?inline=1`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-accent-600 hover:text-accent-700"
            >
              Open in a new tab
            </a>
          </div>
          {/* Not sandboxed: a sandboxed iframe blocks the browser's built-in PDF
              viewer, and this only ever shows a PDF this app generated. */}
          <iframe
            title="Report preview"
            src={`/api/admin/reports/${report.id}/pdf?inline=1`}
            className="h-[820px] w-full border-0 bg-white"
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-medium">Download</h2>
            <p className="mt-1 mb-4 text-sm text-[var(--text-muted)]">
              The figures are frozen from the week&rsquo;s leaderboard, so the PDF reads the same
              whenever it is downloaded.
            </p>
            <a
              href={`/api/admin/reports/${report.id}/pdf`}
              className="inline-flex rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Download PDF
            </a>
          </Card>

          <Card>
            {report.introMessage ? (
              <>
                <h2 className="text-sm font-medium">Introduction</h2>
                <p className="mt-1 mb-3 text-sm text-[var(--text-muted)]">{report.introMessage}</p>
              </>
            ) : null}
            <p className="text-xs text-[var(--text-muted)]">
              Top {report.leaderboardSize} {report.showLeaderboard ? "included" : "hidden"} · all
              participants {report.showIndividual ? "included" : "hidden"}
            </p>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
          Participants ({report.entries.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-5 py-2.5 font-medium">Rank</th>
                <th className="px-3 py-2.5 font-medium">Participant</th>
                <th className="px-3 py-2.5 text-right font-medium">This week</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="tnum px-5 py-2.5">{e.rank ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div>{e.participant.displayName}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {e.participant.user.email}
                    </div>
                  </td>
                  <td
                    className={
                      "tnum px-3 py-2.5 text-right " +
                      toneClass(e.weeklyReturnPpm > 0 ? 1 : e.weeklyReturnPpm < 0 ? -1 : 0)
                    }
                  >
                    {formatPpm(e.weeklyReturnPpm)}
                  </td>
                  <td
                    className={
                      "tnum px-3 py-2.5 text-right " +
                      toneClass(e.totalReturnPpm > 0 ? 1 : e.totalReturnPpm < 0 ? -1 : 0)
                    }
                  >
                    {formatPpm(e.totalReturnPpm)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    {formatCents(e.totalValueCents, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
