import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { HOUSE_RULES } from "@/server/competition/house-rules";
import { loadTradingAccess } from "./access";
import { commitRebalance } from "./commit";
import { checkPortfolioInvariants } from "./invariant";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

// October 2026: the window is the 1st to the 7th; the next opens on 1 November.
const IN_WINDOW = new Date("2026-10-02T10:00:00Z"); // Friday the 2nd
const AFTER_WINDOW = new Date("2026-10-08T10:00:00Z"); // Thursday the 8th
const NEXT_MONTH = new Date("2026-11-02T10:00:00Z");
let bob: Awaited<ReturnType<typeof seedParticipant>>;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competition.update({
    where: { id: competitionId },
    data: { endsAt: new Date("2026-12-31T17:30:00Z"), endDate: "2026-12-31" },
  });
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, ...HOUSE_RULES, maxPositionPpm: 1_000_000 },
  });
  const stock = await db.stock.create({ data: { symbol: "MC", name: "LVMH" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: "2026-10-01", closeCents: 50_000n },
      { stockId, tradeDate: "2026-11-02", closeCents: 50_000n },
    ],
  });
  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("the monthly rebalance token, open in the first week", () => {
  it("is available on the 1st to the 7th, and says until when", async () => {
    const access = await loadTradingAccess(db, alice.portfolio.id, IN_WINDOW);
    expect(access?.decision.allowed).toBe(true);
    expect(access?.tokens).toMatchObject({
      allowance: 1,
      used: 0,
      remaining: 1,
      usableUntil: "2026-10-07",
      refillsOn: "2026-11-01",
      expired: false,
    });
  });

  it("is spent by a rebalance, and the banner says when it comes back", async () => {
    const before = await loadTradingAccess(db, alice.portfolio.id, IN_WINDOW);
    const result = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [{ stockId, weightPpm: 500_000 }],
      idempotencyKey: "alice-october",
      periodKey: before?.decision.periodKey ?? null,
      asOfDate: "2026-10-02",
      executedAt: IN_WINDOW,
    });
    expect(result.ok).toBe(true);

    const after = await loadTradingAccess(db, alice.portfolio.id, IN_WINDOW);
    expect(after?.decision.allowed).toBe(false);
    expect(after?.decision.reason?.code).toBe("PERIOD_LIMIT_REACHED");
    expect(after?.decision.reason?.message).toContain("monthly rebalance token");
    expect(after?.decision.reason?.message).toContain("Sunday 1 November");
    expect(after?.tokens?.remaining).toBe(0);
  });

  it("expires unused after the 7th, until next month's window", async () => {
    // Bob never rebalanced in October's first week.
    const access = await loadTradingAccess(db, bob.portfolio.id, AFTER_WINDOW);
    expect(access?.decision.allowed).toBe(false);
    expect(access?.decision.reason?.code).toBe("REBALANCE_WINDOW_CLOSED");
    expect(access?.decision.reason?.message).toContain("expired");
    expect(access?.decision.reason?.message).toContain("Sunday 1 November");
    expect(access?.tokens).toMatchObject({ remaining: 0, expired: true });
  });

  it("comes back next month — last month's rebalance does not count against this one", async () => {
    // The bug this guards: the count once included every committed rebalance
    // that had ever had a period key, so after period one nobody could trade.
    const access = await loadTradingAccess(db, alice.portfolio.id, NEXT_MONTH);
    expect(access?.decision.allowed).toBe(true);
    expect(access?.tokens?.remaining).toBe(1);
  });
});

describe("the 1% transaction cost", () => {
  it("charges 1% of the order on top of the purchase, and the ledger still reconciles", async () => {
    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
      include: { transactions: { where: { type: "BUY" } } },
    });
    const buy = portfolio.transactions[0];
    expect(buy).toBeDefined();
    if (!buy) return;
    // 1% of the order, rounded up to the cent, and capitalised into the cost.
    expect(buy.feeCents).toBe((buy.grossCents + 99n) / 100n);
    expect(buy.cashDeltaCents).toBe(-(buy.grossCents + buy.feeCents));
    expect(portfolio.totalFeesCents).toBe(buy.feeCents);
    // The 50% is 50% of what is left AFTER the fee: €49,751 of LVMH out of
    // €99,502.49, not €50,000 out of €99,500.
    const after = 10_000_000n - buy.feeCents;
    expect(Number((buy.grossCents * 1_000_000n) / after)).toBeGreaterThanOrEqual(499_990);
    expect(Number((buy.grossCents * 1_000_000n) / after)).toBeLessThanOrEqual(500_000);
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });
});
