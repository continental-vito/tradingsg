import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/**
 * Downloads one stored CSV backup.
 *
 * A route handler rather than a server action, because the browser has to
 * receive a file. It re-checks the admin role itself — a route handler is
 * reachable by URL without any layout having rendered — and answers 404 rather
 * than 403, so an unauthorised caller does not learn the export exists.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return new NextResponse("Not found", { status: 404 });

  const { id } = await context.params;
  const file = await db.dataExport.findUnique({ where: { id } });
  if (!file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(file.content, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      // The checksum recorded when the file was written, so a download can be
      // verified against it rather than trusted.
      "x-content-sha256": file.checksum,
      "cache-control": "no-store, private",
    },
  });
}
