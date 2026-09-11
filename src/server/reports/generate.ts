import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { daysBetween, isoWeekOf, type DateKey } from "@/lib/dates";
import { env } from "@/lib/env";
import { toPpm } from "@/server/money";
import {
  renderEmail,
  renderShared,
  type ReportLeaderRow,
  type ReportPersonal,
  type ReportSummary,
} from "./template";

/**
 * Building the weekly report.
 *
 * The principle: compute once, freeze everything, render once. Preview, test
 * send and real send all read the same `renderedHtml` column, so a report
 * cannot say one thing on screen and another in the inbox because prices moved
 * in between. Drift is structurally impossible rather than merely unlikely.
 *
 * Nothing is computed here that the leaderboard has not already committed. The
 * snapshots are READ; if the one this report needs is missing, it fails loudly
 * rather than inventing numbers that would then disagree with the site.
 */

export class ReportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

export interface BuildArgs {
  competitionId: string;
  asOfDate: DateKey;
  subject?: string;
  introMessage?: string | null;
  showLeaderboard?: boolean;
  showIndividual?: boolean;
  leaderboardSize?: number;
  force?: boolean;
}

export async function buildWeeklyReport(db: PrismaClient, args: BuildArgs) {
  const competition = await db.competition.findUniqueOrThrow({
    where: { id: args.competitionId },
  });

  // The weekly snapshot at or before the date. Read, never computed.
  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "WEEKLY", asOfDate: { lte: args.asOfDate } },
    orderBy: { asOfDate: "desc" },
    include: {
      entries: {
        orderBy: { displayOrder: "asc" },
        include: {
          participant: {
            include: {
              user: { select: { id: true, firstName: true, email: true, isDisabled: true } },
            },
          },
        },
      },
    },
  });

  if (!snapshot) {
    throw new ReportError(
      `No weekly leaderboard snapshot exists on or before ${args.asOfDate}. ` +
        `Run \`make job NAME=snapshot-leaderboard\` first — a report must never invent standings the site does not show.`,
      "MISSING_SNAPSHOT",
    );
  }

  const previous = snapshot.previousSnapshotId
    ? await db.leaderboardSnapshot.findUnique({
        where: { id: snapshot.previousSnapshotId },
        include: { entries: true },
      })
    : null;
  const previousByParticipant = new Map((previous?.entries ?? []).map((e) => [e.participantId, e]));

  const isoWeek = isoWeekOf(snapshot.asOfDate);
  const weekNumber = Number(isoWeek.slice(-2));

  const existing = await db.weeklyReport.findFirst({
    where: { competitionId: competition.id, isoWeek },
    orderBy: { revision: "desc" },
  });
  if (existing && (existing.status === "SENT" || existing.status === "PARTIALLY_SENT")) {
    if (!args.force) {
      throw new ReportError(
        `The report for ${isoWeek} has already been sent. Re-building it would change what recipients can compare against their inbox. Use force to create a new revision.`,
        "ALREADY_SENT",
      );
    }
  }

  // Who has turned the weekly email off. The notifications page offers that
  // choice per channel, and until now only the IN_APP half was honoured — so
  // opting out silenced the in-app item and the email arrived anyway, which
  // makes the setting a lie rather than a preference.
  const optedOut = new Set(
    (
      await db.notificationPreference.findMany({
        where: { type: "WEEKLY_REPORT", channel: "EMAIL", enabled: false },
        select: { userId: true },
      })
    ).map((p) => p.userId),
  );

  const ranked = snapshot.entries.filter((e) => e.rank !== null);
  const returns = ranked.map((e) => e.totalReturnPpm);
  const averageReturnPpm =
    returns.length > 0 ? Math.round(returns.reduce((a, b) => a + b, 0) / returns.length) : 0;

  const periodStart = previous?.asOfDate ?? competition.startDate;

  const summary: ReportSummary = {
    competitionName: competition.name,
    companyName: env.COMPANY_NAME,
    weekLabel: `Week ${weekNumber} results`,
    periodStart,
    periodEnd: snapshot.asOfDate,
    participantCount: snapshot.participantCount,
    rankedCount: snapshot.rankedCount,
    leaderName: ranked[0]?.participant.displayName ?? "—",
    averageReturnPpm,
    bestReturnPpm: snapshot.bestReturnPpm,
    worstReturnPpm: snapshot.worstReturnPpm,
    aumCents: snapshot.totalAumCents.toString(),
    daysRemaining: Math.max(0, daysBetween(snapshot.asOfDate, competition.endDate)),
    currency: competition.currency,
  };

  const size = args.leaderboardSize ?? 10;
  const showLeaderboard = args.showLeaderboard ?? true;
  const showIndividual = args.showIndividual ?? true;

  const leaders: ReportLeaderRow[] = ranked.slice(0, size).map((e) => ({
    rank: e.rank ?? 0,
    name: e.participant.displayName,
    valueCents: e.totalValueCents.toString(),
    totalReturnPpm: e.totalReturnPpm,
    weeklyReturnPpm: e.weeklyReturnPpm ?? 0,
    isYou: false,
  }));

  const subject =
    args.subject ??
    `${env.COMPANY_NAME} Stock Challenge — week ${weekNumber}: ${summary.leaderName} leads`;

  const revision = existing ? (args.force ? existing.revision + 1 : existing.revision) : 1;

  return db.$transaction(async (tx) => {
    if (existing && !args.force) {
      await tx.weeklyReportEntry.deleteMany({ where: { reportId: existing.id } });
      await tx.weeklyReport.delete({ where: { id: existing.id } });
    }

    const report = await tx.weeklyReport.create({
      data: {
        competitionId: competition.id,
        isoWeek,
        weekNumber,
        revision,
        periodStartDate: periodStart,
        periodEndDate: snapshot.asOfDate,
        status: "READY",
        snapshotId: snapshot.id,
        previousSnapshotId: previous?.id ?? null,
        subject,
        introMessage: args.introMessage ?? null,
        showLeaderboard,
        showIndividual,
        leaderboardSize: size,
        // Rendered once, without any recipient's own row highlighted, so it can
        // be reused verbatim in every email.
        sharedHtml: renderShared(summary, leaders, showLeaderboard),
        summaryJson: JSON.stringify(summary),
        recipientCount: 0,
        isDemo: competition.isDemo,
      },
    });

    let recipients = 0;

    for (const entry of snapshot.entries) {
      const participant = entry.participant;
      const previousEntry = previousByParticipant.get(entry.participantId);

      const weeklyPnlCents =
        previousEntry !== undefined
          ? entry.totalValueCents - previousEntry.totalValueCents
          : entry.totalValueCents - participant.initialCapitalCents;

      const weeklyReturnPpm =
        previousEntry !== undefined && previousEntry.totalValueCents > 0n
          ? toPpm(weeklyPnlCents, previousEntry.totalValueCents)
          : entry.totalReturnPpm;

      // Best and worst by euro CONTRIBUTION, not percentage move. A 40% pop on
      // a 1% position is not anyone's best holding: it moved the needle €400
      // while the 30% position that fell 5% cost €1,500.
      const holdingValuations = entry.valuationId
        ? await tx.holdingValuation.findMany({
            where: { valuationId: entry.valuationId },
            include: { stock: { select: { symbol: true } } },
          })
        : [];
      const byContribution = [...holdingValuations].sort((a, b) =>
        Number(b.unrealizedPnlCents - a.unrealizedPnlCents),
      );
      const bestHolding = byContribution[0];
      const worstHolding = byContribution[byContribution.length - 1];

      const personal: ReportPersonal = {
        firstName: participant.user.firstName,
        rank: entry.rank,
        rankChange: entry.rankChange,
        isRanked: entry.isRanked,
        valueCents: entry.totalValueCents.toString(),
        weeklyReturnPpm,
        totalReturnPpm: entry.totalReturnPpm,
        weeklyPnlCents: weeklyPnlCents.toString(),
        totalPnlCents: (entry.totalValueCents - participant.initialCapitalCents).toString(),
        best:
          bestHolding && bestHolding.unrealizedPnlCents > 0n
            ? {
                symbol: bestHolding.stock.symbol,
                returnPpm: bestHolding.positionReturnPpm,
                contributionCents: bestHolding.unrealizedPnlCents.toString(),
              }
            : null,
        worst:
          worstHolding && worstHolding !== bestHolding && worstHolding.unrealizedPnlCents < 0n
            ? {
                symbol: worstHolding.stock.symbol,
                returnPpm: worstHolding.positionReturnPpm,
                contributionCents: worstHolding.unrealizedPnlCents.toString(),
              }
            : null,
      };

      // The recipient's own row is highlighted in their copy of the table.
      const personalLeaders = leaders.map((row) => ({
        ...row,
        isYou: row.name === participant.displayName,
      }));

      const { html, text } = renderEmail({
        summary,
        personal,
        sharedHtml: renderShared(summary, personalLeaders, showLeaderboard),
        introMessage: args.introMessage ?? null,
        appUrl: env.APP_URL,
        showIndividual,
      });

      const skipReason = participant.user.isDisabled
        ? "INACTIVE"
        : !participant.user.email
          ? "NO_EMAIL"
          : optedOut.has(participant.userId)
            ? "OPTED_OUT"
            : null;

      await tx.weeklyReportEntry.create({
        data: {
          reportId: report.id,
          participantId: entry.participantId,
          rank: entry.rank,
          previousRank: previousEntry?.rank ?? null,
          rankChange: entry.rankChange,
          isRanked: entry.isRanked,
          totalValueCents: entry.totalValueCents,
          weeklyPnlCents,
          totalPnlCents: entry.totalValueCents - participant.initialCapitalCents,
          weeklyReturnPpm,
          totalReturnPpm: entry.totalReturnPpm,
          positionCount: entry.positionCount,
          tradesThisWeek: 0,
          bestStockId: bestHolding?.stockId ?? null,
          bestSymbol: personal.best?.symbol ?? null,
          bestContributionCents: personal.best ? BigInt(personal.best.contributionCents) : null,
          bestReturnPpm: personal.best?.returnPpm ?? null,
          worstStockId: worstHolding?.stockId ?? null,
          worstSymbol: personal.worst?.symbol ?? null,
          worstContributionCents: personal.worst ? BigInt(personal.worst.contributionCents) : null,
          worstReturnPpm: personal.worst?.returnPpm ?? null,
          payloadJson: JSON.stringify(personal),
          renderedSubject: subject,
          renderedHtml: html,
          renderedText: text,
          // Recorded at build, compared at send. A mismatch would prove the
          // stored email had been altered between the two.
          contentHash: createHash("sha256").update(html).digest("hex"),
          sendStatus: skipReason ? "SKIPPED" : "PENDING",
          skipReason,
        },
      });

      if (!skipReason) recipients++;
    }

    return tx.weeklyReport.update({
      where: { id: report.id },
      data: { recipientCount: recipients },
    });
  });
}
