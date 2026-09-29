"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dateKeyOf } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { buildWeeklyReport, ReportError } from "@/server/reports/generate";

export interface ReportActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  reportId?: string;
}

const buildSchema = z.object({
  competitionId: z.string().min(1),
  subject: z.string().trim().min(1).max(200).optional(),
  introMessage: z.string().trim().max(1000).optional(),
  showLeaderboard: z.boolean().default(true),
  showIndividual: z.boolean().default(true),
  leaderboardSize: z.coerce.number().int().min(3).max(50).default(10),
});

export async function buildReportAction(
  input: z.input<typeof buildSchema>,
): Promise<ReportActionResult> {
  const admin = await requireAdmin();
  const parsed = buildSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those settings are not valid." };
  }

  const competition = await db.competition.findUnique({
    where: { id: parsed.data.competitionId },
    select: { timezone: true },
  });
  if (!competition) return { ok: false, error: "That competition no longer exists." };

  const build = (force: boolean) =>
    buildWeeklyReport(db, {
      competitionId: parsed.data.competitionId,
      asOfDate: dateKeyOf(new Date(), competition.timezone),
      subject: parsed.data.subject,
      introMessage: parsed.data.introMessage ?? null,
      showLeaderboard: parsed.data.showLeaderboard,
      showIndividual: parsed.data.showIndividual,
      leaderboardSize: parsed.data.leaderboardSize,
      force,
    });

  try {
    // Reports are downloaded, not emailed, so the "already sent" guard only
    // fires for weeks emailed before that change. Those are kept for audit and
    // the rebuild becomes a new revision, instead of asking the admin to tick a
    // box about sending that no longer exists.
    const report = await build(false).catch((error: unknown) => {
      if (error instanceof ReportError && error.code === "ALREADY_SENT") return build(true);
      throw error;
    });

    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorRole: "ADMIN",
        action: "report.build",
        entityType: "WeeklyReport",
        entityId: report.id,
        afterJson: JSON.stringify({ isoWeek: report.isoWeek, recipients: report.recipientCount }),
      },
    });

    revalidatePath("/admin/reports");
    return {
      ok: true,
      reportId: report.id,
      message: `${report.isoWeek} built. Download it as a PDF from the list below.`,
    };
  } catch (error: unknown) {
    if (error instanceof ReportError) return { ok: false, error: error.message };
    throw error;
  }
}
