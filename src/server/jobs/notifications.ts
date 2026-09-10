import { daysBetween, type DateKey } from "@/lib/dates";
import type { JobContext, JobResult } from "./run";

/**
 * Creating notifications.
 *
 * The job recomputes what notifications SHOULD exist right now and inserts the
 * ones that do not, rather than reacting to events as they happen. That makes
 * it self-healing: a missed run means a late notification, never a duplicate
 * and never a gap.
 *
 * `Notification.dedupeKey` is unique and inserts use skipDuplicates, so the
 * "should exist" set can be recomputed as often as you like. Without it, an
 * hourly job tells someone they reached the top three once an hour for a week.
 *
 * Every type is gated by its own competition setting AND by the participant's
 * own preference, so an admin can turn a whole category off and an individual
 * can opt out of one.
 */
export async function runNotifications(
  ctx: JobContext,
  args: { competitionId: string; asOfDate: DateKey },
): Promise<JobResult> {
  const { db, log } = ctx;

  const competition = await db.competition.findUniqueOrThrow({
    where: { id: args.competitionId },
    include: {
      settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
    },
  });
  const settings = competition.settings[0];
  if (!settings) {
    log("No settings — nothing to notify about.");
    return { itemsProcessed: 0 };
  }

  const participants = await db.participant.findMany({
    where: { competitionId: competition.id, deletedAt: null, status: { not: "DISQUALIFIED" } },
    include: {
      user: { select: { id: true, isDisabled: true } },
      portfolio: { select: { setupCompletedAt: true } },
    },
  });
  if (participants.length === 0) return { itemsProcessed: 0 };

  // One query for every opt-out, rather than one per participant per type.
  const prefs = await db.notificationPreference.findMany({
    where: { userId: { in: participants.map((p) => p.userId) }, enabled: false },
    select: { userId: true, type: true },
  });
  const optedOut = new Set(prefs.map((p) => `${p.userId}:${p.type}`));

  const [latest, previous] = await db.leaderboardSnapshot.findMany({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    take: 2,
    include: { entries: true },
  });

  const rankNow = new Map((latest?.entries ?? []).map((e) => [e.participantId, e.rank]));
  const rankBefore = new Map((previous?.entries ?? []).map((e) => [e.participantId, e.rank]));

  const now = new Date();
  const today = args.asOfDate;
  const daysToEnd = daysBetween(today, competition.endDate);
  const daysFromStart = daysBetween(competition.startDate, today);

  interface Pending {
    userId: string;
    type: string;
    severity: string;
    title: string;
    body: string;
    linkUrl: string;
    dedupeKey: string;
  }
  const pending: Pending[] = [];

  const push = (n: Pending, enabled: boolean) => {
    if (!enabled) return;
    if (optedOut.has(`${n.userId}:${n.type}`)) return;
    pending.push(n);
  };

  for (const participant of participants) {
    const { userId } = participant;
    if (participant.user.isDisabled) continue;

    const invested = participant.portfolio?.setupCompletedAt != null;

    // Competition start — once, on or after the first day.
    push(
      {
        userId,
        type: "COMPETITION_START",
        severity: "INFO",
        title: `${competition.name} has started`,
        body: `Trading is open. Your portfolio is valued at the close each day and the leaderboard updates with it.`,
        linkUrl: "/dashboard",
        dedupeKey: `start:${competition.id}:${userId}`,
      },
      settings.notifyCompetitionStart && daysFromStart >= 0,
    );

    // Setup deadline — for anyone still sitting in cash, once a week.
    push(
      {
        userId,
        type: "SETUP_DEADLINE",
        severity: "WARNING",
        title: "You have not built your portfolio yet",
        body: `You are holding cash and are not on the leaderboard. ${daysToEnd} day${daysToEnd === 1 ? "" : "s"} left to take part.`,
        linkUrl: "/portfolio/allocate",
        // Weekly rather than daily: a nag every morning is a nag people mute.
        dedupeKey: `setup:${competition.id}:${userId}:${Math.floor(daysFromStart / 7)}`,
      },
      settings.notifySetupDeadline && !invested && daysToEnd > 0,
    );

    const before = rankBefore.get(participant.id) ?? null;
    const after = rankNow.get(participant.id) ?? null;

    // Entered the top three — only on the transition into it.
    push(
      {
        userId,
        type: "ENTERED_TOP_THREE",
        severity: "SUCCESS",
        title: `You are now #${after} on the leaderboard`,
        body: "You have moved into the top three. See who is behind you.",
        linkUrl: "/leaderboard",
        dedupeKey: `top3:${competition.id}:${userId}:${latest?.asOfDate ?? today}`,
      },
      settings.notifyEnteredTopThree &&
        after !== null &&
        after <= 3 &&
        (before === null || before > 3),
    );

    // Overtaken — off by default, because it fires a lot and reads as nagging.
    push(
      {
        userId,
        type: "OVERTAKEN",
        severity: "INFO",
        title: `You have slipped to #${after}`,
        body: `You were #${before} yesterday.`,
        linkUrl: "/leaderboard",
        dedupeKey: `overtaken:${competition.id}:${userId}:${latest?.asOfDate ?? today}`,
      },
      settings.notifyOvertaken && before !== null && after !== null && after > before,
    );

    // Competition ending — once, inside the last week.
    push(
      {
        userId,
        type: "COMPETITION_END",
        severity: "WARNING",
        title:
          daysToEnd <= 0
            ? `${competition.name} has finished`
            : `${daysToEnd} day${daysToEnd === 1 ? "" : "s"} left`,
        body:
          daysToEnd <= 0
            ? "Final standings are on the leaderboard."
            : "Last chance to change your positions before the final ranking.",
        linkUrl: daysToEnd <= 0 ? "/leaderboard" : "/portfolio/allocate",
        dedupeKey: `end:${competition.id}:${userId}:${daysToEnd <= 0 ? "final" : "warning"}`,
      },
      settings.notifyCompetitionEnd && daysToEnd <= 7,
    );
  }

  // A report notification for everyone it was actually sent to.
  if (settings.notifyWeeklyReport) {
    const report = await db.weeklyReport.findFirst({
      where: { competitionId: competition.id, status: { in: ["SENT", "PARTIALLY_SENT"] } },
      orderBy: { sentAt: "desc" },
      include: { entries: { where: { sendStatus: "SENT" }, select: { participantId: true } } },
    });
    if (report) {
      const byId = new Map(participants.map((p) => [p.id, p.userId]));
      for (const entry of report.entries) {
        const userId = byId.get(entry.participantId);
        if (!userId) continue;
        push(
          {
            userId,
            type: "WEEKLY_REPORT",
            severity: "INFO",
            title: `Your ${report.isoWeek} report is ready`,
            body: "See how your week went and where you stand.",
            linkUrl: "/dashboard",
            dedupeKey: `report:${report.id}:${entry.participantId}`,
          },
          true,
        );
      }
    }
  }

  if (pending.length === 0) return { itemsProcessed: 0 };

  // `createMany({ skipDuplicates })` is not supported on SQLite, so the
  // duplicates are filtered here instead. The unique index on dedupeKey is
  // still the real guarantee — this query is only the fast path, and the
  // per-row insert below swallows the violation if two runs race.
  const alreadySent = await db.notification.findMany({
    where: { dedupeKey: { in: pending.map((n) => n.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const seen = new Set(alreadySent.map((n) => n.dedupeKey));
  const fresh = pending.filter((n) => !seen.has(n.dedupeKey));

  let created = 0;
  for (const n of fresh) {
    try {
      await db.notification.create({
        data: {
          userId: n.userId,
          type: n.type,
          severity: n.severity,
          title: n.title,
          body: n.body,
          linkUrl: n.linkUrl,
          dedupeKey: n.dedupeKey,
          // Read or not, a notification about a finished week stops being useful.
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        },
      });
      created++;
    } catch {
      // The unique index rejected it: another run got there first. That is the
      // constraint doing its job, not a failure.
    }
  }

  log(`${created} new notification(s) from ${pending.length} candidate(s)`);
  return { itemsProcessed: created, detail: { candidates: pending.length } };
}
