import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition } from "@/test/db";
import { HOUSE_RULES } from "@/server/competition/house-rules";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import type { AdvisorInput, AdvisorProposal, AllocationAdvisor } from "./advisor";
import { createAiInvestor } from "./create";
import { proposalToTargets, runAiInvestor } from "./investor";

/**
 * A scripted advisor. The point of these tests is that whatever the model
 * proposes, the AI investor can only trade what the rules allow — so the model
 * itself is replaced by a list of answers, and CI never calls a real one.
 */
class ScriptedAdvisor implements AllocationAdvisor {
  readonly name = "scripted";
  readonly calls: AdvisorInput[] = [];
  constructor(private readonly answers: AdvisorProposal["allocations"][]) {}
  async propose(input: AdvisorInput): Promise<AdvisorProposal> {
    this.calls.push(input);
    const allocations = this.answers.shift();
    if (!allocations) throw new Error("ScriptedAdvisor ran out of answers");
    return {
      allocations,
      rationale: "Scripted.",
      model: "test-model",
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let aiInvestorId: string;

const WEDNESDAY = new Date("2026-08-05T05:00:00Z");
const THURSDAY = new Date("2026-08-06T05:00:00Z");
const NEXT_MONDAY = new Date("2026-08-10T05:00:00Z");

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  // The house rules plus a 30% cap, which the scripted model will try to break.
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, ...HOUSE_RULES, maxPositionPpm: 300_000 },
  });
  for (const [symbol, price] of [
    ["MC", 60_000n],
    ["TTE", 5_500n],
    ["BTC", 9_000_000n],
  ] as const) {
    const stock = await db.stock.create({ data: { symbol, name: symbol } });
    await db.competitionStock.create({ data: { competitionId, stockId: stock.id } });
    await db.priceHistory.createMany({
      data: [
        { stockId: stock.id, tradeDate: "2026-08-04", closeCents: price },
        { stockId: stock.id, tradeDate: "2026-08-07", closeCents: price },
      ],
    });
  }

  const created = await createAiInvestor(db, {
    name: "Claude",
    strategy: "Diversify across the universe.",
    model: "test-model",
    competitionId,
  });
  if (!created.ok) throw new Error(created.error);
  aiInvestorId = created.aiInvestorId;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

async function aiPortfolio() {
  const investor = await db.aiInvestor.findUniqueOrThrow({
    where: { id: aiInvestorId },
    include: { user: { include: { participants: { include: { portfolio: true } } } } },
  });
  const participant = investor.user.participants[0];
  if (!participant?.portfolio) throw new Error("AI investor has no portfolio");
  return { participant, portfolio: participant.portfolio, user: investor.user };
}

describe("the AI investor", () => {
  it("is an ordinary, funded participant labelled as an AI", async () => {
    const { participant, portfolio, user } = await aiPortfolio();
    expect(participant.displayName).toBe("Claude (AI)");
    expect(user.role).toBe("PARTICIPANT");
    expect(user.email).toMatch(/\.invalid$/);
    expect(portfolio.cashCents).toBe(10_000_000n);
  });

  it("trades its proposal through the same planner, paying the same 1% fee", async () => {
    const advisor = new ScriptedAdvisor([
      [
        { symbol: "MC", weightPercent: 30 },
        { symbol: "TTE", weightPercent: 30 },
        { symbol: "BTC", weightPercent: 20 },
      ],
    ]);
    const outcome = await runAiInvestor(db, advisor, {
      aiInvestorId,
      triggeredBy: "SCHEDULE",
      now: WEDNESDAY,
    });
    expect(outcome.status).toBe("TRADED");

    // What the model was told matches the rules it is held to.
    expect(advisor.calls[0]?.rules.feeBps).toBe(100);
    expect(advisor.calls[0]?.rules.maxPositionPpm).toBe(300_000);

    const { portfolio } = await aiPortfolio();
    const buys = await db.transaction.findMany({
      where: { portfolioId: portfolio.id, type: "BUY" },
    });
    expect(buys).toHaveLength(3);
    // 1% of each order, rounded up to the cent — exactly what a person pays.
    for (const buy of buys) expect(buy.feeCents).toBe((buy.grossCents + 99n) / 100n);
    expect(portfolio.totalFeesCents).toBe(buys.reduce((sum, b) => sum + b.feeCents, 0n));
    expect(await checkPortfolioInvariants(db, portfolio.id)).toEqual([]);
  });

  it("does not ask the model again once the week's token is spent", async () => {
    const advisor = new ScriptedAdvisor([]);
    const scheduled = await runAiInvestor(db, advisor, {
      aiInvestorId,
      triggeredBy: "SCHEDULE",
      now: THURSDAY,
    });
    expect(scheduled.status).toBe("SKIPPED");
    expect(scheduled.runId).toBeNull();

    // An administrator pressing "Run now" is held to the same token.
    const manual = await runAiInvestor(db, advisor, {
      aiInvestorId,
      triggeredBy: "ADMIN",
      now: THURSDAY,
    });
    expect(manual.status).toBe("SKIPPED");
    expect(manual.summary).toContain("weekly rebalance token");
    expect(advisor.calls).toHaveLength(0);
  });

  it("sends a rule-breaking proposal back with the reason, and trades the corrected one", async () => {
    const advisor = new ScriptedAdvisor([
      [{ symbol: "BTC", weightPercent: 60 }],
      [
        { symbol: "BTC", weightPercent: 30 },
        { symbol: "MC", weightPercent: 30 },
      ],
    ]);
    const outcome = await runAiInvestor(db, advisor, {
      aiInvestorId,
      triggeredBy: "SCHEDULE",
      now: NEXT_MONDAY,
    });
    expect(outcome.status).toBe("TRADED");
    expect(advisor.calls).toHaveLength(2);
    expect(advisor.calls[1]?.previousErrors?.join(" ")).toMatch(/BTC/);

    const { portfolio } = await aiPortfolio();
    expect(await checkPortfolioInvariants(db, portfolio.id)).toEqual([]);
  });

  it("records a failure, and trades nothing, when no model is configured", async () => {
    const outcome = await runAiInvestor(db, null, {
      aiInvestorId,
      triggeredBy: "ADMIN",
      now: new Date("2026-08-17T05:00:00Z"),
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.summary).toContain("ANTHROPIC_API_KEY");
  });
});

describe("proposalToTargets", () => {
  const ids = new Map([
    ["MC", "id-mc"],
    ["TTE", "id-tte"],
  ]);

  it("reports unknown tickers and negative weights instead of guessing", () => {
    const { targets, problems } = proposalToTargets(
      {
        allocations: [
          { symbol: "AAPL", weightPercent: 10 },
          { symbol: "MC", weightPercent: -5 },
          { symbol: "tte", weightPercent: 25 },
        ],
      },
      ids,
    );
    expect(targets).toEqual([{ stockId: "id-tte", weightPpm: 250_000 }]);
    expect(problems).toHaveLength(2);
  });

  it("scales a total a hair over 100% down rather than losing the week", () => {
    const { targets } = proposalToTargets(
      {
        allocations: [
          { symbol: "MC", weightPercent: 50.3 },
          { symbol: "TTE", weightPercent: 50.3 },
        ],
      },
      ids,
    );
    expect(targets.reduce((sum, t) => sum + t.weightPpm, 0)).toBeLessThanOrEqual(1_000_000);
  });
});
