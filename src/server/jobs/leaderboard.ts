import { dateKeyToUtc, isoWeekOf, type DateKey } from "@/lib/dates";
import {
  rankChangeOf,
  rankEntries,
  summarise,
  type RankableEntry,
} from "@/server/leaderboard/rank";
import type { JobContext, JobResult } from "./run";

/**
 * The leaderboard snapshot.
 *
 * Reads the stored EOD valuations rather than recomputing anything, so the
 * leaderboard cannot disagree with the dashboard it sits next to.
 *
 * `previousSnapshotId` is resolved by looking up the most recent snapshot of
 * the same kind with an earlier date — not by assuming "yesterday". A missed
 * day then produces a correct rank-change arrow on the next one instead of a
 * broken chain.
 *
 * Idempotent on (competitionId, asOfDate, kind): the entry set is deleted and
 * rebuilt, so re-running for the same date changes nothing.
 */
export async function snapshotLeaderboard(
  ctx: JobContext,
  args: { competitionId: string; asOfDate: DateKey; kind: "DAILY" | "WEEKLY" | "FINAL" },
): Promise<JobResult> {
  const { db, log } = ctx;
  const { competitionId, asOfDate, kind } = args;

  const participants = await db.participant.findMany({
    where: { competitionId, deletedAt: null, status: { not: "DISQUALIFIED" } },
    include: {
      portfolio: { select: { id: true, setupCompletedAt: true } },
      _count: { select: { transactions: true } },
    },
  });

  if (participants.length === 0) {
    log("No participants to rank.");
    return { itemsProcessed: 0 };
  }

  const valuations = await db.portfolioValuation.findMany({
    where: { competitionId, kind: "EOD", asOfDate: { lte: asOfDate } },
    orderBy: { asOfDate: "desc" },
  });
  // The newest valuation at or before the date, per portfolio.
  const latestByPortfolio = new Map<string, (typeof valuations)[number]>();
  for (const v of valuations) {
    if (!latestByPortfolio.has(v.portfolioId)) latestByPortfolio.set(v.portfolioId, v);
  }

  const previousSnapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId, kind, asOfDate: { lt: asOfDate } },
    orderBy: { asOfDate: "desc" },
    include: { entries: { select: { participantId: true, rank: true, totalValueCents: true } } },
  });
  const previousByParticipant = new Map(
    (previousSnapshot?.entries ?? []).map((e) => [e.participantId, e]),
  );

  const rankable: RankableEntry[] = participants.map((p) => {
    const valuation = p.portfolio ? latestByPortfolio.get(p.portfolio.id) : undefined;
    const withdrawn = p.status === "WITHDRAWN";
    const isRanked = Boolean(valuation?.isRankEligible) && !withdrawn;

    return {
      participantId: p.id,
      displayName: p.displayName,
      totalReturnPpm: valuation?.twrPpm ?? 0,
      totalValueCents: valuation?.totalValueCents ?? p.initialCapitalCents,
      transactionCount: p._count.transactions,
      activatedAt: p.activatedAt,
      isRanked,
      unrankedReason: isRanked
        ? undefined
        : withdrawn
          ? "WITHDRAWN"
          : !p.portfolio
            ? "NO_PORTFOLIO"
            : !valuation
              ? "NO_VALUATION"
              : "NOT_INVESTED",
    };
  });

  const ranked = rankEntries(rankable);
  const stats = summarise(ranked);

  await db.$transaction(async (tx) => {
    const existing = await tx.leaderboardSnapshot.findUnique({
      where: { competitionId_asOfDate_kind: { competitionId, asOfDate, kind } },
      select: { id: true },
    });
    if (existing) {
      await tx.leaderboardSnapshotEntry.deleteMany({ where: { snapshotId: existing.id } });
      await tx.leaderboardSnapshot.delete({ where: { id: existing.id } });
    }

    const snapshot = await tx.leaderboardSnapshot.create({
      data: {
        competitionId,
        asOfDate,
        asOfAt: dateKeyToUtc(asOfDate),
        kind,
        weekNumber: Number(isoWeekOf(asOfDate).slice(-2)),
        participantCount: stats.participantCount,
        rankedCount: stats.rankedCount,
        totalAumCents: stats.totalAumCents,
        medianReturnPpm: stats.medianReturnPpm,
        bestReturnPpm: stats.bestReturnPpm,
        worstReturnPpm: stats.worstReturnPpm,
        previousSnapshotId: previousSnapshot?.id ?? null,
      },
    });

    for (const entry of ranked) {
      const participant = participants.find((p) => p.id === entry.participantId);
      const valuation = participant?.portfolio
        ? latestByPortfolio.get(participant.portfolio.id)
        : undefined;
      const previous = previousByParticipant.get(entry.participantId);

      await tx.leaderboardSnapshotEntry.create({
        data: {
          snapshotId: snapshot.id,
          participantId: entry.participantId,
          valuationId: valuation?.id ?? null,
          isRanked: entry.isRanked,
          unrankedReason: entry.unrankedReason ?? null,
          rank: entry.rank,
          displayOrder: entry.displayOrder,
          previousRank: previous?.rank ?? null,
          rankChange: rankChangeOf(previous?.rank ?? null, entry.rank),
          // A first appearance is not "unchanged" — the report says "welcome to
          // the leaderboard" rather than showing a nonsense movement of zero.
          isNewEntry: previousSnapshot !== null && previous === undefined && entry.rank !== null,
          tieBreakKey: entry.tieBreakKey,
          totalValueCents: entry.totalValueCents,
          totalReturnPpm: entry.totalReturnPpm,
          periodReturnPpm: previous
            ? Number(
                ((entry.totalValueCents - previous.totalValueCents) * 1_000_000n) /
                  (previous.totalValueCents === 0n ? 1n : previous.totalValueCents),
              )
            : null,
          dailyReturnPpm: valuation?.dailyReturnPpm ?? null,
          weeklyReturnPpm: valuation?.weeklyReturnPpm ?? null,
          positionCount: valuation?.positionCount ?? 0,
          transactionCount: entry.transactionCount,
        },
      });
    }
  });

  log(
    `${kind} snapshot at ${asOfDate}: ${stats.rankedCount} ranked of ${stats.participantCount}, ` +
      `best ${(stats.bestReturnPpm / 10_000).toFixed(2)}%, median ${(stats.medianReturnPpm / 10_000).toFixed(2)}%`,
  );
  return {
    itemsProcessed: ranked.length,
    detail: { asOfDate, kind, ...stats, totalAumCents: String(stats.totalAumCents) },
  };
}
