import { allocateWeightsPpm, marketValue, toPpm, type Cents } from "@/server/money";
import { MissingPriceError, type PriceBook, type PricePointSource } from "./prices";

/**
 * Valuing a portfolio. A pure function of state and a price book, with no
 * database access — which is what makes it reproducible, testable, and reusable
 * by the rebalance preview.
 */

export interface HoldingState {
  stockId: string;
  symbol: string;
  microShares: bigint;
  costBasisCents: Cents;
  realizedPnlCents?: Cents;
}

export interface PortfolioState {
  cashCents: Cents;
  holdings: HoldingState[];
  initialCapitalCents: Cents;
  netFlowCents?: Cents;
  realizedPnlCents?: Cents;
}

export interface HoldingValue {
  stockId: string;
  symbol: string;
  microShares: bigint;
  priceCents: Cents;
  priceSource: PricePointSource;
  priceAgeDays: number;
  marketValueCents: Cents;
  costBasisCents: Cents;
  unrealizedPnlCents: Cents;
  /** Largest-remainder allocated, so these plus cash sum to exactly 1_000_000. */
  weightPpm: number;
  positionReturnPpm: number;
}

export interface PortfolioValue {
  cashCents: Cents;
  holdingsValueCents: Cents;
  totalValueCents: Cents;
  costBasisCents: Cents;
  unrealizedPnlCents: Cents;
  realizedPnlCents: Cents;
  totalReturnPpm: number;
  cashWeightPpm: number;
  positionCount: number;
  holdings: HoldingValue[];
}

/**
 * `marketValue` is used here and in the sell leg of a rebalance. If those ever
 * diverge, fully liquidating a position moves the portfolio's value for free.
 */
export function valuePortfolio(state: PortfolioState, book: PriceBook): PortfolioValue {
  // Sorted by stock id before weights are allocated, so the largest-remainder
  // tie-break is deterministic across runs and machines.
  const held = [...state.holdings]
    .filter((h) => h.microShares > 0n)
    .sort((a, b) => a.stockId.localeCompare(b.stockId));

  const priced = held.map((h) => {
    const point = book.get(h.stockId);
    if (!point) throw new MissingPriceError(h.symbol, book.asOfDate);
    return { holding: h, point, value: marketValue(h.microShares, point.priceCents) };
  });

  const holdingsValueCents = priced.reduce((sum, p) => sum + p.value, 0n);
  const totalValueCents = state.cashCents + holdingsValueCents;

  // Cash is the last element so the weights cover the whole portfolio and sum
  // to exactly one million — no mystery sliver in the donut chart.
  const weights = allocateWeightsPpm(
    [...priced.map((p) => p.value), state.cashCents],
    totalValueCents,
  );
  const cashWeightPpm = weights[weights.length - 1] ?? 0;

  const holdings: HoldingValue[] = priced.map((p, i) => ({
    stockId: p.holding.stockId,
    symbol: p.holding.symbol,
    microShares: p.holding.microShares,
    priceCents: p.point.priceCents,
    priceSource: p.point.source,
    priceAgeDays: p.point.ageDays,
    marketValueCents: p.value,
    costBasisCents: p.holding.costBasisCents,
    unrealizedPnlCents: p.value - p.holding.costBasisCents,
    weightPpm: weights[i] ?? 0,
    positionReturnPpm: toPpm(p.value - p.holding.costBasisCents, p.holding.costBasisCents),
  }));

  const costBasisCents = holdings.reduce((sum, h) => sum + h.costBasisCents, 0n);
  const netFlowCents = state.netFlowCents ?? 0n;

  return {
    cashCents: state.cashCents,
    holdingsValueCents,
    totalValueCents,
    costBasisCents,
    unrealizedPnlCents: holdingsValueCents - costBasisCents,
    realizedPnlCents: state.realizedPnlCents ?? 0n,
    // Simple return is exact here because there are no external flows: every
    // participant is funded once and nothing is ever added. netFlow is in the
    // denominator anyway, so the formula stays correct the day an admin makes
    // an adjustment, rather than needing to be changed under pressure.
    totalReturnPpm: toPpm(
      totalValueCents - state.initialCapitalCents - netFlowCents,
      state.initialCapitalCents + netFlowCents,
    ),
    cashWeightPpm,
    positionCount: holdings.length,
    holdings,
  };
}

/** Return over a period, from two valuations. Flows in the period go in the base. */
export function periodReturnPpm(
  startValueCents: Cents,
  endValueCents: Cents,
  flowInPeriodCents: Cents = 0n,
): number {
  const base = startValueCents + flowInPeriodCents;
  return toPpm(endValueCents - startValueCents - flowInPeriodCents, base);
}

/**
 * Chain-linked time-weighted return.
 *
 * Identical to the simple return while there are no external flows, which is
 * the normal case — a test asserts exactly that. It exists so that the day
 * someone is credited, the leaderboard is already correct.
 *
 * Numerator and denominator accumulate separately and divide once, so 250 daily
 * sub-periods carry no compounding drift.
 */
export function chainLinkedTwrPpm(
  series: readonly { valueCents: Cents; flowCents: Cents }[],
): number {
  if (series.length < 2) return 0;
  let numerator = 1n;
  let denominator = 1n;
  for (let k = 1; k < series.length; k++) {
    const previous = series[k - 1];
    const current = series[k];
    if (!previous || !current) continue;
    const base = previous.valueCents + current.flowCents;
    // A sub-period starting from nothing has no defined return. Skipping it is
    // the only honest option — treating it as 0% would silently reset the chain.
    if (base <= 0n) continue;
    numerator *= current.valueCents;
    denominator *= base;
  }
  if (denominator === 0n) return 0;
  return toPpm(numerator - denominator, denominator);
}
