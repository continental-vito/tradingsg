import type { PrismaClient } from "@/generated/prisma/client";
import type { DateKey } from "@/lib/dates";
import type { FeeConfig } from "@/server/money";
import { assertPortfolioInvariants } from "./invariant";
import { buildPriceBook, type PriceBook } from "./prices";
import {
  planRebalance,
  type RebalancePlan,
  type RebalanceTarget,
  type TradingRules,
  type ValidationIssue,
} from "./rebalance";
import type { PortfolioState } from "./value";

/**
 * Committing a rebalance.
 *
 * The preview and the commit run the SAME planRebalance over the SAME frozen
 * quotes — the commit never re-quotes — so what a participant confirms is what
 * executes. The plan is stored on the RebalanceRequest alongside those quotes,
 * which makes the audit trail record the intent, not just the resulting trades.
 *
 * Two unique constraints do the real work:
 *   - `idempotencyKey`, so a double-click or a retried server action returns
 *     the existing result instead of trading twice.
 *   - `(portfolioId, periodKey)`, which is what actually enforces "one change
 *     per week" under a concurrent double-submit. The application-level count
 *     check exists only to produce a friendlier message first.
 */

export type CommitResult =
  | { ok: true; plan: RebalancePlan; rebalanceRequestId: string; replayed: boolean }
  | { ok: false; errors: ValidationIssue[] };

export interface CommitArgs {
  portfolioId: string;
  targets: RebalanceTarget[];
  idempotencyKey: string;
  periodKey: string | null;
  asOfDate: DateKey;
  executedAt?: Date;
  /** Overrides the stored rules, used by the seed to replay historical prices. */
  rulesOverride?: Partial<TradingRules>;
}

export async function loadTradingRules(
  db: PrismaClient,
  competitionId: string,
): Promise<{ rules: TradingRules; feeConfig: FeeConfig }> {
  const settings = await db.competitionSettings.findFirst({
    where: { competitionId, supersededAt: null },
    orderBy: { revision: "desc" },
  });
  if (!settings) {
    throw new Error(
      `Competition ${competitionId} has no settings. Every rule is configurable, so there is no safe default to fall back on.`,
    );
  }

  const universe = await db.competitionStock.findMany({
    where: { competitionId },
    select: { stockId: true, isTradable: true, removedAt: true, maxWeightPpm: true },
  });

  const feeConfig: FeeConfig = {
    feeModel: settings.feeModel as FeeConfig["feeModel"],
    feeFlatCents: settings.feeFlatCents,
    feeBps: settings.feeBps,
    feeMinCents: settings.feeMinCents,
    feeMaxCents: settings.feeMaxCents,
  };

  const overrides = new Map<string, number>();
  for (const row of universe) {
    if (row.maxWeightPpm !== null) overrides.set(row.stockId, row.maxWeightPpm);
  }

  return {
    feeConfig,
    rules: {
      minPositionPpm: settings.minPositionPpm,
      maxPositionPpm: settings.maxPositionPpm,
      minPositionCents: settings.minPositionCents,
      minPositions: settings.minPositions,
      maxPositions: settings.maxPositions,
      allowCash: settings.allowCash,
      minCashPpm: settings.minCashPpm,
      maxCashPpm: settings.maxCashPpm,
      cashToleranceCents: settings.cashToleranceCents,
      allowFractionalShares: settings.allowFractionalShares,
      minTradeMicroShares: settings.minTradeMicroShares,
      minTradeValueCents: settings.minTradeValueCents,
      fees: feeConfig,
      maxWeightOverridesPpm: overrides,
      notBuyable: new Set(
        universe.filter((u) => !u.isTradable || u.removedAt !== null).map((u) => u.stockId),
      ),
      universe: new Set(universe.map((u) => u.stockId)),
    },
  };
}

export async function commitRebalance(db: PrismaClient, args: CommitArgs): Promise<CommitResult> {
  const existing = await db.rebalanceRequest.findUnique({
    where: { idempotencyKey: args.idempotencyKey },
  });
  if (existing?.status === "COMMITTED" && existing.planJson) {
    // A replay, not a second trade. Returning the original result is the whole
    // point of the key.
    return {
      ok: true,
      plan: JSON.parse(existing.planJson, reviveBigInts) as RebalancePlan,
      rebalanceRequestId: existing.id,
      replayed: true,
    };
  }

  const portfolio = await db.portfolio.findUnique({
    where: { id: args.portfolioId },
    include: {
      holdings: { include: { stock: { select: { symbol: true } } } },
      participant: { select: { id: true } },
    },
  });
  if (!portfolio) {
    return {
      ok: false,
      errors: [
        {
          code: "PORTFOLIO_NOT_FOUND",
          message: "That portfolio no longer exists.",
          severity: "ERROR",
        },
      ],
    };
  }

  const { rules: storedRules } = await loadTradingRules(db, portfolio.competitionId);
  const rules: TradingRules = { ...storedRules, ...args.rulesOverride };

  const stockIds = [
    ...new Set([
      ...portfolio.holdings.map((h) => h.stockId),
      ...args.targets.map((t) => t.stockId),
    ]),
  ];
  const book = await buildPriceBook(db, stockIds, args.asOfDate);

  const symbols = new Map(
    (
      await db.stock.findMany({
        where: { id: { in: stockIds } },
        select: { id: true, symbol: true },
      })
    ).map((s) => [s.id, s.symbol]),
  );

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
    targets: args.targets,
    book,
    rules,
    symbolOf: (id) => symbols.get(id) ?? id,
  });

  if (!planned.ok) {
    const rejection = {
      status: "REJECTED",
      // A rejected attempt must not consume the period's one allowed change.
      periodKey: null,
      targetsJson: JSON.stringify(args.targets),
      quotesJson: JSON.stringify(quotesFrom(book, stockIds)),
      errorsJson: JSON.stringify(planned.errors),
    };
    // Upsert, not create: retrying a rejected submission with the same key is
    // the normal case — the participant fixes the allocation and submits again
    // — and it must record the new errors rather than fail on the key.
    await db.rebalanceRequest.upsert({
      where: { idempotencyKey: args.idempotencyKey },
      update: rejection,
      create: { portfolioId: args.portfolioId, idempotencyKey: args.idempotencyKey, ...rejection },
    });
    return { ok: false, errors: planned.errors };
  }

  const plan = planned.plan;
  const executedAt = args.executedAt ?? new Date();

  const request = await db.$transaction(async (tx) => {
    const created = await tx.rebalanceRequest.create({
      data: {
        portfolioId: args.portfolioId,
        status: "COMMITTED",
        idempotencyKey: args.idempotencyKey,
        periodKey: args.periodKey,
        targetsJson: JSON.stringify(args.targets),
        quotesJson: JSON.stringify(quotesFrom(book, stockIds)),
        planJson: JSON.stringify(plan, replaceBigInts),
        preValueCents: plan.preValueCents,
        postValueCents: plan.postValueCents,
        totalFeeCents: plan.totalFeeCents,
        orderCount: plan.orders.length,
        committedAt: executedAt,
      },
    });

    let sequence = portfolio.transactionSeq;
    let cash = portfolio.cashCents;
    const sharesAfter = new Map(portfolio.holdings.map((h) => [h.stockId, h.microShares]));

    for (const order of plan.orders) {
      sequence++;
      cash += order.cashDeltaCents;
      const delta = order.side === "BUY" ? order.microShares : -order.microShares;
      const after = (sharesAfter.get(order.stockId) ?? 0n) + delta;
      sharesAfter.set(order.stockId, after);

      await tx.transaction.create({
        data: {
          portfolioId: args.portfolioId,
          participantId: portfolio.participantId,
          stockId: order.stockId,
          rebalanceRequestId: created.id,
          sequence,
          type: order.side,
          tradeDate: args.asOfDate,
          executedAt,
          microShareDelta: delta,
          priceCents: order.priceCents,
          grossCents: order.grossCents,
          feeCents: order.feeCents,
          cashDeltaCents: order.cashDeltaCents,
          costAddedCents: order.costAddedCents,
          costRemovedCents: order.costRemovedCents,
          realizedPnlCents: order.realizedPnlCents,
          cashAfterCents: cash,
          microSharesAfter: after,
          isExternalFlow: false,
          prevAllocationPpm: order.prevWeightPpm,
          newAllocationPpm: order.newWeightPpm,
          isDemo: false,
        },
      });

      const holding = portfolio.holdings.find((h) => h.stockId === order.stockId);
      const newBasis =
        (holding?.costBasisCents ?? 0n) + order.costAddedCents - order.costRemovedCents;
      const newRealized = (holding?.realizedPnlCents ?? 0n) + order.realizedPnlCents;

      await tx.holding.upsert({
        where: { portfolioId_stockId: { portfolioId: args.portfolioId, stockId: order.stockId } },
        update: {
          microShares: after,
          costBasisCents: newBasis,
          realizedPnlCents: newRealized,
          lastTradedAt: executedAt,
        },
        create: {
          portfolioId: args.portfolioId,
          stockId: order.stockId,
          microShares: after,
          costBasisCents: newBasis,
          realizedPnlCents: newRealized,
          firstBoughtAt: executedAt,
          lastTradedAt: executedAt,
        },
      });
      // Keep the in-memory copy in step, so a second leg on the same stock
      // computes its basis from the updated figure rather than the original.
      if (holding) {
        holding.costBasisCents = newBasis;
        holding.realizedPnlCents = newRealized;
      } else {
        portfolio.holdings.push({
          id: "",
          portfolioId: args.portfolioId,
          stockId: order.stockId,
          microShares: after,
          costBasisCents: newBasis,
          realizedPnlCents: newRealized,
          firstBoughtAt: executedAt,
          lastTradedAt: executedAt,
          createdAt: executedAt,
          updatedAt: executedAt,
          stock: { symbol: order.symbol },
        } as (typeof portfolio.holdings)[number]);
      }
    }

    // A holding that reached zero keeps its row when it has realised P/L, so
    // "your best trade this season" survives a full exit. One that never made
    // anything is deleted rather than left as a zero-row cluttering the table.
    await tx.holding.deleteMany({
      where: { portfolioId: args.portfolioId, microShares: 0n, realizedPnlCents: 0n },
    });

    const holdingsNow = await tx.holding.findMany({ where: { portfolioId: args.portfolioId } });
    await tx.portfolio.update({
      where: { id: args.portfolioId },
      data: {
        status: "ACTIVE",
        cashCents: cash,
        costBasisCents: holdingsNow.reduce((s, h) => s + h.costBasisCents, 0n),
        realizedPnlCents:
          portfolio.realizedPnlCents + plan.orders.reduce((s, o) => s + o.realizedPnlCents, 0n),
        totalFeesCents: portfolio.totalFeesCents + plan.totalFeeCents,
        transactionSeq: sequence,
        rebalanceCount: { increment: 1 },
        lastRebalancedAt: executedAt,
        setupCompletedAt: portfolio.setupCompletedAt ?? executedAt,
        version: { increment: 1 },
      },
    });

    await tx.participant.update({
      where: { id: portfolio.participantId },
      data: { status: "ACTIVE" },
    });
    // Only the FIRST rebalance sets activatedAt — it is the tie-break for
    // "earlier commitment wins", so a later trade must not reset it.
    await tx.participant.updateMany({
      where: { id: portfolio.participantId, activatedAt: null },
      data: { activatedAt: executedAt },
    });

    // Inside the transaction, so a bug in the planner rolls the whole rebalance
    // back rather than leaving the ledger inconsistent.
    await assertPortfolioInvariants(tx as unknown as PrismaClient, args.portfolioId);

    return created;
  });

  return { ok: true, plan, rebalanceRequestId: request.id, replayed: false };
}

function quotesFrom(book: PriceBook, stockIds: string[]) {
  return stockIds.flatMap((stockId) => {
    const point = book.get(stockId);
    return point
      ? [
          {
            stockId,
            priceCents: String(point.priceCents),
            source: point.source,
            ageDays: point.ageDays,
          },
        ]
      : [];
  });
}

/** JSON has no BigInt. Cents are written as decimal strings and read back. */
function replaceBigInts(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __bigint: value.toString() } : value;
}

function reviveBigInts(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__bigint" in value) {
    return BigInt(String((value as { __bigint: string }).__bigint));
  }
  return value;
}
