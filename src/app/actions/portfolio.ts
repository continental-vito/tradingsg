"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dateKeyOf } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { findOwnedPortfolio } from "@/server/auth/ownership";
import { db } from "@/server/db";
import { money, ratio, shares } from "@/server/dto/serialize";
import { commitRebalance, loadTradingRules } from "@/server/portfolio/commit";
import { buildPriceBook } from "@/server/portfolio/prices";
import { planRebalance, type ValidationIssue } from "@/server/portfolio/rebalance";
import { evaluateTradingWindow } from "@/server/portfolio/window";
import type { PortfolioState } from "@/server/portfolio/value";

/**
 * Preview and commit.
 *
 * Both go through the same planRebalance over the same price book, so the
 * numbers on the confirmation screen are the numbers that execute. Neither
 * trusts anything the client computed: the browser sends target percentages and
 * nothing else.
 */

const targetsSchema = z
  .array(
    z.object({ stockId: z.string().min(1), weightPpm: z.number().int().min(0).max(1_000_000) }),
  )
  .max(50);

export interface PlanPreview {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary?: {
    valueBefore: string;
    valueAfter: string;
    fees: string;
    rounding: string;
    cashAfter: string;
    cashWeightPpm: number;
    orders: {
      side: "BUY" | "SELL";
      symbol: string;
      shares: string;
      price: string;
      amount: string;
      prevWeightPpm: number;
      newWeightPpm: number;
      scaled: boolean;
    }[];
    holdings: { symbol: string; shares: string; value: string; weightPpm: number }[];
  };
}

async function loadContext(portfolioId: string) {
  const user = await requireUser();
  const owned = await findOwnedPortfolio(db, {
    userId: user.id,
    role: user.role,
    portfolioId,
  });
  // A missing portfolio and someone else's portfolio are indistinguishable
  // from here on, which is the point.
  if (!owned) return null;

  const portfolio = await db.portfolio.findUniqueOrThrow({
    where: { id: portfolioId },
    include: {
      holdings: { include: { stock: true } },
      competition: {
        include: {
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
          tradingWindows: { where: { isActive: true } },
        },
      },
    },
  });
  return { user, portfolio };
}

async function buildPlan(portfolioId: string, rawTargets: unknown) {
  const context = await loadContext(portfolioId);
  if (!context) {
    return {
      kind: "error" as const,
      error: {
        code: "NOT_FOUND",
        message: "That portfolio could not be found.",
        severity: "ERROR" as const,
      },
    };
  }

  const parsed = targetsSchema.safeParse(rawTargets);
  if (!parsed.success) {
    return {
      kind: "error" as const,
      error: {
        code: "BAD_REQUEST",
        message: "That allocation could not be read. Reload the page and try again.",
        severity: "ERROR" as const,
      },
    };
  }

  const { portfolio } = context;
  const settings = portfolio.competition.settings[0];
  if (!settings) {
    return {
      kind: "error" as const,
      error: {
        code: "NO_SETTINGS",
        message: "This competition has no rules configured yet. Ask the administrator.",
        severity: "ERROR" as const,
      },
    };
  }

  const now = new Date();
  const asOfDate = dateKeyOf(now, portfolio.competition.timezone);

  const changesThisPeriod = await db.rebalanceRequest.count({
    where: { portfolioId, status: "COMMITTED", periodKey: { not: null } },
  });

  const window = evaluateTradingWindow({
    rules: {
      tradingMode: settings.tradingMode,
      periodUnit: settings.periodUnit as "DAY" | "WEEK" | "MONTH",
      maxChangesPerPeriod: settings.maxChangesPerPeriod,
      lockAfterDate: settings.lockAfterDate,
      allowTradingBeforeStart: settings.allowTradingBeforeStart,
      timezone: portfolio.competition.timezone,
      weekStartsOn: portfolio.competition.weekStartsOn,
    },
    competition: {
      status: portfolio.competition.status,
      startsAt: portfolio.competition.startsAt,
      endsAt: portfolio.competition.endsAt,
    },
    openWindows: portfolio.competition.tradingWindows,
    changesThisPeriod,
    now,
  });

  const { rules } = await loadTradingRules(db, portfolio.competitionId);

  const stockIds = [
    ...new Set([...portfolio.holdings.map((h) => h.stockId), ...parsed.data.map((t) => t.stockId)]),
  ];
  const book = await buildPriceBook(db, stockIds, asOfDate);
  const symbolById = new Map(portfolio.holdings.map((h) => [h.stockId, h.stock.symbol]));
  for (const stock of await db.stock.findMany({
    where: { id: { in: stockIds } },
    select: { id: true, symbol: true },
  })) {
    symbolById.set(stock.id, stock.symbol);
  }

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

  const planned = planRebalance({
    state,
    targets: parsed.data,
    book,
    rules,
    symbolOf: (id) => symbolById.get(id) ?? id,
  });

  return {
    kind: "ok" as const,
    context,
    window,
    planned,
    asOfDate,
    currency: portfolio.competition.currency,
    targets: parsed.data,
  };
}

export async function previewRebalanceAction(
  portfolioId: string,
  rawTargets: unknown,
): Promise<PlanPreview> {
  const built = await buildPlan(portfolioId, rawTargets);
  if (built.kind === "error") return { ok: false, errors: [built.error], warnings: [] };

  const { window, planned, currency } = built;

  if (!planned.ok) {
    // Window problems are reported alongside allocation problems rather than
    // instead of them, so a participant fixes everything in one pass.
    const errors = [...planned.errors];
    if (!window.allowed && window.reason) {
      errors.unshift({ ...window.reason, severity: "ERROR" });
    }
    return { ok: false, errors, warnings: [] };
  }

  const plan = planned.plan;
  return {
    ok: window.allowed,
    errors:
      window.allowed || !window.reason ? [] : [{ ...window.reason, severity: "ERROR" as const }],
    warnings: plan.warnings,
    summary: {
      valueBefore: money(plan.preValueCents, currency).text,
      valueAfter: money(plan.postValueCents, currency).text,
      fees: money(plan.totalFeeCents, currency).text,
      rounding: money(plan.roundingDragCents, currency).text,
      cashAfter: money(plan.projectedCashCents, currency).text,
      cashWeightPpm: plan.projectedCashWeightPpm,
      orders: plan.orders.map((o) => ({
        side: o.side,
        symbol: o.symbol,
        shares: shares(o.microShares).text,
        price: money(o.priceCents, currency).text,
        amount: money(o.grossCents, currency).text,
        prevWeightPpm: o.prevWeightPpm,
        newWeightPpm: o.newWeightPpm,
        scaled: o.wasScaledDown,
      })),
      holdings: plan.projectedHoldings.map((h) => ({
        symbol: h.symbol,
        shares: shares(h.microShares).text,
        value: money(h.marketValueCents, currency).text,
        weightPpm: h.weightPpm,
      })),
    },
  };
}

export interface SubmitResult {
  ok: boolean;
  errors: ValidationIssue[];
  committed?: { orders: number; valueAfter: string; returnText: string };
}

export async function submitRebalanceAction(
  portfolioId: string,
  rawTargets: unknown,
  idempotencyKey?: string,
): Promise<SubmitResult> {
  const built = await buildPlan(portfolioId, rawTargets);
  if (built.kind === "error") return { ok: false, errors: [built.error] };

  const { window, planned, asOfDate, currency, targets, context } = built;

  // Re-checked here, not merely at preview time: the window can close between
  // the two, and the preview is a page the browser holds for as long as it likes.
  if (!window.allowed && window.reason) {
    return { ok: false, errors: [{ ...window.reason, severity: "ERROR" }] };
  }
  if (!planned.ok) return { ok: false, errors: planned.errors };

  const result = await commitRebalance(db, {
    portfolioId,
    targets,
    // A key supplied by the client makes a double-submit a replay. Without one
    // a fresh key is minted, which is still safe — it just cannot dedupe.
    idempotencyKey: idempotencyKey ?? randomUUID(),
    periodKey: window.periodKey,
    asOfDate,
  });

  if (!result.ok) return { ok: false, errors: result.errors };

  await db.auditLog.create({
    data: {
      actorUserId: context.user.id,
      actorRole: context.user.role,
      action: "portfolio.rebalance",
      entityType: "Portfolio",
      entityId: portfolioId,
      afterJson: JSON.stringify({
        orders: result.plan.orders.length,
        postValueCents: result.plan.postValueCents.toString(),
      }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/portfolio");
  revalidatePath("/leaderboard");

  return {
    ok: true,
    errors: [],
    committed: {
      orders: result.plan.orders.length,
      valueAfter: money(result.plan.postValueCents, currency).text,
      returnText: ratio(
        Number(
          ((result.plan.postValueCents - context.portfolio.initialCapitalCents) * 1_000_000n) /
            context.portfolio.initialCapitalCents,
        ),
      ).text,
    },
  };
}
