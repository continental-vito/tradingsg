import "server-only";
import { db } from "@/server/db";
import { money, ratio, type MoneyDto, type RatioDto } from "./serialize";

export type LeaderboardScope = "overall" | "week" | "month";

export interface LeaderboardRow {
  participantId: string;
  displayName: string;
  department: string | null;
  avatarUrl: string | null;
  rank: number | null;
  displayOrder: number;
  rankChange: number | null;
  isNewEntry: boolean;
  isYou: boolean;
  isRanked: boolean;
  unrankedReason: string | null;
  value: MoneyDto;
  gainLoss: MoneyDto;
  scopeReturn: RatioDto;
  overallReturn: RatioDto;
}

export interface LeaderboardDto {
  competition: { id: string; name: string; currency: string };
  asOfDate: string | null;
  scope: LeaderboardScope;
  rankedCount: number;
  participantCount: number;
  rows: LeaderboardRow[];
  you: LeaderboardRow | null;
  /**
   * How much of the board this viewer may see. An administrator always sees all
   * of it — hiding the standings from the person running the competition would
   * be theatre.
   */
  visibility: "ALL" | "TOP_N" | "ADMIN_ONLY";
  /** Whether rows link through to a participant's holdings. */
  canOpenPortfolios: boolean;
  /** Set when the list was cut short, so the page can say so rather than imply the rest do not exist. */
  hiddenCount: number;
  /**
   * True when the caller is in the competition but not in this snapshot —
   * they joined after it was taken. Without this the leaderboard simply omits
   * them, and a new joiner cannot tell whether they are missing or broken.
   */
  youJoinedAfterSnapshot: boolean;
  stats: { median: RatioDto; best: RatioDto; worst: RatioDto; aum: MoneyDto } | null;
}

/**
 * The leaderboard, read from the last committed snapshot.
 *
 * Never recomputed on read. Two people opening the page ten seconds apart must
 * see the same standings, and the only way to guarantee that is for both to
 * read one row rather than both re-derive it from prices that keep moving.
 */
export async function loadLeaderboard(
  userId: string,
  scope: LeaderboardScope = "overall",
): Promise<LeaderboardDto | null> {
  const participant = await db.participant.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    select: {
      id: true,
      competitionId: true,
      competition: {
        include: {
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
        },
      },
      user: { select: { role: true } },
    },
  });
  if (!participant) return null;

  const competition = participant.competition;
  const settings = competition.settings[0];
  const isAdmin = participant.user.role === "ADMIN";
  const visibility = (settings?.leaderboardVisibility ?? "ALL") as "ALL" | "TOP_N" | "ADMIN_ONLY";

  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: {
      entries: {
        orderBy: { displayOrder: "asc" },
        include: {
          participant: {
            select: {
              id: true,
              displayName: true,
              user: { select: { department: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!snapshot) {
    return {
      competition: { id: competition.id, name: competition.name, currency: competition.currency },
      asOfDate: null,
      scope,
      rankedCount: 0,
      participantCount: 0,
      rows: [],
      you: null,
      youJoinedAfterSnapshot: false,
      visibility,
      canOpenPortfolios: isAdmin,
      hiddenCount: 0,
      stats: null,
    };
  }

  const currency = competition.currency;

  const rows: LeaderboardRow[] = snapshot.entries.map((e) => {
    // Week and month re-rank on the period return rather than the overall one,
    // which is what makes "this week" a different question and not just a
    // relabelled column.
    const scopeReturnPpm =
      scope === "week"
        ? (e.weeklyReturnPpm ?? 0)
        : scope === "month"
          ? (e.periodReturnPpm ?? e.totalReturnPpm)
          : e.totalReturnPpm;

    return {
      participantId: e.participantId,
      displayName: e.participant.displayName,
      department: e.participant.user.department,
      avatarUrl: e.participant.user.avatarUrl,
      rank: e.rank,
      displayOrder: e.displayOrder,
      rankChange: e.rankChange,
      isNewEntry: e.isNewEntry,
      isYou: e.participantId === participant.id,
      isRanked: e.isRanked,
      unrankedReason: e.unrankedReason,
      value: money(e.totalValueCents, currency),
      gainLoss: money(e.totalValueCents - competition.startingCapitalCents, currency),
      scopeReturn: ratio(scopeReturnPpm),
      overallReturn: ratio(e.totalReturnPpm),
    };
  });

  if (scope !== "overall") {
    // Re-rank in place for the chosen scope. Unranked entries stay at the end
    // regardless of scope — not investing is not a weekly result either.
    const ranked = rows.filter((r) => r.isRanked);
    const unranked = rows.filter((r) => !r.isRanked);
    ranked.sort((a, b) => b.scopeReturn.ppm - a.scopeReturn.ppm);
    let position = 0;
    let previous: number | null = null;
    ranked.forEach((row, index) => {
      if (previous === null || row.scopeReturn.ppm !== previous) {
        position = index + 1;
        previous = row.scopeReturn.ppm;
      }
      row.rank = position;
      row.displayOrder = index + 1;
      // A rank change against a different metric would be meaningless.
      row.rankChange = null;
    });
    unranked.forEach((row, index) => {
      row.rank = null;
      row.displayOrder = ranked.length + index + 1;
    });
    rows.length = 0;
    rows.push(...ranked, ...unranked);
  }

  // Trimmed AFTER ranking, never before: a participant's own position is
  // computed against everybody, so being shown ten rows does not change what
  // "#17 of 26" means.
  const you = rows.find((r) => r.isYou) ?? null;
  let visible = rows;
  let hiddenCount = 0;

  if (!isAdmin && visibility === "ADMIN_ONLY") {
    visible = [];
    hiddenCount = rows.length;
  } else if (!isAdmin && visibility === "TOP_N") {
    const limit = settings?.leaderboardTopN ?? 10;
    const top = rows.filter((r) => r.isRanked).slice(0, limit);
    // The viewer always sees their own row, even when it falls outside the cut.
    if (you && !top.some((r) => r.participantId === you.participantId)) top.push(you);
    hiddenCount = rows.length - top.length;
    visible = top;
  }

  return {
    competition: { id: competition.id, name: competition.name, currency },
    asOfDate: snapshot.asOfDate,
    scope,
    rankedCount: snapshot.rankedCount,
    participantCount: snapshot.participantCount,
    rows: visible,
    you,
    youJoinedAfterSnapshot: !rows.some((r) => r.isYou),
    visibility,
    canOpenPortfolios: isAdmin || (settings?.showOthersHoldings ?? false),
    hiddenCount,
    stats: {
      median: ratio(snapshot.medianReturnPpm),
      best: ratio(snapshot.bestReturnPpm),
      worst: ratio(snapshot.worstReturnPpm),
      aum: money(snapshot.totalAumCents, currency),
    },
  };
}
