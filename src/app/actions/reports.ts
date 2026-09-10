"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dateKeyOf } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { buildWeeklyReport, ReportError } from "@/server/reports/generate";
import { sendWeeklyReport } from "@/server/reports/send";

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
  force: z.boolean().default(false),
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

  try {
    const report = await buildWeeklyReport(db, {
      competitionId: parsed.data.competitionId,
      asOfDate: dateKeyOf(new Date(), competition.timezone),
      subject: parsed.data.subject,
      introMessage: parsed.data.introMessage ?? null,
      showLeaderboard: parsed.data.showLeaderboard,
      showIndividual: parsed.data.showIndividual,
      leaderboardSize: parsed.data.leaderboardSize,
      force: parsed.data.force,
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
      message: `${report.isoWeek} built — ${report.recipientCount} recipients. Nothing has been sent.`,
    };
  } catch (error: unknown) {
    if (error instanceof ReportError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function testSendAction(
  reportId: string,
  toEmail: string,
): Promise<ReportActionResult> {
  const admin = await requireAdmin();

  const parsed = z.string().email().safeParse(toEmail.trim());
  if (!parsed.success) {
    return { ok: false, error: "That does not look like an email address." };
  }

  // Sends the frozen HTML of the top-ranked entry, so the test is a real
  // recipient's email rather than a mock-up of one.
  const outcome = await sendWeeklyReport(db, reportId, { testTo: parsed.data });

  await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: "ADMIN",
      action: "report.test_send",
      entityType: "WeeklyReport",
      entityId: reportId,
      afterJson: JSON.stringify({ to: parsed.data }),
    },
  });

  revalidatePath("/admin/reports");
  if (outcome.failed > 0) {
    return { ok: false, error: outcome.errors[0] ?? "The test email could not be sent." };
  }
  return { ok: true, message: `Test email sent to ${parsed.data}.` };
}

export async function sendReportAction(reportId: string): Promise<ReportActionResult> {
  const admin = await requireAdmin();

  const report = await db.weeklyReport.findUnique({
    where: { id: reportId },
    select: { status: true, isoWeek: true, recipientCount: true },
  });
  if (!report) return { ok: false, error: "That report no longer exists." };
  if (report.status === "SENT") {
    return { ok: false, error: `${report.isoWeek} has already been sent to everyone.` };
  }

  const outcome = await sendWeeklyReport(db, reportId);

  await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: "ADMIN",
      action: "report.send",
      entityType: "WeeklyReport",
      entityId: reportId,
      afterJson: JSON.stringify(outcome),
    },
  });

  revalidatePath("/admin/reports");
  return {
    ok: outcome.failed === 0,
    message: `${outcome.sent} sent${outcome.skipped > 0 ? `, ${outcome.skipped} skipped` : ""}.`,
    error:
      outcome.failed > 0
        ? `${outcome.failed} failed. First error: ${outcome.errors[0] ?? "unknown"}. Re-running sends only the ones that did not go out.`
        : undefined,
  };
}

export async function scheduleReportAction(
  reportId: string,
  whenIso: string,
): Promise<ReportActionResult> {
  const admin = await requireAdmin();

  const when = new Date(whenIso);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "That is not a valid date and time." };
  }
  if (when.getTime() < Date.now()) {
    return { ok: false, error: "That time has already passed. Pick a later one, or send now." };
  }

  await db.weeklyReport.update({
    where: { id: reportId },
    data: { status: "SCHEDULED", scheduledFor: when },
  });

  await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: "ADMIN",
      action: "report.schedule",
      entityType: "WeeklyReport",
      entityId: reportId,
      afterJson: JSON.stringify({ scheduledFor: when.toISOString() }),
    },
  });

  revalidatePath("/admin/reports");
  return {
    ok: true,
    message: `Scheduled for ${when.toLocaleString("en-GB")}. The send job picks it up within ten minutes of that time.`,
  };
}
