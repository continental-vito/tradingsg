import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { createEmailProvider } from "@/server/email";

/**
 * Sending a built report.
 *
 * Reads the frozen `renderedHtml` — never re-renders — so a test send at 07:00
 * and the real send at 08:00 are byte-identical even though prices moved in
 * between. That is exactly the right semantics for a report about last week.
 *
 * The EmailLog row is written BEFORE the send is attempted, and its dedupeKey
 * is unique. A crash between the two loses one email; the other order sends it
 * twice. Losing one is the better failure — the report is still on the site and
 * the next run picks it up — and the unique key means a re-run after a partial
 * failure cannot double-send even if sendStatus was left inconsistent.
 */

export interface SendOutcome {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function sendWeeklyReport(
  db: PrismaClient,
  reportId: string,
  options: { testTo?: string; participantId?: string } = {},
): Promise<SendOutcome> {
  const provider = createEmailProvider();
  const isTest = Boolean(options.testTo);

  const report = await db.weeklyReport.findUniqueOrThrow({
    where: { id: reportId },
    include: {
      entries: {
        where: options.participantId
          ? { participantId: options.participantId }
          : isTest
            ? {}
            : { sendStatus: { in: ["PENDING", "FAILED"] } },
        orderBy: { rank: "asc" },
        take: isTest ? 1 : undefined,
        include: {
          participant: {
            include: { user: { select: { email: true, firstName: true, lastName: true } } },
          },
        },
      },
    },
  });

  const outcome: SendOutcome = { attempted: 0, sent: 0, failed: 0, skipped: 0, errors: [] };

  if (report.entries.length === 0) {
    return outcome;
  }

  if (!isTest) {
    await db.weeklyReport.update({
      where: { id: reportId },
      data: { status: "SENDING", sendStartedAt: new Date() },
    });
  }

  for (const entry of report.entries) {
    if (!isTest && entry.sendStatus === "SKIPPED") {
      outcome.skipped++;
      continue;
    }

    const toEmail = options.testTo ?? entry.participant.user.email;
    const toName = `${entry.participant.user.firstName} ${entry.participant.user.lastName}`;
    const dedupeKey = isTest
      ? `weekly-test:${report.id}:${report.revision}:${entry.participantId}:${Date.now()}`
      : `weekly:${report.id}:${report.revision}:${entry.participantId}`;

    outcome.attempted++;

    // Written first, deliberately. See the note at the top of this file.
    let log;
    try {
      log = await db.emailLog.create({
        data: {
          dedupeKey,
          reportId: report.id,
          participantId: entry.participantId,
          provider: provider.name,
          kind: isTest ? "TEST" : "WEEKLY_REPORT",
          toEmail,
          toName,
          fromEmail: env.EMAIL_FROM,
          subject: isTest ? `[TEST] ${entry.renderedSubject}` : entry.renderedSubject,
          bodyHash: entry.contentHash,
          status: "SENDING",
          isTest,
        },
      });
    } catch {
      // The unique dedupeKey rejected it: this exact email already went out.
      // That is the constraint doing its job, not an error.
      outcome.skipped++;
      continue;
    }

    try {
      const result = await provider.send({
        to: toEmail,
        toName,
        subject: isTest ? `[TEST] ${entry.renderedSubject}` : entry.renderedSubject,
        html: entry.renderedHtml,
        text: entry.renderedText ?? undefined,
      });

      await db.emailLog.update({
        where: { id: log.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          htmlPath: result.path ?? null,
          attempts: 1,
        },
      });

      if (!isTest) {
        await db.weeklyReportEntry.update({
          where: { id: entry.id },
          data: { sendStatus: "SENT", sentAt: new Date(), emailLogId: log.id },
        });
      }
      outcome.sent++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await db.emailLog.update({
        where: { id: log.id },
        data: { status: "FAILED", error: message, attempts: 1 },
      });
      if (!isTest) {
        await db.weeklyReportEntry.update({
          where: { id: entry.id },
          data: { sendStatus: "FAILED" },
        });
      }
      outcome.failed++;
      if (outcome.errors.length < 5) outcome.errors.push(`${toEmail}: ${message}`);
    }
  }

  if (!isTest) {
    const remaining = await db.weeklyReportEntry.count({
      where: { reportId, sendStatus: { in: ["PENDING", "FAILED"] } },
    });
    const sentCount = await db.weeklyReportEntry.count({
      where: { reportId, sendStatus: "SENT" },
    });
    await db.weeklyReport.update({
      where: { id: reportId },
      data: {
        status: remaining === 0 ? "SENT" : sentCount > 0 ? "PARTIALLY_SENT" : "FAILED",
        sentAt: remaining === 0 ? new Date() : null,
        sentCount,
        failedCount: remaining,
      },
    });
  }

  return outcome;
}
