import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { HOUSE_RULES } from "@/server/competition/house-rules";
import { snapshotValuations } from "@/server/jobs/valuations";
import { commitRebalance } from "@/server/portfolio/commit";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { applySurveyAdjustment, planSurveyAdjustment } from "./adjust";
import { pendingQuestions, questionStats, recordAnswers } from "./questions";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let questionId: string;
type Seeded = Awaited<ReturnType<typeof seedParticipant>>;
let alice: Seeded; // answers yes, all cash
let bob: Seeded; // answers no
let carol: Seeded; // answers yes, fully invested
let dave: Seeded; // answers yes, then withdraws

const DAY = "2026-08-05";

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, ...HOUSE_RULES, maxPositionPpm: 1_000_000 },
  });
  const stock = await db.stock.create({ data: { symbol: "MC", name: "LVMH" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: "2026-07-24", closeCents: 50_000n },
      { stockId, tradeDate: DAY, closeCents: 50_000n },
    ],
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
  carol = await seedParticipant(db, competitionId, "carol@example.com");
  dave = await seedParticipant(db, competitionId, "dave@example.com");

  const question = await db.surveyQuestion.create({
    data: {
      prompt: "Will the CAC 40 finish the competition higher?",
      yesLabel: "Higher",
      noLabel: "Lower",
    },
  });
  questionId = question.id;

  // Carol puts everything into LVMH, leaving almost no cash.
  const bought = await commitRebalance(db, {
    portfolioId: carol.portfolio.id,
    targets: [{ stockId, weightPpm: 1_000_000 }],
    idempotencyKey: "carol-all-in",
    periodKey: null,
    asOfDate: "2026-07-24",
  });
  expect(bought.ok).toBe(true);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("login questions", () => {
  it("asks an active question until it is answered, then never again", async () => {
    expect((await pendingQuestions(db, alice.user.id)).map((q) => q.id)).toEqual([questionId]);
    expect(await recordAnswers(db, alice.user.id, [{ questionId, answer: true }])).toEqual({
      ok: true,
      recorded: 1,
    });
    expect(await pendingQuestions(db, alice.user.id)).toEqual([]);
  });

  it("keeps an answer final unless the question is opened for change", async () => {
    const refused = await recordAnswers(db, alice.user.id, [{ questionId, answer: false }]);
    expect(refused.ok).toBe(false);
    const stored = await db.surveyAnswer.findFirstOrThrow({ where: { userId: alice.user.id } });
    expect(stored.answer).toBe(true);

    await db.surveyQuestion.update({ where: { id: questionId }, data: { allowChange: true } });
    expect((await recordAnswers(db, alice.user.id, [{ questionId, answer: false }])).ok).toBe(true);
    expect((await recordAnswers(db, alice.user.id, [{ questionId, answer: true }])).ok).toBe(true);
    const changed = await db.surveyAnswer.findFirstOrThrow({ where: { userId: alice.user.id } });
    expect(changed.answer).toBe(true);
    expect(changed.changeCount).toBe(2);
    await db.surveyQuestion.update({ where: { id: questionId }, data: { allowChange: false } });
  });

  it("neither asks nor accepts an inactive question", async () => {
    const closed = await db.surveyQuestion.create({ data: { prompt: "Closed?", isActive: false } });
    expect((await pendingQuestions(db, bob.user.id)).map((q) => q.id)).not.toContain(closed.id);
    expect(
      (await recordAnswers(db, bob.user.id, [{ questionId: closed.id, answer: true }])).ok,
    ).toBe(false);
  });

  it("counts the answers per group", async () => {
    await recordAnswers(db, bob.user.id, [{ questionId, answer: false }]);
    await recordAnswers(db, carol.user.id, [{ questionId, answer: true }]);
    await recordAnswers(db, dave.user.id, [{ questionId, answer: true }]);
    const stats = (await questionStats(db, competitionId)).find((s) => s.id === questionId);
    expect(stats).toMatchObject({ yes: 3, no: 1, unanswered: 0 });
  });
});

describe("a bonus or malus by answer", () => {
  it("gives a bonus only to those who gave the answer, and not to anyone withdrawn", async () => {
    await db.participant.update({
      where: { id: dave.participant.id },
      data: { status: "WITHDRAWN" },
    });
    const plan = await planSurveyAdjustment(db, {
      competitionId,
      questionId,
      answer: true,
      ratePpm: 20_000,
      base: "STARTING_CAPITAL",
      asOfDate: DAY,
    });
    expect(plan.map((p) => p.participantId).sort()).toEqual(
      [alice.participant.id, carol.participant.id].sort(),
    );
  });

  it("moves the return by exactly the bonus, counted as performance", async () => {
    const result = await applySurveyAdjustment(db, {
      competitionId,
      questionId,
      answer: true,
      ratePpm: 20_000, // +2% of the starting capital
      base: "STARTING_CAPITAL",
      asOfDate: DAY,
      idempotencyKey: "bonus-1",
    });
    expect(result).toMatchObject({ ok: true, participantCount: 2, replayed: false });

    const a = await db.portfolio.findUniqueOrThrow({ where: { id: alice.portfolio.id } });
    expect(a.cashCents).toBe(10_200_000n);
    expect(a.netFlowCents).toBe(0n); // not a flow, so the return counts it
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
    const b = await db.portfolio.findUniqueOrThrow({ where: { id: bob.portfolio.id } });
    expect(b.cashCents).toBe(10_000_000n);

    await snapshotValuations(
      { db, runKey: "test", log: () => {} },
      { competitionId, asOfDate: DAY },
    );
    const valuation = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: DAY },
    });
    expect(valuation.totalReturnPpm).toBe(20_000);
  });

  it("applies once, however many times the same request arrives", async () => {
    const again = await applySurveyAdjustment(db, {
      competitionId,
      questionId,
      answer: true,
      ratePpm: 20_000,
      base: "STARTING_CAPITAL",
      asOfDate: DAY,
      idempotencyKey: "bonus-1",
    });
    expect(again).toMatchObject({ ok: true, replayed: true });
    const a = await db.portfolio.findUniqueOrThrow({ where: { id: alice.portfolio.id } });
    expect(a.cashCents).toBe(10_200_000n);
  });

  it("covers a malus bigger than the cash by selling, without a fee, and the ledger reconciles", async () => {
    const before = await db.portfolio.findUniqueOrThrow({
      where: { id: carol.portfolio.id },
      include: { holdings: true },
    });
    const sharesBefore = before.holdings[0]?.microShares ?? 0n;
    const valueBefore = before.cashCents + (sharesBefore * 50_000n) / 1_000_000n;

    const result = await applySurveyAdjustment(db, {
      competitionId,
      questionId,
      answer: true,
      ratePpm: -50_000, // −5% of the starting capital: €5,000, more than Carol's cash
      base: "STARTING_CAPITAL",
      asOfDate: DAY,
      idempotencyKey: "malus-1",
    });
    expect(result.ok).toBe(true);

    const after = await db.portfolio.findUniqueOrThrow({
      where: { id: carol.portfolio.id },
      include: { holdings: true, transactions: { orderBy: { sequence: "asc" } } },
    });
    expect(after.cashCents).toBeGreaterThanOrEqual(0n);
    expect(after.holdings[0]?.microShares).toBeLessThan(sharesBefore);
    const forced = after.transactions.filter(
      (t) => t.type === "LIQUIDATION_SELL" && t.tradeDate === DAY,
    );
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.every((t) => t.feeCents === 0n)).toBe(true);
    expect(after.transactions.at(-1)?.type).toBe("MALUS");
    expect(after.transactions.at(-1)?.cashDeltaCents).toBe(-500_000n);

    // The portfolio is worth €5,000 less, give or take the cent the forced
    // sale's rounding may cost — and never a cent more.
    const valueAfter =
      after.cashCents + ((after.holdings[0]?.microShares ?? 0n) * 50_000n) / 1_000_000n;
    expect(valueBefore - valueAfter).toBeGreaterThanOrEqual(500_000n);
    expect(valueBefore - valueAfter).toBeLessThanOrEqual(500_002n);
    expect(await checkPortfolioInvariants(db, carol.portfolio.id)).toEqual([]);
  });

  it("can take a percentage of the current value instead of the starting capital", async () => {
    const plan = await planSurveyAdjustment(db, {
      competitionId,
      questionId,
      answer: false,
      ratePpm: 10_000,
      base: "CURRENT_VALUE",
      asOfDate: DAY,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.baseCents).toBe(10_000_000n);
    expect(plan[0]?.amountCents).toBe(100_000n);
  });
});
