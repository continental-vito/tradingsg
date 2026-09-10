import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { scheduleReportAction, sendReportAction, testSendAction } from "@/app/actions/reports";
import { SendControls } from "@/components/report-controls";
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
      emailLogs: { orderBy: { queuedAt: "desc" }, take: 40 },
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
          {report.periodStartDate} to {report.periodEndDate} · {report.recipientCount} recipients ·
          status {report.status.toLowerCase().replace("_", " ")}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-sm font-medium text-[var(--text-muted)]">Preview</h2>
            <a
              href={`/api/admin/reports/${report.id}/preview`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-accent-600 hover:text-accent-700"
            >
              Open in a new tab
            </a>
          </div>
          {/* The iframe shows the stored bytes, not a re-render of them — the
              same column the send path reads. */}
          <iframe
            title="Report preview"
            src={`/api/admin/reports/${report.id}/preview`}
            sandbox=""
            className="h-[820px] w-full border-0 bg-white"
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 text-sm font-medium">Send</h2>
            <SendControls
              reportId={report.id}
              status={report.status}
              recipientCount={report.recipientCount}
              testSend={testSendAction}
              send={sendReportAction}
              schedule={scheduleReportAction}
            />
          </Card>

          <Card>
            <h2 className="text-sm font-medium">Subject</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{report.subject}</p>
            {report.introMessage ? (
              <>
                <h3 className="mt-3 text-sm font-medium">Introduction</h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{report.introMessage}</p>
              </>
            ) : null}
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Leaderboard {report.showLeaderboard ? "included" : "hidden"} · personal section{" "}
              {report.showIndividual ? "included" : "hidden"} · top {report.leaderboardSize}
            </p>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
          Recipients ({report.entries.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="px-5 py-2.5 font-medium">Rank</th>
                <th className="px-3 py-2.5 font-medium">Participant</th>
                <th className="px-3 py-2.5 text-right font-medium">This week</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 font-medium">Delivery</th>
                <th className="px-5 py-2.5 text-right font-medium" />
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
                  <td className="px-3 py-2.5 text-xs">
                    {e.sendStatus.toLowerCase()}
                    {e.skipReason ? (
                      <span className="text-[var(--text-muted)]">
                        {" "}
                        · {e.skipReason.toLowerCase()}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <a
                      href={`/api/admin/reports/${report.id}/preview?participantId=${e.participantId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-accent-600"
                    >
                      Preview
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {report.emailLogs.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
            Sending history
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Queued</th>
                  <th className="px-3 py-2.5 font-medium">To</th>
                  <th className="px-3 py-2.5 font-medium">Provider</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {report.emailLogs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="tnum px-5 py-2.5 text-xs">
                      {log.queuedAt.toISOString().slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2.5">
                      {log.toEmail}
                      {log.isTest ? (
                        <span className="ml-1.5 rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">
                          test
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-muted)]">{log.provider}</td>
                    <td
                      className={
                        "px-3 py-2.5 " +
                        (log.status === "SENT"
                          ? "text-up-600"
                          : log.status === "FAILED"
                            ? "text-down-600"
                            : "")
                      }
                    >
                      {log.status.toLowerCase()}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">
                      {log.error ?? log.htmlPath ?? log.providerMessageId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
