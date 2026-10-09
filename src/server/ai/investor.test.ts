import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { HOUSE_RULES } from "@/server/competition/house-rules";
import { loadTradingAccess } from "@/server/portfolio/access";
import { commitRebalance } from "@/server/portfolio/commit";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { createAiInvestor, findAiPortfolio } from "./investor";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let aiPortfolioId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

const WEDNESDAY = new Date("2026-08-05T10:00:00Z");

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, ...HOUSE_RULES, maxPositionPpm: 300_000 },
  });
  const stock = await db.stock.create({ data: { symbol: "MC", name: "LVMH" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.create({ data: { stockId, tradeDate: "2026-08-04", closeCents: 60_000n } });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  // Registration closed: an administrator adds the AI regardless.
  await db.competition.update({ where: { id: competitionId }, data: { registrationOpen: false } });

  const created = await createAiInvestor(db, {
    name: "Claude",
    strategy: "Concentrated in French luxury.",
    competitionId,
  });
  if (!created.ok) throw new Error(created.error);
  const investor = await db.aiInvestor.findUniqueOrThrow({
    where: { id: created.aiInvestorId },
    include: { user: { include: { participants: { include: { portfolio: true } } } } },
  });
  const portfolio = investor.user.participants[0]?.portfolio;
  if (!portfolio) throw new Error("AI investor has no portfolio");
  aiPortfolioId = portfolio.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("the AI investor", () => {
  it("is an ordinary, funded participant labelled as an AI, which nobody can sign in as", async () => {
    const investor = await db.aiInvestor.findFirstOrThrow({
      include: { user: { include: { participants: { include: { portfolio: true } } } } },
    });
    const participant = investor.user.participants[0];
    expect(participant?.displayName).toBe("Claude (AI)");
    expect(investor.user.role).toBe("PARTICIPANT");
    expect(investor.user.email).toMatch(/\.invalid$/);
    expect(investor.strategy).toBe("Concentrated in French luxury.");
    expect(participant?.portfolio?.cashCents).toBe(10_000_000n);
  });

  it("lets the admin page reach the AI's portfolio and no one else's", async () => {
    // The admin page trades through this check. A colleague's portfolio must
    // look exactly like one that does not exist.
    expect(await findAiPortfolio(db, aiPortfolioId)).toEqual({ id: aiPortfolioId });
    expect(await findAiPortfolio(db, alice.portfolio.id)).toBeNull();
    expect(await findAiPortfolio(db, "no-such-portfolio")).toBeNull();
  });

  it("is held to the same weekly token and 1% fee as a person", async () => {
    const before = await loadTradingAccess(db, aiPortfolioId, WEDNESDAY);
    expect(before?.tokens?.remaining).toBe(1);

    const result = await commitRebalance(db, {
      portfolioId: aiPortfolioId,
      targets: [{ stockId, weightPpm: 300_000 }],
      idempotencyKey: "ai-week-32",
      periodKey: before?.decision.periodKey ?? null,
      asOfDate: "2026-08-05",
      executedAt: WEDNESDAY,
    });
    expect(result.ok).toBe(true);

    const buy = await db.transaction.findFirstOrThrow({
      where: { portfolioId: aiPortfolioId, type: "BUY" },
    });
    expect(buy.feeCents).toBe((buy.grossCents + 99n) / 100n);
    expect(await checkPortfolioInvariants(db, aiPortfolioId)).toEqual([]);

    const after = await loadTradingAccess(db, aiPortfolioId, WEDNESDAY);
    expect(after?.decision.allowed).toBe(false);
    expect(after?.decision.reason?.code).toBe("PERIOD_LIMIT_REACHED");
  });
});
