import { describe, expect, it } from "vitest";
import { rankChangeOf, rankEntries, summarise, type RankableEntry } from "./rank";

function entry(overrides: Partial<RankableEntry> & { participantId: string }): RankableEntry {
  return {
    displayName: overrides.participantId.toUpperCase(),
    totalReturnPpm: 0,
    totalValueCents: 10_000_000n,
    transactionCount: 1,
    activatedAt: new Date("2026-07-24T09:00:00Z"),
    isRanked: true,
    ...overrides,
  };
}

describe("rankEntries", () => {
  it("ranks by return, highest first", () => {
    const ranked = rankEntries([
      entry({ participantId: "c", totalReturnPpm: 12_000 }),
      entry({ participantId: "a", totalReturnPpm: 124_000 }),
      entry({ participantId: "b", totalReturnPpm: 87_000 }),
    ]);
    expect(ranked.map((e) => e.participantId)).toEqual(["a", "b", "c"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("gives an identical return a shared rank, then skips (1, 2, 2, 4)", () => {
    // Telling one of two genuinely tied participants they came third because
    // their id sorts later is indefensible.
    const ranked = rankEntries([
      entry({ participantId: "a", totalReturnPpm: 100_000 }),
      entry({ participantId: "b", totalReturnPpm: 50_000 }),
      entry({ participantId: "c", totalReturnPpm: 50_000 }),
      entry({ participantId: "d", totalReturnPpm: 10_000 }),
    ]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 2, 4]);
    // ...but display order stays strict, so a redraw never reshuffles them.
    expect(ranked.map((e) => e.displayOrder)).toEqual([1, 2, 3, 4]);
  });

  it("breaks a tie by fewer transactions, rewarding conviction over churn", () => {
    const ranked = rankEntries([
      entry({ participantId: "churner", totalReturnPpm: 50_000, transactionCount: 40 }),
      entry({ participantId: "holder", totalReturnPpm: 50_000, transactionCount: 3 }),
    ]);
    expect(ranked[0]?.participantId).toBe("holder");
    // They still share the rank — the tie-break decides the row order only.
    expect(ranked.map((e) => e.rank)).toEqual([1, 1]);
  });

  it("is stable and total: the same input always produces the same order", () => {
    const input = [
      entry({ participantId: "a", totalReturnPpm: 50_000 }),
      entry({ participantId: "b", totalReturnPpm: 50_000 }),
      entry({ participantId: "c", totalReturnPpm: 50_000 }),
    ];
    const first = rankEntries(input).map((e) => e.participantId);
    const reversed = rankEntries([...input].reverse()).map((e) => e.participantId);
    expect(first).toEqual(reversed);
  });

  it("lists participants who have not invested after everyone ranked", () => {
    // They hold 100% cash, so their return is exactly 0.00%. Ranking them
    // mid-table, ahead of everyone who is down, would reward not playing.
    const ranked = rankEntries([
      entry({ participantId: "down", totalReturnPpm: -80_000 }),
      entry({
        participantId: "idle",
        totalReturnPpm: 0,
        isRanked: false,
        unrankedReason: "NOT_INVESTED",
        activatedAt: null,
      }),
      entry({ participantId: "up", totalReturnPpm: 40_000 }),
    ]);
    expect(ranked.map((e) => e.participantId)).toEqual(["up", "down", "idle"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, null]);
  });

  it("orders unranked participants by name, not by id", () => {
    const ranked = rankEntries([
      entry({ participantId: "z1", displayName: "Anna", isRanked: false }),
      entry({ participantId: "a1", displayName: "Zoe", isRanked: false }),
    ]);
    expect(ranked.map((e) => e.displayName)).toEqual(["Anna", "Zoe"]);
  });

  it("handles an empty competition without throwing", () => {
    expect(rankEntries([])).toEqual([]);
  });
});

describe("rankChangeOf", () => {
  it("is positive when a participant climbs", () => {
    expect(rankChangeOf(7, 4)).toBe(3);
    expect(rankChangeOf(4, 7)).toBe(-3);
    expect(rankChangeOf(4, 4)).toBe(0);
  });

  it("returns null on a first appearance, which is not the same as unchanged", () => {
    // An arrow pointing nowhere and no arrow at all mean different things to
    // someone reading their first weekly report.
    expect(rankChangeOf(null, 4)).toBeNull();
    expect(rankChangeOf(4, null)).toBeNull();
  });
});

describe("summarise", () => {
  it("computes median, best and worst over ranked entries only", () => {
    const ranked = rankEntries([
      entry({ participantId: "a", totalReturnPpm: 100_000, totalValueCents: 11_000_000n }),
      entry({ participantId: "b", totalReturnPpm: 50_000, totalValueCents: 10_500_000n }),
      entry({ participantId: "c", totalReturnPpm: -30_000, totalValueCents: 9_700_000n }),
      entry({
        participantId: "idle",
        totalReturnPpm: 0,
        totalValueCents: 10_000_000n,
        isRanked: false,
      }),
    ]);
    const stats = summarise(ranked);
    expect(stats.participantCount).toBe(4);
    // The denominator for "you are 2nd of 3" is the ranked count, not everyone.
    expect(stats.rankedCount).toBe(3);
    expect(stats.medianReturnPpm).toBe(50_000);
    expect(stats.bestReturnPpm).toBe(100_000);
    expect(stats.worstReturnPpm).toBe(-30_000);
    // Capital under management counts everyone — the money exists either way.
    expect(stats.totalAumCents).toBe(41_200_000n);
  });

  it("averages an even-sized set without dropping the middle", () => {
    const ranked = rankEntries([
      entry({ participantId: "a", totalReturnPpm: 40_000 }),
      entry({ participantId: "b", totalReturnPpm: 20_000 }),
    ]);
    expect(summarise(ranked).medianReturnPpm).toBe(30_000);
  });

  it("returns zeros for an empty competition rather than NaN", () => {
    const stats = summarise([]);
    expect(stats.medianReturnPpm).toBe(0);
    expect(stats.bestReturnPpm).toBe(0);
    expect(stats.totalAumCents).toBe(0n);
  });
});
