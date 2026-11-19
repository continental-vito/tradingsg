import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { eachTradingDay } from "@/lib/dates";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { snapshotLeaderboard } from "@/server/jobs/leaderboard";
import { snapshotValuations } from "@/server/jobs/valuations";
import { applySurveyAdjustment } from "@/server/survey/adjust";
import { applyAdjustment } from "./adjust";
import { commitRebalance } from "./commit";

/**
 * Are the returns right, day after day?
 *
 * Several weeks of the real nightly process — trades, a bonus, an admin
 * adjustment and a night the job did not run — and then every stored valuation
 * is recomputed FROM SCRATCH, from nothing but the transaction ledger and the
 * closing prices, with none of the valuation code. If the stored number and
 * the independent one ever differ, a return on the leaderboard is wrong.
 */

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
const ids: Record<string, string> = {};
type Seeded = Awaited<ReturnType<typeof seedParticipant>>;
const people: Record<string, Seeded> = {};

const DAYS = eachTradingDay("2026-07-24", "2026-08-21"); // 21 trading days
const MISSED = DAYS[13] ?? ""; // the night the job did not run

/** Deterministic closes that wander up and down, in cents. */
function closeOf(symbol: string, i: number): bigint {
  const base = symbol === "AAA" ? 10_000 : 25_000;
  const drift = symbol === "AAA" ? 0.004 : -0.002;
  return BigInt(
    Math.round(base * (1 + drift * i + 0.03 * Math.sin(i * (symbol === "AAA" ? 1.3 : 0.7)))),
  );
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competitionSettings.create({
    data: {
      competitionId,
      revision: 1,
      tradingMode: "ANYTIME",
      feeModel: "PERCENT",
      feeBps: 50,
      maxPositionPpm: 1_000_000,
    },
  });
  for (const symbol of ["AAA", "BBB"]) {
    const stock = await db.stock.create({ data: { symbol, name: symbol } });
    ids[symbol] = stock.id;
    await db.competitionStock.create({ data: { competitionId, stockId: stock.id } });
    await db.priceHistory.createMany({
      data: DAYS.map((tradeDate, i) => ({
        stockId: stock.id,
        tradeDate,
        closeCents: closeOf(symbol, i),
      })),
    });
  }
  for (const name of ["alice", "bob", "carol", "dave"]) {
    people[name] = await seedParticipant(db, competitionId, `${name}@example.com`);
  }
  // Dave's starting capital carries a later date than the first valuation, as
  // it does when a launch is brought forward from the planned start date.
  await db.transaction.updateMany({
    where: { portfolioId: people.dave?.portfolio.id ?? "", type: "INITIAL_FUNDING" },
    data: { tradeDate: "2026-08-20" },
  });
  const question = await db.surveyQuestion.create({ data: { prompt: "Bullish?" } });
  await db.surveyAnswer.create({
    data: { questionId: question.id, userId: people.bob?.user.id ?? "", answer: true },
  });

  const A = ids.AAA ?? "";
  const B = ids.BBB ?? "";
  const trade = async (
    who: string,
    day: string,
    targets: { stockId: string; weightPpm: number }[],
  ) => {
    const result = await commitRebalance(db, {
      portfolioId: people[who]?.portfolio.id ?? "",
      targets,
      idempotencyKey: `${who}-${day}`,
      periodKey: null,
      asOfDate: day,
      executedAt: new Date(`${day}T17:00:00Z`),
    });
    expect(result.ok).toBe(true);
  };

  // The nightly process, day by day, the way production runs it: the day's
  // trades at the close, then the valuation.
  for (const [i, day] of DAYS.entries()) {
    if (i === 0) {
      await trade("alice", day, [
        { stockId: A, weightPpm: 600_000 },
        { stockId: B, weightPpm: 400_000 },
      ]);
      await trade("bob", day, [{ stockId: A, weightPpm: 500_000 }]);
      await trade("carol", day, [{ stockId: A, weightPpm: 1_000_000 }]);
      await trade("dave", day, [{ stockId: B, weightPpm: 800_000 }]);
    }
    if (i === 7) await trade("alice", day, [{ stockId: B, weightPpm: 1_000_000 }]);
    if (i === 10) {
      const bonus = await applySurveyAdjustment(db, {
        competitionId,
        questionId: question.id,
        answer: true,
        ratePpm: 20_000,
        base: "STARTING_CAPITAL",
        asOfDate: day,
        idempotencyKey: "bonus",
      });
      expect(bonus.ok).toBe(true);
    }
    if (i === 12) {
      const credit = await applyAdjustment(db, {
        portfolioId: people.carol?.portfolio.id ?? "",
        amountCents: 500_000n,
        reason: "Correction",
        tradeDate: day,
      });
      expect(credit.ok).toBe(true);
    }
    // Day 13: the job did not run. Day 14: Alice trades, then the job catches
    // up — the missed day first, then today, exactly as the registry does.
    if (i === 14) await trade("alice", day, [{ stockId: A, weightPpm: 700_000 }]);
    if (day === MISSED) continue;
    const ctx = { db, runKey: "test", log: () => {} };
    if (i === 14) await snapshotValuations(ctx, { competitionId, asOfDate: MISSED });
    await snapshotValuations(ctx, { competitionId, asOfDate: day });
  }
  await snapshotLeaderboard(
    { db, runKey: "test", log: () => {} },
    { competitionId, asOfDate: DAYS[DAYS.length - 1] ?? "", kind: "DAILY" },
  );
}, 120_000);

afterAll(async () => {
  await cleanup();
});

/** Half away from zero, as the app reports ratios. */
function ppm(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n * 1_000_000n + d) / (2n * d);
  return Number(negative ? -q : q);
}

/** A portfolio's value on a date, from the ledger and the closes alone. */
async function independentValue(portfolioId: string, day: string) {
  const txs = await db.transaction.findMany({
    where: { portfolioId, OR: [{ tradeDate: { lte: day } }, { type: "INITIAL_FUNDING" }] },
  });
  const shares = new Map<string, bigint>();
  let cash = 0n;
  let netFlow = 0n;
  for (const t of txs) {
    cash += t.cashDeltaCents;
    if (t.isExternalFlow && t.type !== "INITIAL_FUNDING") netFlow += t.cashDeltaCents;
    if (t.stockId) shares.set(t.stockId, (shares.get(t.stockId) ?? 0n) + t.microShareDelta);
  }
  let value = cash;
  for (const [stockId, micro] of shares) {
    if (micro === 0n) continue;
    const close = await db.priceHistory.findFirstOrThrow({
      where: { stockId, tradeDate: { lte: day } },
      orderBy: { tradeDate: "desc" },
    });
    // Floor, as market value always is.
    value += (micro * close.closeCents) / 1_000_000n;
  }
  return { value, netFlow };
}

describe("returns, recomputed independently from the ledger and the closes", () => {
  it("values every portfolio correctly on every day, including a night the job missed", async () => {
    for (const name of ["alice", "bob", "carol", "dave"]) {
      const portfolioId = people[name]?.portfolio.id ?? "";
      const valuations = await db.portfolioValuation.findMany({
        where: { portfolioId, kind: "EOD" },
        orderBy: { asOfDate: "asc" },
      });
      expect(valuations.map((v) => v.asOfDate)).toEqual(DAYS);
      for (const v of valuations) {
        const { value, netFlow } = await independentValue(portfolioId, v.asOfDate);
        expect({ who: name, day: v.asOfDate, value: v.totalValueCents }).toEqual({
          who: name,
          day: v.asOfDate,
          value,
        });
        // Total return: value against the starting capital (plus any capital
        // added since) — the whole period at once, never a sum of daily moves.
        expect(v.totalReturnPpm).toBe(ppm(value - 10_000_000n - netFlow, 10_000_000n + netFlow));
      }
    }
  });

  it("compounds day after day: the daily returns multiply up to the total", async () => {
    for (const name of ["alice", "bob", "carol", "dave"]) {
      const valuations = await db.portfolioValuation.findMany({
        where: { portfolioId: people[name]?.portfolio.id ?? "", kind: "EOD" },
        orderBy: { asOfDate: "asc" },
      });
      // Day one is measured from the starting capital.
      const first = valuations[0];
      let growth = Number(first?.totalValueCents ?? 0n) / 10_000_000;
      for (const v of valuations.slice(1)) growth *= 1 + (v.dailyReturnPpm ?? 0) / 1_000_000;
      const last = valuations.at(-1);
      // Each daily figure is rounded to 1 ppm, so twenty of them can drift by
      // a few ppm (a few hundredths of a basis point) — never more.
      expect(Math.abs((growth - 1) * 1_000_000 - (last?.twrPpm ?? 0))).toBeLessThan(25);
    }
  });

  it("ranks on the time-weighted return, which equals the simple return without capital flows", async () => {
    for (const name of ["alice", "bob"]) {
      const last = await db.portfolioValuation.findFirstOrThrow({
        where: { portfolioId: people[name]?.portfolio.id ?? "", kind: "EOD" },
        orderBy: { asOfDate: "desc" },
      });
      expect(last.twrPpm).toBe(last.totalReturnPpm);
    }
    const snapshot = await db.leaderboardSnapshot.findFirstOrThrow({
      where: { competitionId, kind: "DAILY" },
      include: { entries: { include: { valuation: true } } },
    });
    for (const entry of snapshot.entries) {
      expect(entry.totalReturnPpm).toBe(entry.valuation?.twrPpm);
    }
  });

  it("counts the bonus as performance, and keeps an admin's capital credit out of the return", async () => {
    // Bob's +2% bonus is in his return; Carol's €5,000 credit is not.
    const carol = await db.portfolioValuation.findMany({
      where: { portfolioId: people.carol?.portfolio.id ?? "", kind: "EOD" },
      orderBy: { asOfDate: "asc" },
    });
    const creditDay = carol[12];
    const before = carol[11];
    expect(creditDay?.flowInPeriodCents).toBe(500_000n);
    // The day's return excludes the €5,000: it is the market move alone.
    const marketOnly = ppm(
      (creditDay?.totalValueCents ?? 0n) - (before?.totalValueCents ?? 0n) - 500_000n,
      (before?.totalValueCents ?? 0n) + 500_000n,
    );
    expect(creditDay?.dailyReturnPpm).toBe(marketOnly);

    // Nor in the week's return: the weekly figure is the market alone too.
    const weekAfter = carol[15];
    const weekBefore = await db.portfolioValuation.findFirstOrThrow({
      where: {
        portfolioId: people.carol?.portfolio.id ?? "",
        kind: "EOD",
        asOfDate: { lte: "2026-08-07" },
      },
      orderBy: { asOfDate: "desc" },
    });
    expect(weekAfter?.asOfDate).toBe("2026-08-14");
    expect(weekAfter?.weeklyReturnPpm).toBe(
      ppm(
        (weekAfter?.totalValueCents ?? 0n) - weekBefore.totalValueCents - 500_000n,
        weekBefore.totalValueCents + 500_000n,
      ),
    );

    const bob = await db.portfolioValuation.findMany({
      where: { portfolioId: people.bob?.portfolio.id ?? "", kind: "EOD" },
      orderBy: { asOfDate: "asc" },
    });
    const bonusDay = bob[10];
    expect(bonusDay?.flowInPeriodCents).toBe(0n);
    expect((bonusDay?.totalValueCents ?? 0n) - (bob[9]?.totalValueCents ?? 0n)).toBeGreaterThan(
      150_000n,
    );
  });
});
