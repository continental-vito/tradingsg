import {
  divRound,
  feeFor,
  formatCents,
  marketValue,
  purchaseCost,
  sharesFor,
  toPpm,
  PPM,
  type Cents,
  type FeeConfig,
  type MicroShares,
} from "@/server/money";
import type { PriceBook } from "./prices";
import type { PortfolioState } from "./value";

/**
 * Turning "I want 20% Apple" into buy and sell orders.
 *
 * planRebalance is PURE — no database, no clock beyond what is passed in. That
 * is what lets the "see the impact before confirming" preview show exactly what
 * will be committed: the preview and the commit run this same function over the
 * same frozen quotes, so there is no re-quote in between and no drift.
 */

export interface RebalanceTarget {
  stockId: string;
  weightPpm: number;
}

export interface TradingRules {
  minPositionPpm: number;
  maxPositionPpm: number;
  minPositionCents: Cents;
  minPositions: number;
  maxPositions: number | null;
  allowCash: boolean;
  minCashPpm: number;
  maxCashPpm: number;
  cashToleranceCents: Cents;
  allowFractionalShares: boolean;
  minTradeMicroShares: MicroShares;
  minTradeValueCents: Cents;
  fees: FeeConfig;
  /** Per-stock overrides of maxPositionPpm, from CompetitionStock. */
  maxWeightOverridesPpm?: Map<string, number>;
  /** Stocks that may be sold or held but not bought (soft-removed from the universe). */
  notBuyable?: ReadonlySet<string>;
  /** Everything tradable in this competition. A target outside it is an error. */
  universe: ReadonlySet<string>;
}

export type Severity = "ERROR" | "WARNING";

export interface ValidationIssue {
  code: string;
  message: string;
  severity: Severity;
  stockId?: string;
  symbol?: string;
}

export interface PlannedOrder {
  side: "SELL" | "BUY";
  stockId: string;
  symbol: string;
  microShares: MicroShares;
  priceCents: Cents;
  grossCents: Cents;
  feeCents: Cents;
  cashDeltaCents: Cents;
  costAddedCents: Cents;
  costRemovedCents: Cents;
  realizedPnlCents: Cents;
  prevWeightPpm: number;
  newWeightPpm: number;
  wasScaledDown: boolean;
}

export interface ProjectedHolding {
  stockId: string;
  symbol: string;
  microShares: MicroShares;
  costBasisCents: Cents;
  marketValueCents: Cents;
  weightPpm: number;
}

export interface RebalancePlan {
  orders: PlannedOrder[];
  preValueCents: Cents;
  postValueCents: Cents;
  totalFeeCents: Cents;
  /** Value lost to integer rounding, separate from fees, so the UI can name both. */
  roundingDragCents: Cents;
  projectedCashCents: Cents;
  projectedCashWeightPpm: number;
  projectedHoldings: ProjectedHolding[];
  warnings: ValidationIssue[];
}

export type PlanResult =
  { ok: true; plan: RebalancePlan } | { ok: false; errors: ValidationIssue[] };

function pct(ppm: number): string {
  return `${(ppm / 10_000).toFixed(ppm % 10_000 === 0 ? 0 : 1)}%`;
}

/**
 * How many micro-shares fit in `cash` once the fee is paid.
 *
 * The fee depends on the cost and the cost depends on the share count, so this
 * iterates. Each pass shrinks the count monotonically and the fee is monotone
 * in cost, so four passes converge comfortably; failing to converge returns
 * zero rather than looping.
 */
function fitBuyToCash(
  micro: MicroShares,
  priceCents: Cents,
  cash: Cents,
  rules: TradingRules,
): MicroShares {
  let m = micro;
  for (let i = 0; i < 4; i++) {
    const cost = purchaseCost(m, priceCents);
    const fee = feeFor(cost, rules.fees);
    if (cost + fee <= cash) return m;
    const budget = cash - fee;
    if (budget <= 0n) return 0n;
    m = sharesFor(budget, priceCents, { fractional: rules.allowFractionalShares });
    if (m === 0n) return 0n;
  }
  return 0n;
}

export function planRebalance(args: {
  state: PortfolioState;
  targets: RebalanceTarget[];
  book: PriceBook;
  rules: TradingRules;
  symbolOf: (stockId: string) => string;
}): PlanResult {
  const { state, targets, book, rules, symbolOf } = args;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const err = (code: string, message: string, stockId?: string): void => {
    errors.push({
      code,
      message,
      severity: "ERROR",
      ...(stockId ? { stockId, symbol: symbolOf(stockId) } : {}),
    });
  };
  const warn = (code: string, message: string, stockId?: string): void => {
    warnings.push({
      code,
      message,
      severity: "WARNING",
      ...(stockId ? { stockId, symbol: symbolOf(stockId) } : {}),
    });
  };

  // ── Validate the request itself ──────────────────────────────────────────
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.stockId)) {
      err("DUPLICATE_STOCK", `${symbolOf(t.stockId)} appears twice in your allocation.`, t.stockId);
    }
    seen.add(t.stockId);
    if (t.weightPpm < 0) {
      err(
        "NEGATIVE_WEIGHT",
        `The allocation for ${symbolOf(t.stockId)} cannot be negative — short selling is not allowed in this competition.`,
        t.stockId,
      );
    }
    if (!rules.universe.has(t.stockId)) {
      err(
        "STOCK_NOT_IN_UNIVERSE",
        `${symbolOf(t.stockId)} is not part of this competition's stock list.`,
        t.stockId,
      );
    }
  }

  const totalWeight = targets.reduce((sum, t) => sum + Math.max(0, t.weightPpm), 0);
  if (totalWeight > Number(PPM)) {
    err(
      "WEIGHTS_EXCEED_100",
      `Your allocations add up to ${pct(totalWeight)}. Reduce them by ${pct(totalWeight - Number(PPM))} before confirming.`,
    );
  }

  const targetCashPpm = Number(PPM) - totalWeight;
  if (!rules.allowCash && targetCashPpm > 0) {
    err(
      "CASH_NOT_ALLOWED",
      `You must invest all of your capital. ${pct(targetCashPpm)} is currently unallocated.`,
    );
  }
  if (rules.allowCash && targetCashPpm < rules.minCashPpm) {
    err(
      "CASH_BELOW_MIN",
      `You must keep at least ${pct(rules.minCashPpm)} in cash. Your plan leaves ${pct(targetCashPpm)}.`,
    );
  }
  if (rules.allowCash && targetCashPpm > rules.maxCashPpm) {
    err(
      "CASH_ABOVE_MAX",
      `You can hold at most ${pct(rules.maxCashPpm)} in cash. Your plan leaves ${pct(targetCashPpm)}.`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  // ── Value at execution prices ────────────────────────────────────────────
  const bySymbol = (id: string) => symbolOf(id);
  const current = new Map(state.holdings.map((h) => [h.stockId, { ...h }]));
  const involved = new Set([...current.keys(), ...targets.map((t) => t.stockId)]);

  const priceOf = new Map<string, Cents>();
  for (const stockId of involved) {
    const point = book.get(stockId);
    if (!point || point.priceCents <= 0n) {
      err(
        "NO_PRICE_AVAILABLE",
        `We do not have a current price for ${bySymbol(stockId)}, so it cannot be traded right now. Try again in a few minutes.`,
        stockId,
      );
      continue;
    }
    priceOf.set(stockId, point.priceCents);
  }
  if (errors.length > 0) return { ok: false, errors };

  let cash = state.cashCents;
  let holdingsValue = 0n;
  for (const h of current.values()) {
    holdingsValue += marketValue(h.microShares, priceOf.get(h.stockId) ?? 0n);
  }
  const preValueCents = cash + holdingsValue;

  if (preValueCents <= 0n) {
    return {
      ok: false,
      errors: [
        {
          code: "PORTFOLIO_EMPTY",
          message: "This portfolio has no value to allocate.",
          severity: "ERROR",
        },
      ],
    };
  }

  // ── Target share counts ──────────────────────────────────────────────────
  const targetMicro = new Map<string, MicroShares>();
  for (const t of targets) {
    const price = priceOf.get(t.stockId);
    if (!price) continue;
    // Floor at both steps, so the plan under-invests by a few cents rather than
    // over-committing. Under is the safe direction: it can never overdraw.
    const targetValue = (preValueCents * BigInt(Math.max(0, t.weightPpm))) / PPM;
    targetMicro.set(
      t.stockId,
      sharesFor(targetValue, price, { fractional: rules.allowFractionalShares }),
    );
  }
  // A held stock absent from the targets is a full exit, not "leave it alone".
  for (const stockId of current.keys()) {
    if (!targetMicro.has(stockId)) targetMicro.set(stockId, 0n);
  }

  // ── Deltas, with the dust guard ──────────────────────────────────────────
  interface Leg {
    stockId: string;
    delta: bigint;
    price: Cents;
  }
  const legs: Leg[] = [];
  for (const [stockId, target] of targetMicro) {
    const price = priceOf.get(stockId);
    if (!price) continue;
    const held = current.get(stockId)?.microShares ?? 0n;
    const delta = target - held;
    if (delta === 0n) continue;

    const magnitude = delta < 0n ? -delta : delta;
    const notional = marketValue(magnitude, price);
    // Without this, a target of 33.33% produces a one-micro-share trade every
    // week forever, each with a fee and a ledger row.
    if (magnitude < rules.minTradeMicroShares || notional < rules.minTradeValueCents) {
      warn(
        "TRADE_BELOW_MINIMUM",
        `The change to ${bySymbol(stockId)} is only ${formatCents(notional)}, below the ${formatCents(rules.minTradeValueCents)} minimum trade size, so it has been skipped.`,
        stockId,
      );
      continue;
    }
    if (delta > 0n && rules.notBuyable?.has(stockId)) {
      err(
        "STOCK_NOT_TRADABLE",
        `${bySymbol(stockId)} has been suspended from trading. You can keep or sell your position, but not buy more.`,
        stockId,
      );
      continue;
    }
    legs.push({ stockId, delta, price });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Sells first, largest first; then buys, largest first. Selling first
  // guarantees the cash exists for the buys — no margin, no intermediate
  // negative balance, no simultaneous system to solve. Largest-first within
  // each group means a cash shortfall scales the least important buy.
  legs.sort((a, b) => {
    const aSell = a.delta < 0n;
    const bSell = b.delta < 0n;
    if (aSell !== bSell) return aSell ? -1 : 1;
    const aSize = marketValue(a.delta < 0n ? -a.delta : a.delta, a.price);
    const bSize = marketValue(b.delta < 0n ? -b.delta : b.delta, b.price);
    return bSize > aSize ? 1 : bSize < aSize ? -1 : a.stockId.localeCompare(b.stockId);
  });

  // ── Simulate ─────────────────────────────────────────────────────────────
  const orders: PlannedOrder[] = [];
  let totalFeeCents = 0n;

  const weightOf = (value: Cents, total: Cents): number => toPpm(value, total);

  for (const leg of legs) {
    const holding = current.get(leg.stockId) ?? {
      stockId: leg.stockId,
      symbol: bySymbol(leg.stockId),
      microShares: 0n,
      costBasisCents: 0n,
    };
    const prevWeightPpm = weightOf(marketValue(holding.microShares, leg.price), preValueCents);

    if (leg.delta < 0n) {
      const micro = -leg.delta;
      const gross = marketValue(micro, leg.price);
      const fee = feeFor(gross, rules.fees);
      const proceedsNet = gross - fee;
      // The full-liquidation short-circuit. Pro-rata rounding would otherwise
      // leave ±1 cent of basis on a zero-share holding, which reads as infinite
      // unrealised P/L and breaks the reconciliation.
      const costRemoved =
        micro === holding.microShares
          ? holding.costBasisCents
          : divRound(holding.costBasisCents * micro, holding.microShares);

      holding.microShares -= micro;
      holding.costBasisCents -= costRemoved;
      cash += proceedsNet;
      totalFeeCents += fee;
      current.set(leg.stockId, holding);

      orders.push({
        side: "SELL",
        stockId: leg.stockId,
        symbol: bySymbol(leg.stockId),
        microShares: micro,
        priceCents: leg.price,
        grossCents: gross,
        feeCents: fee,
        cashDeltaCents: proceedsNet,
        costAddedCents: 0n,
        costRemovedCents: costRemoved,
        realizedPnlCents: proceedsNet - costRemoved,
        prevWeightPpm,
        newWeightPpm: 0,
        wasScaledDown: false,
      });
    } else {
      const wanted = leg.delta;
      const affordable = fitBuyToCash(wanted, leg.price, cash, rules);
      if (affordable === 0n) {
        warn(
          "INSUFFICIENT_CASH",
          `After fees there was not enough cash left for the ${bySymbol(leg.stockId)} order, so it has been skipped.`,
          leg.stockId,
        );
        continue;
      }
      if (affordable < wanted) {
        warn(
          "BUY_SCALED_DOWN",
          `After fees there was not enough cash for the full ${bySymbol(leg.stockId)} order, so it has been reduced to ${formatCents(marketValue(affordable, leg.price))}.`,
          leg.stockId,
        );
      }

      const gross = purchaseCost(affordable, leg.price);
      const fee = feeFor(gross, rules.fees);
      const costAdded = gross + fee;

      holding.microShares += affordable;
      holding.costBasisCents += costAdded;
      cash -= costAdded;
      totalFeeCents += fee;
      current.set(leg.stockId, holding);

      orders.push({
        side: "BUY",
        stockId: leg.stockId,
        symbol: bySymbol(leg.stockId),
        microShares: affordable,
        priceCents: leg.price,
        grossCents: gross,
        feeCents: fee,
        cashDeltaCents: -costAdded,
        costAddedCents: costAdded,
        costRemovedCents: 0n,
        realizedPnlCents: 0n,
        prevWeightPpm,
        newWeightPpm: 0,
        wasScaledDown: affordable < wanted,
      });
    }
  }

  // ── Project the end state and validate against IT, not the request ───────
  // Floor rounding and whole-share constraints mean a request for exactly 25%
  // lands at 24.97%. Validating the input would let a plan through that then
  // breaches the cap, or reject one that does not.
  let projectedHoldingsValue = 0n;
  const projected: ProjectedHolding[] = [];
  for (const holding of [...current.values()].sort((a, b) => a.stockId.localeCompare(b.stockId))) {
    if (holding.microShares <= 0n) continue;
    const price = priceOf.get(holding.stockId) ?? 0n;
    const value = marketValue(holding.microShares, price);
    projectedHoldingsValue += value;
    projected.push({
      stockId: holding.stockId,
      symbol: bySymbol(holding.stockId),
      microShares: holding.microShares,
      costBasisCents: holding.costBasisCents,
      marketValueCents: value,
      weightPpm: 0,
    });
  }

  const postValueCents = cash + projectedHoldingsValue;
  for (const p of projected) p.weightPpm = weightOf(p.marketValueCents, postValueCents);
  const projectedCashWeightPpm = weightOf(cash, postValueCents);
  for (const order of orders) {
    const holding = current.get(order.stockId);
    order.newWeightPpm = holding
      ? weightOf(marketValue(holding.microShares, order.priceCents), postValueCents)
      : 0;
  }

  for (const p of projected) {
    const cap = rules.maxWeightOverridesPpm?.get(p.stockId) ?? rules.maxPositionPpm;
    if (p.weightPpm > cap) {
      err(
        "POSITION_ABOVE_MAX",
        `${p.symbol} would be ${pct(p.weightPpm)} of your portfolio. The competition caps any single stock at ${pct(cap)}.`,
        p.stockId,
      );
    }
    if (p.weightPpm < rules.minPositionPpm) {
      err(
        "POSITION_BELOW_MIN",
        `${p.symbol} would be ${pct(p.weightPpm)} of your portfolio. Positions must be at least ${pct(rules.minPositionPpm)} — increase it, or remove it entirely.`,
        p.stockId,
      );
    }
    if (p.marketValueCents < rules.minPositionCents) {
      err(
        "POSITION_BELOW_MIN_VALUE",
        `${p.symbol} would be ${formatCents(p.marketValueCents)}. The minimum position is ${formatCents(rules.minPositionCents)}.`,
        p.stockId,
      );
    }
  }

  if (rules.maxPositions !== null && projected.length > rules.maxPositions) {
    err(
      "TOO_MANY_POSITIONS",
      `You would hold ${projected.length} stocks. The maximum is ${rules.maxPositions}.`,
    );
  }
  if (projected.length < rules.minPositions) {
    err(
      "TOO_FEW_POSITIONS",
      `You would hold ${projected.length} stock${projected.length === 1 ? "" : "s"}. At least ${rules.minPositions} are required.`,
    );
  }
  if (!rules.allowCash && cash > rules.cashToleranceCents) {
    err(
      "CASH_NOT_ALLOWED",
      `${formatCents(cash)} would be left uninvested, above the ${formatCents(rules.cashToleranceCents)} allowed.`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  if (orders.length === 0) {
    warn("NO_CHANGES", "Your target allocation already matches your portfolio. Nothing to do.");
  }
  // The cash the requested weights actually asked for. Anything above it is
  // whole-share rounding, and the participant should be told the number rather
  // than left to work out why 100% invested left €5 behind.
  const intendedCashCents = (preValueCents * BigInt(Math.max(0, targetCashPpm))) / PPM;
  if (!rules.allowFractionalShares && cash - intendedCashCents > rules.minTradeValueCents) {
    warn(
      "FRACTIONAL_NOT_ALLOWED",
      `This competition trades whole shares only, so ${formatCents(cash - intendedCashCents)} could not be invested and stays in cash.`,
    );
  }
  if (totalFeeCents > 0n && toPpm(totalFeeCents, preValueCents) >= 5_000) {
    warn(
      "HIGH_FEE_IMPACT",
      `This rebalance costs ${formatCents(totalFeeCents)} in fees — ${pct(toPpm(totalFeeCents, preValueCents))} of your portfolio.`,
    );
  }

  return {
    ok: true,
    plan: {
      orders,
      preValueCents,
      postValueCents,
      totalFeeCents,
      // Everything the portfolio lost that was not a fee is integer rounding.
      // Naming the two separately is what lets the preview say "€48 in fees,
      // €0.02 in rounding" instead of an unexplained shortfall.
      roundingDragCents: preValueCents - postValueCents - totalFeeCents,
      projectedCashCents: cash,
      projectedCashWeightPpm,
      projectedHoldings: projected,
      warnings,
    },
  };
}
