import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { renderReportPdf } from "@/server/reports/pdf";
import type { ReportSummary } from "@/server/reports/template";

/**
 * Serves a built report as a PDF. `?inline=1` shows it in the browser (the
 * preview on the report page); otherwise it downloads.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return new NextResponse("Not found", { status: 404 });

  const { id } = await context.params;
  const report = await db.weeklyReport.findUnique({
    where: { id },
    include: {
      competition: { select: { slug: true } },
      entries: {
        orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { participantId: "asc" }],
        include: { participant: { select: { displayName: true } } },
      },
    },
  });
  if (!report) return new NextResponse("That report no longer exists.", { status: 404 });

  const pdf = await renderReportPdf({
    summary: JSON.parse(report.summaryJson) as ReportSummary,
    isoWeek: report.isoWeek,
    revision: report.revision,
    introMessage: report.introMessage,
    showLeaderboard: report.showLeaderboard,
    showIndividual: report.showIndividual,
    leaderboardSize: report.leaderboardSize,
    rows: report.entries.map((e) => ({
      rank: e.rank,
      name: e.participant.displayName,
      totalValueCents: e.totalValueCents,
      weeklyReturnPpm: e.weeklyReturnPpm,
      totalReturnPpm: e.totalReturnPpm,
      bestSymbol: e.bestSymbol,
      worstSymbol: e.worstSymbol,
    })),
  });

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const filename = `${report.competition.slug}-${report.isoWeek}${report.revision > 1 ? `-rev${report.revision}` : ""}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      // Every participant's figures are in here; no proxy may keep a copy.
      "cache-control": "no-store, private",
    },
  });
}
