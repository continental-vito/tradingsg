import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/**
 * Leaderboard export.
 *
 * A route handler rather than a server action, because the browser has to
 * download the result. It re-checks the admin role itself — a route handler is
 * reachable by URL without any layout having rendered.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  // 404, not 403: an unauthorised caller learns only that there is nothing here.
  if (!user || user.role !== "ADMIN") {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const asOfDate = url.searchParams.get("asOf");

  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { kind: "DAILY", ...(asOfDate ? { asOfDate } : {}) },
    orderBy: { asOfDate: "desc" },
    include: {
      competition: { select: { name: true, currency: true, startingCapitalCents: true } },
      entries: {
        orderBy: { displayOrder: "asc" },
        include: {
          participant: {
            select: {
              displayName: true,
              user: { select: { firstName: true, lastName: true, email: true, department: true } },
            },
          },
        },
      },
    },
  });

  if (!snapshot) return new NextResponse("No snapshot to export", { status: 404 });

  // Values are written as plain decimals with a dot, not formatted currency: a
  // spreadsheet has to be able to add them up.
  const cents = (v: bigint) => (Number(v) / 100).toFixed(2);
  const pct = (ppm: number) => (ppm / 10_000).toFixed(4);

  const rows: string[][] = [
    [
      "rank",
      "display_order",
      "participant",
      "first_name",
      "last_name",
      "email",
      "department",
      "ranked",
      "unranked_reason",
      "portfolio_value",
      "gain_loss",
      "total_return_pct",
      "weekly_return_pct",
      "positions",
      "transactions",
      "rank_change",
    ],
    ...snapshot.entries.map((e) => [
      e.rank === null ? "" : String(e.rank),
      String(e.displayOrder),
      e.participant.displayName,
      e.participant.user.firstName,
      e.participant.user.lastName,
      e.participant.user.email,
      e.participant.user.department ?? "",
      e.isRanked ? "yes" : "no",
      e.unrankedReason ?? "",
      cents(e.totalValueCents),
      cents(e.totalValueCents - snapshot.competition.startingCapitalCents),
      pct(e.totalReturnPpm),
      e.weeklyReturnPpm === null ? "" : pct(e.weeklyReturnPpm),
      String(e.positionCount),
      String(e.transactionCount),
      e.rankChange === null ? "" : String(e.rankChange),
    ]),
  ];

  // Quote every field and double any embedded quote. A participant called
  // O'Brien, or a department with a comma in it, must not shift the columns.
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  const filename = `leaderboard-${snapshot.asOfDate}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
