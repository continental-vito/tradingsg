import {
  absShares,
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
  /** Negative target weights are refused unless this is on. */
  allowShort: boolean;
  /** Largest single short, as ppm of portfolio value. */
  maxShortPositionPpm: number;
  /** Longs plus the magnitude of shorts, capped. 1_000_000 means no leverage. */
  maxGrossExposurePpm: number;
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
  /** A sale that opens or increases a short rather than reducing a holding. */
  opensShort: boolean;
  /** A purchase that buys back a short rather than opening a holding. */
  closesShort: boolean;
}

export interface ProjectedHolding {
  stockId: string;
  symbol: string;
  /** Negative for a short. */
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
    if (t.weightPpm < 0 && !rules.allowShort) {
      err(
        "NEGATIVE_WEIGHT",
        `The allocation for ${symbolOf(t.stockId)} cannot be negative — short selling is not allowed in this competition.`,
        t.stockId,
      );
    }
    if (t.weightPpm < 0 && -t.weightPpm > rules.maxShortPositionPpm) {
      err(
        "SHORT_ABOVE_MAX",
        `Shorting ${pct(-t.weightPpm)} of ${symbolOf(t.stockId)} is more than the ${pct(rules.maxShortPositionPpm)} this competition allows in one short. A short can lose more than it makes, which is why it is capped tighter than a holding.`,
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

  // NET decides how much cash is left: shorting releases cash, so 110% long and
  // 10% short still leaves nothing uninvested. GROSS decides how much exposure
  // that is, which is the number the risk cap is about.
  const netWeight = targets.reduce((sum, t) => sum + t.weightPpm, 0);
  const grossWeight = targets.reduce((sum, t) => sum + Math.abs(t.weightPpm), 0);

  if (netWeight > Number(PPM)) {
    err(
      "WEIGHTS_EXCEED_100",
      `Your allocations add up to ${pct(netWeight)}. Reduce them by ${pct(netWeight - Number(PPM))} before confirming.`,
    );
  }
  if (grossWeight > rules.maxGrossExposurePpm) {
    err(
      "GROSS_EXPOSURE_EXCEEDED",
      `Your positions add up to ${pct(grossWeight)} of your portfolio once shorts are counted at their size. This competition allows ${pct(rules.maxGrossExposurePpm)}.`,
    );
  }

  // The cash rules are about how much is left UNINVESTED, and a short's
  // proceeds are not that: they sit against the liability as collateral. So
  // shorting 20% raises the cash balance to 120% while leaving exactly as much
  // uninvested as before, and capping the raw balance would refuse every short
  // for a reason that has nothing to do with the participant's choice.
  //
  // Free cash is therefore everything not committed to a LONG. With no shorts
  // it is identical to the balance, so nothing about a long-only competition
  // changes.
  const longWeight = targets.reduce((sum, t) => sum + Math.max(0, t.weightPpm), 0);
  const freeCashPpm = Number(PPM) - longWeight;

  if (!rules.allowCash && freeCashPpm > 0) {
    err(
      "CASH_NOT_ALLOWED",
      `You must invest all of your capital. ${pct(freeCashPpm)} is currently unallocated.`,
    );
  }
  if (rules.allowCash && freeCashPpm < rules.minCashPpm) {
    err(
      "CASH_BELOW_MIN",
      `You must keep at least ${pct(rules.minCashPpm)} uninvested. Your plan leaves ${pct(freeCashPpm)}.`,
    );
  }
  if (rules.allowCash && freeCashPpm > rules.maxCashPpm) {
    err(
      "CASH_ABOVE_MAX",
      `You can leave at most ${pct(rules.maxCashPpm)} uninvested. Your plan leaves ${pct(freeCashPpm)}.`,
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
    // over-committing. Under is the safe direction: it can never overdraw, and
    // for a short it means never opening one larger than was asked for.
    const targetValue = (preValueCents * BigInt(t.weightPpm)) / PPM;
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

  // Any leg that crosses zero is TWO economic events, not one: going from ten
  // long to five short is selling ten and then shorting five, and they have
  // different cost bases, different realised P/L and different signs. Split
  // them here so the simulation below only ever handles one thing at a time.
  interface Step {
    stockId: string;
    price: Cents;
    /** Signed change in shares for this step alone. */
    delta: bigint;
    /** Reducing an existing position toward zero, rather than opening one. */
    closing: boolean;
  }

  const steps: Step[] = [];
  for (const leg of legs) {
    const held = current.get(leg.stockId)?.microShares ?? 0n;
    const target = held + leg.delta;
    const crossesZero = held !== 0n && held > 0n !== target > 0n && target !== 0n;

    if (crossesZero) {
      steps.push({ stockId: leg.stockId, price: leg.price, delta: -held, closing: true });
      steps.push({ stockId: leg.stockId, price: leg.price, delta: target, closing: false });
    } else {
      // Reducing toward zero when the step moves against the position's sign.
      const closing = held !== 0n && held > 0n !== leg.delta > 0n;
      steps.push({ stockId: leg.stockId, price: leg.price, delta: leg.delta, closing });
    }
  }

  // Cash-raising steps first, cash-spending after. With shorting that is no
  // longer "sells before buys": a short sale RAISES cash and covering one
  // SPENDS it. Ordering by what a step does to the balance is what keeps cash
  // from going negative at any point, with no margin and no simultaneous system
  // to solve. Largest first within each group, so a shortfall scales the
  // smallest, least important order.
  const raisesCash = (step: Step) => step.delta < 0n;
  steps.sort((a, b) => {
    if (raisesCash(a) !== raisesCash(b)) return raisesCash(a) ? -1 : 1;
    const aSize = marketValue(absShares(a.delta), a.price);
    const bSize = marketValue(absShares(b.delta), b.price);
    return bSize > aSize ? 1 : bSize < aSize ? -1 : a.stockId.localeCompare(b.stockId);
  });

  // ── Simulate ─────────────────────────────────────────────────────────────
  const orders: PlannedOrder[] = [];
  let totalFeeCents = 0n;

  const weightOf = (value: Cents, total: Cents): number => toPpm(value, total);

  for (const step of steps) {
    const holding = current.get(step.stockId) ?? {
      stockId: step.stockId,
      symbol: bySymbol(step.stockId),
      microShares: 0n,
      costBasisCents: 0n,
    };
    const prevWeightPpm = weightOf(marketValue(holding.microShares, step.price), preValueCents);
    const magnitude = absShares(step.delta);
    if (magnitude === 0n) continue;

    if (step.delta < 0n) {
      // Shares leave: either selling a long, or opening/increasing a short.
      // Both raise cash, and both are a SELL in the ledger.
      const gross = marketValue(magnitude, step.price);
      const fee = feeFor(gross, rules.fees);
      const proceedsNet = gross - fee;

      let costRemoved = 0n;
      let costAdded = 0n;
      if (step.closing) {
        // The full-close short-circuit. Pro-rata rounding would otherwise leave
        // ±1 cent of basis on a zero-share holding, which reads as infinite
        // unrealised P/L and breaks the reconciliation.
        costRemoved =
          magnitude === holding.microShares
            ? holding.costBasisCents
            : divRound(holding.costBasisCents * magnitude, holding.microShares);
      } else {
        // Opening a short: the proceeds are a NEGATIVE basis. The position is
        // then worth marketValue (negative) against a negative basis, so the
        // unrealised P/L starts at minus the fee — exactly as a long does.
        costAdded = -proceedsNet;
      }

      holding.microShares -= magnitude;
      holding.costBasisCents += costAdded - costRemoved;
      cash += proceedsNet;
      totalFeeCents += fee;
      current.set(step.stockId, holding);

      orders.push({
        side: "SELL",
        stockId: step.stockId,
        symbol: bySymbol(step.stockId),
        microShares: magnitude,
        priceCents: step.price,
        grossCents: gross,
        feeCents: fee,
        cashDeltaCents: proceedsNet,
        costAddedCents: costAdded,
        costRemovedCents: costRemoved,
        realizedPnlCents: step.closing ? proceedsNet - costRemoved : 0n,
        prevWeightPpm,
        newWeightPpm: 0,
        wasScaledDown: false,
        opensShort: !step.closing,
        closesShort: false,
      });
    } else {
      // Shares arrive: either buying a long, or covering a short. Both spend
      // cash, and both are a BUY in the ledger.
      const wanted = magnitude;
      const affordable = fitBuyToCash(wanted, step.price, cash, rules);
      if (affordable === 0n) {
        warn(
          step.closing ? "INSUFFICIENT_CASH_TO_COVER" : "INSUFFICIENT_CASH",
          step.closing
            ? `There was not enough cash to buy back the ${bySymbol(step.stockId)} short, so it has been left open.`
            : `After fees there was not enough cash left for the ${bySymbol(step.stockId)} order, so it has been skipped.`,
          step.stockId,
        );
        continue;
      }
      if (affordable < wanted) {
        warn(
          "BUY_SCALED_DOWN",
          `After fees there was not enough cash for the full ${bySymbol(step.stockId)} order, so it has been reduced to ${formatCents(marketValue(affordable, step.price))}.`,
          step.stockId,
        );
      }

      const gross = purchaseCost(affordable, step.price);
      const fee = feeFor(gross, rules.fees);
      const outlay = gross + fee;

      let costRemoved = 0n;
      let costAdded = 0n;
      if (step.closing) {
        // Covering a short. The basis being removed is negative, so realised
        // P/L is the outlay netted against the credit taken when it was opened:
        // short at 100 and buy back at 80 realises a gain, which is the whole
        // point of the position.
        const shortSize = -holding.microShares;
        costRemoved =
          affordable === shortSize
            ? holding.costBasisCents
            : divRound(holding.costBasisCents * affordable, shortSize);
      } else {
        costAdded = outlay;
      }

      holding.microShares += affordable;
      holding.costBasisCents += costAdded - costRemoved;
      cash -= outlay;
      totalFeeCents += fee;
      current.set(step.stockId, holding);

      orders.push({
        side: "BUY",
        stockId: step.stockId,
        symbol: bySymbol(step.stockId),
        microShares: affordable,
        priceCents: step.price,
        grossCents: gross,
        feeCents: fee,
        cashDeltaCents: -outlay,
        costAddedCents: costAdded,
        costRemovedCents: costRemoved,
        realizedPnlCents: step.closing ? -outlay - costRemoved : 0n,
        prevWeightPpm,
        newWeightPpm: 0,
        wasScaledDown: affordable < wanted,
        opensShort: false,
        closesShort: step.closing,
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
    // Zero is closed; anything else, long or short, is a position.
    if (holding.microShares === 0n) continue;
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

  // Checked on the PROJECTED end state, and on magnitude: a 25% short is a 25%
  // position even though its weight is -25%. Reading the signed number here
  // would let any short through every cap.
  let projectedGrossPpm = 0;
  for (const p of projected) {
    const isShort = p.microShares < 0n;
    const sizePpm = Math.abs(p.weightPpm);
    projectedGrossPpm += sizePpm;

    if (isShort) {
      if (sizePpm > rules.maxShortPositionPpm) {
        err(
          "SHORT_ABOVE_MAX",
          `Shorting ${pct(sizePpm)} of ${p.symbol} is more than the ${pct(rules.maxShortPositionPpm)} this competition allows in one short.`,
          p.stockId,
        );
      }
      // A short is not checked against the long minimums: "at least 2% of the
      // portfolio" makes no sense as a floor on a liability.
      continue;
    }

    const cap = rules.maxWeightOverridesPpm?.get(p.stockId) ?? rules.maxPositionPpm;
    if (sizePpm > cap) {
      err(
        "POSITION_ABOVE_MAX",
        `${p.symbol} would be ${pct(sizePpm)} of your portfolio. The competition caps any single stock at ${pct(cap)}.`,
        p.stockId,
      );
    }
    if (sizePpm < rules.minPositionPpm) {
      err(
        "POSITION_BELOW_MIN",
        `${p.symbol} would be ${pct(sizePpm)} of your portfolio. Positions must be at least ${pct(rules.minPositionPpm)} — increase it, or remove it entirely.`,
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

  if (projectedGrossPpm > rules.maxGrossExposurePpm) {
    err(
      "GROSS_EXPOSURE_EXCEEDED",
      `Your positions would come to ${pct(projectedGrossPpm)} of your portfolio once shorts are counted at their size. This competition allows ${pct(rules.maxGrossExposurePpm)}.`,
    );
  }

  // A portfolio whose shorts have swallowed it has no meaningful return, and
  // the ranking has no sensible answer for a negative denominator.
  if (postValueCents <= 0n) {
    err(
      "PORTFOLIO_WOULD_BE_WORTHLESS",
      "That combination would leave your portfolio worth nothing or less. Reduce the shorts.",
    );
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
  // Free cash again: the balance minus whatever is standing against the shorts.
  const shortLiability = projected
    .filter((p) => p.microShares < 0n)
    .reduce((sum, p) => sum - p.marketValueCents, 0n);
  const freeCash = cash - shortLiability;

  if (!rules.allowCash && freeCash > rules.cashToleranceCents) {
    err(
      "CASH_NOT_ALLOWED",
      `${formatCents(freeCash)} would be left uninvested, above the ${formatCents(rules.cashToleranceCents)} allowed.`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  if (orders.length === 0) {
    warn("NO_CHANGES", "Your target allocation already matches your portfolio. Nothing to do.");
  }
  // The cash the requested weights actually asked for. Anything above it is
  // whole-share rounding, and the participant should be told the number rather
  // than left to work out why 100% invested left €5 behind.
  const intendedCashCents = (preValueCents * BigInt(Math.max(0, freeCashPpm))) / PPM;
  if (!rules.allowFractionalShares && freeCash - intendedCashCents > rules.minTradeValueCents) {
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
