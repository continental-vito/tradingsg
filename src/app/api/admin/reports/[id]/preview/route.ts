import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/**
 * Serves one recipient's frozen email as a page, so the admin previews the
 * exact bytes that will be delivered rather than a re-render of them.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return new NextResponse("Not found", { status: 404 });

  const { id } = await context.params;
  const participantId = new URL(request.url).searchParams.get("participantId");

  const entry = await db.weeklyReportEntry.findFirst({
    where: { reportId: id, ...(participantId ? { participantId } : {}) },
    orderBy: { rank: "asc" },
  });
  if (!entry) return new NextResponse("No report entry to preview", { status: 404 });

  return new NextResponse(entry.renderedHtml, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The email may embed a participant's figures; it must never be cached
      // by a proxy between here and the admin's browser.
      "cache-control": "no-store, private",
      // Rendered email HTML is stored data. Serving it with a locked-down CSP
      // means a report cannot become a script-injection vector.
      "content-security-policy":
        "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
