import { NextResponse } from "next/server";
import { dateKeyOf } from "@/lib/dates";
import { getSessionUser } from "@/server/auth/session";
import { toCsv } from "@/server/backup/csv";
import { db } from "@/server/db";
import { ANSWER_EXPORT_HEADERS, answerExportRows } from "@/server/survey/questions";

/**
 * Every participant's answers to the login questions, as a CSV download — the
 * same file the daily backup stores, generated now. Re-checks the admin role
 * itself: a route handler is reachable by URL without any layout rendering.
 */
export async function GET() {
  const user = await getSessionUser();
  // 404, not 403: an unauthorised caller learns only that there is nothing here.
  if (!user || user.role !== "ADMIN") {
    return new NextResponse("Not found", { status: 404 });
  }

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    select: { id: true, slug: true, timezone: true },
  });
  if (!competition) return new NextResponse("No competition", { status: 404 });

  const csv = toCsv(ANSWER_EXPORT_HEADERS, await answerExportRows(db, competition.id));
  const today = dateKeyOf(new Date(), competition.timezone);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${competition.slug}-answers-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
