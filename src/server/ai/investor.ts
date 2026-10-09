import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, dateKeyOf, isoWeekOf, startOfWeek, type DateKey } from "@/lib/dates";
import { toPpm } from "@/server/money";
import { loadTradingAccess } from "@/server/portfolio/access";
import { commitRebalance, loadTradingRules } from "@/server/portfolio/commit";
import { buildPriceBook } from "@/server/portfolio/prices";
import { planRebalance, type RebalanceTarget } from "@/server/portfolio/rebalance";
import { valuePortfolio, type PortfolioState } from "@/server/portfolio/value";
import {
  AdvisorError,
  type AdvisorProposal,
  type AdvisorStock,
  type AllocationAdvisor,
} from "./advisor";

/**
 * The AI investor: an autonomous participant an administrator manages.
 *
 * It is an ordinary participant in every way that matters to the competition —
 * a User, a Participant, a funded Portfolio — and it trades through exactly the
 * code a person's "Confirm" button reaches: the same trading-access check (so
 * the same weekly token), the same planner (position caps, cash rules, the 1%
 * fee), and the same commit (ledger invariants inside the transaction). The
 * only thing it does differently is who picks the target weights.
 *
 * Kept free of Next.js so it can be tested and run from the job runner.
 */

export type AiTrigger = "SCHEDULE" | "ADMIN";

export interface AiRunOutcome {
  status: "TRADED" | "SKIPPED" | "REJECTED" | "FAILED";
  summary: string;
  runId: string | null;
}

/** Proposals the planner refuses are sent back with the reasons this many times. */
const MAX_ATTEMPTS = 2;

/** Closes from roughly `days` calendar days ago, per stock, oldest first. */
async function recentCloses(db: PrismaClient, stockIds: string[], today: DateKey) {
  const rows = await db.priceHistory.findMany({
    where: {
      stockId: { in: stockIds },
      supersededAt: null,
      tradeDate: { gte: addDays(today, -45), lte: today },
    },
    orderBy: [{ tradeDate: "asc" }, { revision: "desc" }],
    select: { stockId: true, tradeDate: true, closeCents: true },
  });
  const byStock = new Map<string, bigint[]>();
  let lastKey = "";
  for (const row of rows) {
    // Highest revision first within a date; keep only that one.
    const key = `${row.stockId}:${row.tradeDate}`;
    if (key === lastKey) continue;
    lastKey = key;
    const list = byStock.get(row.stockId) ?? [];
    list.push(row.closeCents);
    byStock.set(row.stockId, list);
  }
  return byStock;
}

function changeOver(closes: bigint[] | undefined, sessions: number): number | null {
  if (!closes || closes.length <= sessions) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - sessions];
  if (now === undefined || then === undefined || then === 0n) return null;
  return toPpm(now - then, then);
}

/**
 * Turns the model's percentages into planner targets. Unknown tickers and
 * negative weights are reported back to the model rather than guessed at. A
 * total a hair over 100% (rounding in the model's arithmetic) is scaled down
 * pro rata instead of costing the week; anything left over is cash.
 */
export function proposalToTargets(
  proposal: Pick<AdvisorProposal, "allocations">,
  stockIdBySymbol: ReadonlyMap<string, string>,
): { targets: RebalanceTarget[]; problems: string[] } {
  const problems: string[] = [];
  const weights = new Map<string, number>();
  for (const { symbol, weightPercent } of proposal.allocations) {
    const stockId = stockIdBySymbol.get(symbol.trim().toUpperCase());
    if (!stockId) {
      problems.push(`${symbol} is not in the tradable universe.`);
      continue;
    }
    if (!Number.isFinite(weightPercent) || weightPercent < 0) {
      problems.push(`${symbol} has a weight of ${weightPercent}%; weights must be 0 or more.`);
      continue;
    }
    weights.set(stockId, (weights.get(stockId) ?? 0) + Math.round(weightPercent * 10_000));
  }

  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const targets = [...weights.entries()]
    .filter(([, ppm]) => ppm > 0)
    .map(([stockId, weightPpm]) => ({
      stockId,
      weightPpm: total > 1_000_000 ? Math.floor((weightPpm * 1_000_000) / total) : weightPpm,
    }));
  return { targets, problems };
}

export async function runAiInvestor(
  db: PrismaClient,
  advisor: AllocationAdvisor | null,
  args: { aiInvestorId: string; triggeredBy: AiTrigger; now?: Date },
): Promise<AiRunOutcome> {
  const now = args.now ?? new Date();
  const investor = await db.aiInvestor.findUniqueOrThrow({
    where: { id: args.aiInvestorId },
    include: {
      user: {
        include: {
          participants: {
            where: { deletedAt: null },
            orderBy: { joinedAt: "desc" },
            take: 1,
            include: {
              competition: { select: { timezone: true } },
              portfolio: { include: { holdings: { include: { stock: true } } } },
            },
          },
        },
      },
    },
  });

  const participant = investor.user.participants[0];
  const portfolio = participant?.portfolio;
  let asOfDate: DateKey = dateKeyOf(now, participant?.competition.timezone ?? "UTC");

  const record = async (
    status: AiRunOutcome["status"],
    summary: string,
    extra: {
      rationale?: string;
      targetsJson?: string;
      rebalanceRequestId?: string;
      proposal?: AdvisorProposal;
    } = {},
  ): Promise<AiRunOutcome> => {
    const run = await db.aiInvestorRun.create({
      data: {
        aiInvestorId: investor.id,
        asOfDate,
        status,
        triggeredBy: args.triggeredBy,
        summary,
        rationale: extra.rationale ?? null,
        targetsJson: extra.targetsJson ?? null,
        rebalanceRequestId: extra.rebalanceRequestId ?? null,
        model: extra.proposal?.model ?? null,
        inputTokens: extra.proposal?.inputTokens ?? null,
        outputTokens: extra.proposal?.outputTokens ?? null,
      },
    });
    await db.aiInvestor.update({ where: { id: investor.id }, data: { lastRunAt: now } });
    return { status, summary, runId: run.id };
  };

  if (!participant || !portfolio) {
    return record("FAILED", "The AI investor is not enrolled in a competition.");
  }
  if (participant.status === "WITHDRAWN" || participant.status === "DISQUALIFIED") {
    return record(
      "SKIPPED",
      `Not trading: the AI investor is ${participant.status.toLowerCase()}.`,
    );
  }

  // On a schedule the AI decides at most once a week even when the rules would
  // let it trade daily: an unattended model paying a fee every morning is a
  // way to lose to the fee, not a strategy. Not recorded — a row saying "not
  // this morning" six days a week would bury the decisions worth reading.
  if (args.triggeredBy === "SCHEDULE") {
    const weekStart = startOfWeek(asOfDate);
    const tradedThisWeek = await db.aiInvestorRun.count({
      where: { aiInvestorId: investor.id, status: "TRADED", asOfDate: { gte: weekStart } },
    });
    if (tradedThisWeek > 0) {
      return {
        status: "SKIPPED",
        summary: `Already traded in ${isoWeekOf(weekStart)}.`,
        runId: null,
      };
    }
  }

  // The same check a person's allocation page and confirm button run.
  const access = await loadTradingAccess(db, portfolio.id, now);
  if (!access) return record("FAILED", "The competition has no rules configured.");
  asOfDate = access.today;
  if (!access.decision.allowed) {
    const reason = access.decision.reason?.message ?? "Trading is closed.";
    if (
      args.triggeredBy === "SCHEDULE" &&
      access.decision.reason?.code === "PERIOD_LIMIT_REACHED"
    ) {
      return { status: "SKIPPED", summary: reason, runId: null };
    }
    return record("SKIPPED", reason);
  }

  if (!advisor) {
    return record(
      "FAILED",
      "ANTHROPIC_API_KEY is not set, so there is no model to ask. Add it to the environment and redeploy.",
    );
  }

  const competition = await db.competition.findUniqueOrThrow({
    where: { id: portfolio.competitionId },
    select: {
      currency: true,
      settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
    },
  });
  const settings = competition.settings[0];
  if (!settings) return record("FAILED", "The competition has no rules configured.");

  const { rules } = await loadTradingRules(db, portfolio.competitionId);
  const universe = await db.competitionStock.findMany({
    where: { competitionId: portfolio.competitionId, removedAt: null, isTradable: true },
    orderBy: { sortOrder: "asc" },
    include: { stock: true },
  });
  const stockIds = [
    ...new Set([...universe.map((u) => u.stockId), ...portfolio.holdings.map((h) => h.stockId)]),
  ];
  const book = await buildPriceBook(db, stockIds, access.today);

  const state: PortfolioState = {
    cashCents: portfolio.cashCents,
    initialCapitalCents: portfolio.initialCapitalCents,
    netFlowCents: portfolio.netFlowCents,
    realizedPnlCents: portfolio.realizedPnlCents,
    holdings: portfolio.holdings.map((h) => ({
      stockId: h.stockId,
      symbol: h.stock.symbol,
      microShares: h.microShares,
      costBasisCents: h.costBasisCents,
    })),
  };
  const value = valuePortfolio(state, book);
  const weightOf = new Map(value.holdings.map((h) => [h.stockId, h.weightPpm]));
  const closes = await recentCloses(db, stockIds, access.today);

  // Only names with a price can be bought; offering the model anything else
  // invites a proposal the planner has to refuse.
  const priced = universe.filter((u) => book.get(u.stockId));
  const stocks: AdvisorStock[] = priced.map((u) => ({
    symbol: u.stock.symbol,
    name: u.stock.name,
    sector: u.stock.sector,
    priceCents: book.get(u.stockId)?.priceCents ?? 0n,
    change5dPpm: changeOver(closes.get(u.stockId), 5),
    change20dPpm: changeOver(closes.get(u.stockId), 20),
    currentWeightPpm: weightOf.get(u.stockId) ?? 0,
  }));
  if (stocks.length === 0) {
    return record("SKIPPED", "No stock in the universe has a price yet.");
  }
  const stockIdBySymbol = new Map(priced.map((u) => [u.stock.symbol.toUpperCase(), u.stockId]));
  const symbolOf = new Map(universe.map((u) => [u.stockId, u.stock.symbol]));
  for (const h of portfolio.holdings) symbolOf.set(h.stockId, h.stock.symbol);

  let previousErrors: string[] | undefined;
  let proposal: AdvisorProposal | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      proposal = await advisor.propose({
        model: investor.model,
        strategy: investor.strategy,
        asOfDate: access.today,
        currency: competition.currency,
        totalValueCents: value.totalValueCents,
        cashCents: value.cashCents,
        totalReturnPpm: value.totalReturnPpm,
        stocks,
        rules: {
          maxPositionPpm: settings.maxPositionPpm,
          minPositionPpm: settings.minPositionPpm,
          minPositions: settings.minPositions,
          maxPositions: settings.maxPositions,
          allowCash: settings.allowCash,
          minCashPpm: settings.minCashPpm,
          maxCashPpm: settings.maxCashPpm,
          feeBps: settings.feeBps,
          feeModel: settings.feeModel,
          rebalancesPerPeriod: access.tokens?.allowance ?? null,
          periodUnit: settings.periodUnit,
        },
        previousErrors,
      });
    } catch (error: unknown) {
      if (error instanceof AdvisorError) return record("FAILED", error.message);
      throw error;
    }

    const { targets, problems } = proposalToTargets(proposal, stockIdBySymbol);
    const targetsJson = JSON.stringify(
      targets.map((t) => ({
        symbol: symbolOf.get(t.stockId) ?? t.stockId,
        weightPpm: t.weightPpm,
      })),
    );

    const planned = planRebalance({
      state,
      targets,
      book,
      rules,
      symbolOf: (id) => symbolOf.get(id) ?? id,
    });
    const errors = [...problems, ...(planned.ok ? [] : planned.errors.map((e) => e.message))];

    if (errors.length > 0) {
      previousErrors = errors;
      if (attempt < MAX_ATTEMPTS) continue;
      return record("REJECTED", `Refused by the rules: ${errors.join(" ")}`, {
        rationale: proposal.rationale,
        targetsJson,
        proposal,
      });
    }
    if (!planned.ok) continue; // unreachable: errors would be non-empty

    if (planned.plan.orders.length === 0) {
      return record("SKIPPED", "Kept the current allocation: no order was worth its fee.", {
        rationale: proposal.rationale,
        targetsJson,
        proposal,
      });
    }

    const committed = await commitRebalance(db, {
      portfolioId: portfolio.id,
      targets,
      // One decision per investor per day, so a job that runs twice cannot
      // trade twice. The (portfolio, period) unique index backs this up.
      idempotencyKey: `ai:${investor.id}:${access.today}`,
      periodKey: access.decision.periodKey,
      asOfDate: access.today,
      executedAt: now,
    });
    if (!committed.ok) {
      return record(
        "REJECTED",
        `Refused at commit: ${committed.errors.map((e) => e.message).join(" ")}`,
        { rationale: proposal.rationale, targetsJson, proposal },
      );
    }

    await db.auditLog.create({
      data: {
        actorUserId: investor.userId,
        actorRole: "AI",
        action: "portfolio.rebalance",
        entityType: "Portfolio",
        entityId: portfolio.id,
        afterJson: JSON.stringify({
          orders: committed.plan.orders.length,
          postValueCents: committed.plan.postValueCents.toString(),
          aiInvestorId: investor.id,
        }),
      },
    });

    const buys = committed.plan.orders.filter((o) => o.side === "BUY").length;
    const sells = committed.plan.orders.length - buys;
    return record(
      "TRADED",
      committed.replayed
        ? "Already traded today; the earlier trade stands."
        : `${buys} buy${buys === 1 ? "" : "s"} and ${sells} sell${sells === 1 ? "" : "s"}, ${(Number(committed.plan.totalFeeCents) / 100).toFixed(2)} ${competition.currency} in fees.`,
      {
        rationale: proposal.rationale,
        targetsJson,
        rebalanceRequestId: committed.rebalanceRequestId,
        proposal,
      },
    );
  }

  return record("FAILED", "No proposal was produced.");
}

/** Every enabled AI investor in a running competition, for the scheduled job. */
export async function runAllAiInvestors(
  db: PrismaClient,
  advisor: AllocationAdvisor | null,
  args: { now?: Date; log: (message: string) => void },
): Promise<{ processed: number; failed: number }> {
  const investors = await db.aiInvestor.findMany({
    where: {
      isEnabled: true,
      user: {
        isDisabled: false,
        deletedAt: null,
        participants: {
          some: {
            deletedAt: null,
            competition: { deletedAt: null, status: { in: ["RUNNING", "REGISTRATION"] } },
          },
        },
      },
    },
    select: { id: true, user: { select: { firstName: true } } },
  });

  let failed = 0;
  for (const investor of investors) {
    const outcome = await runAiInvestor(db, advisor, {
      aiInvestorId: investor.id,
      triggeredBy: "SCHEDULE",
      now: args.now,
    });
    if (outcome.status === "FAILED") failed++;
    args.log(`${investor.user.firstName}: ${outcome.status} — ${outcome.summary}`);
  }
  return { processed: investors.length, failed };
}
