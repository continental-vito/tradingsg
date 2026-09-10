import type { Cents } from "@/server/money";

/**
 * Ranking.
 *
 * Two rank concepts are produced and both are needed:
 *
 *   `rank`         competition ranking — 1, 2, 2, 4. Two participants with an
 *                  identical return genuinely share a place. Telling one of
 *                  them they came third because their id sorts later is
 *                  indefensible.
 *   `displayOrder` a strict total order for rendering and for diffing against
 *                  the previous snapshot, so a redraw never reshuffles equal
 *                  rows and a rank-change arrow never flickers.
 */

export type UnrankedReason = "NO_PORTFOLIO" | "NOT_INVESTED" | "WITHDRAWN" | "NO_VALUATION";

export interface RankableEntry {
  participantId: string;
  displayName: string;
  totalReturnPpm: number;
  totalValueCents: Cents;
  transactionCount: number;
  /** First committed rebalance. Null while the participant has never invested. */
  activatedAt: Date | null;
  isRanked: boolean;
  unrankedReason?: UnrankedReason;
}

export interface RankedEntry extends RankableEntry {
  rank: number | null;
  displayOrder: number;
  tieBreakKey: string;
}

function pad(value: number, width: number): string {
  const clamped = Math.max(0, Math.min(value, 10 ** width - 1));
  return String(clamped).padStart(width, "0");
}

/**
 * A sortable composite that reproduces the comparator below without
 * re-implementing it — in SQL, in a report, or in a spreadsheet export.
 */
export function tieBreakKeyFor(entry: RankableEntry): string {
  return [
    pad(1_000_000_000 - entry.totalReturnPpm, 12),
    pad(999_999 - Math.min(entry.transactionCount, 999_999), 6),
    pad(entry.activatedAt ? Math.floor(entry.activatedAt.getTime() / 1000) : 9_999_999_999, 10),
    entry.participantId,
  ].join(":");
}

/**
 * Orders and ranks a competition's participants.
 *
 * Tie-breaks, in order, all deterministic and none dependent on wall-clock:
 *   1. total return, descending — the competition's actual metric
 *   2. total value, descending — normally redundant, correct if starting
 *      capital ever differs per participant
 *   3. fewer transactions wins — rewards conviction over churn, and is
 *      defensible to a participant who asks why they came second
 *   4. earlier activation wins
 *   5. participant id — the final guarantee that the order is total
 *
 * A participant who has not invested holds 100% cash, so their return is
 * exactly 0.00%. Ranking them mid-table, ahead of everyone who is down, would
 * reward not playing. They are listed after every ranked entry instead, ordered
 * by name, and `rankedCount` — not `participantCount` — is the denominator in
 * "you are 4th of 27".
 */
export function rankEntries(entries: readonly RankableEntry[]): RankedEntry[] {
  const ranked = entries.filter((e) => e.isRanked);
  const unranked = entries.filter((e) => !e.isRanked);

  const sorted = [...ranked].sort((a, b) => {
    if (a.totalReturnPpm !== b.totalReturnPpm) return b.totalReturnPpm - a.totalReturnPpm;
    if (a.totalValueCents !== b.totalValueCents)
      return b.totalValueCents > a.totalValueCents ? 1 : -1;
    if (a.transactionCount !== b.transactionCount) return a.transactionCount - b.transactionCount;
    const aTime = a.activatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.activatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.participantId.localeCompare(b.participantId);
  });

  const out: RankedEntry[] = [];
  let currentRank = 0;
  let previousReturn: number | null = null;

  sorted.forEach((entry, index) => {
    // Competition ranking: equal returns share a rank, and the next distinct
    // return skips to its ordinal position (1, 2, 2, 4).
    if (previousReturn === null || entry.totalReturnPpm !== previousReturn) {
      currentRank = index + 1;
      previousReturn = entry.totalReturnPpm;
    }
    out.push({
      ...entry,
      rank: currentRank,
      displayOrder: index + 1,
      tieBreakKey: tieBreakKeyFor(entry),
    });
  });

  const unrankedSorted = [...unranked].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) || a.participantId.localeCompare(b.participantId),
  );
  unrankedSorted.forEach((entry, index) => {
    out.push({
      ...entry,
      rank: null,
      displayOrder: sorted.length + index + 1,
      tieBreakKey: tieBreakKeyFor(entry),
    });
  });

  return out;
}

/**
 * Rank movement against the previous snapshot.
 *
 * Positive means climbed. Null means there is no previous position, which must
 * not render the same as "unchanged" — an arrow pointing nowhere and no arrow
 * at all mean different things to someone reading their weekly report.
 */
export function rankChangeOf(previousRank: number | null, rank: number | null): number | null {
  if (previousRank === null || rank === null) return null;
  return previousRank - rank;
}

export interface LeaderboardStats {
  participantCount: number;
  rankedCount: number;
  totalAumCents: Cents;
  medianReturnPpm: number;
  bestReturnPpm: number;
  worstReturnPpm: number;
  averageReturnPpm: number;
}

export function summarise(entries: readonly RankedEntry[]): LeaderboardStats {
  const ranked = entries.filter((e) => e.rank !== null);
  const returns = ranked.map((e) => e.totalReturnPpm).sort((a, b) => a - b);
  // Every participant's capital counts toward assets under management, invested
  // or not — the money exists either way.
  const totalAumCents = entries.reduce((sum, e) => sum + e.totalValueCents, 0n);

  const median = (() => {
    if (returns.length === 0) return 0;
    const mid = Math.floor(returns.length / 2);
    if (returns.length % 2 === 1) return returns[mid] ?? 0;
    return Math.round(((returns[mid - 1] ?? 0) + (returns[mid] ?? 0)) / 2);
  })();

  return {
    participantCount: entries.length,
    rankedCount: ranked.length,
    totalAumCents,
    medianReturnPpm: median,
    bestReturnPpm: returns[returns.length - 1] ?? 0,
    worstReturnPpm: returns[0] ?? 0,
    averageReturnPpm:
      returns.length === 0 ? 0 : Math.round(returns.reduce((a, b) => a + b, 0) / returns.length),
  };
}
