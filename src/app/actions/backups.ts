"use server";

import { revalidatePath } from "next/cache";
import { dateKeyOf } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { storeExports } from "@/server/backup/export";

export interface BackupResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Writes a backup for today on demand, rather than waiting for the nightly job.
 * The same code path the job uses, so what you download now is what you would
 * have got tonight.
 */
export async function generateBackupAction(competitionId: string): Promise<BackupResult> {
  const admin = await requireAdmin();

  const competition = await db.competition.findUnique({
    where: { id: competitionId },
    select: { timezone: true, name: true },
  });
  if (!competition) return { ok: false, error: "That competition no longer exists." };

  const asOfDate = dateKeyOf(new Date(), competition.timezone);
  const files = await storeExports(db, competitionId, asOfDate, "ADMIN");

  await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: "ADMIN",
      action: "backup.generate",
      entityType: "Competition",
      entityId: competitionId,
      afterJson: JSON.stringify({ asOfDate, files: files.map((f) => f.kind) }),
    },
  });

  revalidatePath("/admin/backups");

  const rows = files.reduce((sum, f) => sum + f.rowCount, 0);
  return {
    ok: true,
    message: `Backup written for ${asOfDate}: ${files.length} files, ${rows} rows. Today's earlier backup, if there was one, has been replaced.`,
  };
}
