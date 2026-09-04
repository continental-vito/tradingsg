/**
 * The only place monetary units are converted. Nothing else in the codebase may
 * multiply or divide a cents value.
 *
 * THE ROUNDING RULE, STATED ONCE:
 *
 *   Market value and sale proceeds FLOOR.
 *   Purchase cost and fees CEIL.
 *   Reported ratios round half-away-from-zero.
 *   Nothing else rounds.
 *
 * The asymmetry is deliberate and directional. Every rounding decision costs the
 * participant at most one cent and never pays them, so a buy immediately
 * followed by a sell at the same price loses at most two cents plus fees and can
 * never gain. Rounding cannot be farmed for return.
 *
 * `marketValue` is used BOTH to value a holding and to compute sale proceeds.
 * If those used different rounding, fully liquidating a position would move the
 * portfolio's value by up to a cent per position for free — which is exactly the
 * kind of free money that shows up three weeks later as an unexplained
 * leaderboard position.
 */

/** Micro-shares per whole share. Fractional shares are exact at 1e-6. */
export const MICRO = 1_000_000n;

/** Parts per million. +7.43% is 74_300 ppm. */
export const PPM = 1_000_000n;

/** Basis points, for fee configuration. 25 bps = 0.25%. */
export const BPS = 10_000n;

/** Cents. Always an integer; never a float, never a Number. */
export type Cents = bigint;

/** Micro-shares. 1 share = 1_000_000. */
export type MicroShares = bigint;

export class MoneyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Market value of a long position, and the gross proceeds of selling it. FLOOR.
 *
 * BigInt division truncates toward zero, which is floor for the non-negative
 * quantities this takes — so the guard below is what makes that claim true
 * rather than merely usually true.
 */
export function marketValue(micro: MicroShares, priceCents: Cents): Cents {
  if (micro < 0n) throw new MoneyError("marketValue: negative share count", "NEGATIVE_SHARES");
  if (priceCents < 0n) throw new MoneyError("marketValue: negative price", "NEGATIVE_PRICE");
  return (micro * priceCents) / MICRO;
}

/** Cash cost of a purchase. CEIL — never let a buy spend a cent it did not have. */
export function purchaseCost(micro: MicroShares, priceCents: Cents): Cents {
  if (micro < 0n) throw new MoneyError("purchaseCost: negative share count", "NEGATIVE_SHARES");
  if (priceCents < 0n) throw new MoneyError("purchaseCost: negative price", "NEGATIVE_PRICE");
  return (micro * priceCents + MICRO - 1n) / MICRO;
}

/**
 * How many micro-shares `amountCents` buys at `priceCents`. FLOOR, so the
 * remainder stays in cash. Optionally floored to whole shares.
 */
export function sharesFor(
  amountCents: Cents,
  priceCents: Cents,
  { fractional = true }: { fractional?: boolean } = {},
): MicroShares {
  if (priceCents <= 0n) throw new MoneyError("sharesFor: price must be positive", "ZERO_PRICE");
  if (amountCents <= 0n) return 0n;
  const micro = (amountCents * MICRO) / priceCents;
  return fractional ? micro : (micro / MICRO) * MICRO;
}

/**
 * Half-away-from-zero division. Used for every reported ratio and every
 * pro-rata split, so that -0.5 rounds to -1 and 0.5 rounds to 1 — symmetric,
 * unlike BigInt's truncation, which would bias every negative return upward.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("divRound: divide by zero", "DIVIDE_BY_ZERO");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/**
 * A ratio in parts per million, as a JS number. Always well within Int range:
 * ±1_000_000_000 ppm is ±100,000%, far beyond anything a portfolio can do.
 * Returns 0 for a zero denominator rather than throwing — a portfolio worth
 * nothing has a return of nothing, and that is a display value, not an error.
 */
export function toPpm(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number(divRound(part * PPM, whole));
}

export interface FeeConfig {
  feeModel: "NONE" | "FLAT" | "PERCENT" | "PERCENT_WITH_MIN";
  feeFlatCents: Cents;
  feeBps: number;
  feeMinCents: Cents;
  feeMaxCents: Cents | null;
}

/** Fee on a notional amount. CEIL, then clamped to the configured bounds. */
export function feeFor(notionalCents: Cents, config: FeeConfig): Cents {
  if (config.feeModel === "NONE") return 0n;
  if (notionalCents < 0n) throw new MoneyError("feeFor: negative notional", "NEGATIVE_NOTIONAL");

  let fee: Cents;
  if (config.feeModel === "FLAT") {
    fee = config.feeFlatCents;
  } else {
    const percent = (notionalCents * BigInt(config.feeBps) + BPS - 1n) / BPS;
    fee = percent + config.feeFlatCents;
  }

  if (config.feeModel === "PERCENT_WITH_MIN" && fee < config.feeMinCents) {
    fee = config.feeMinCents;
  }
  if (config.feeMaxCents !== null && fee > config.feeMaxCents) {
    fee = config.feeMaxCents;
  }
  return fee;
}

/**
 * Distribute weights so they sum to exactly PPM, using the largest-remainder
 * method.
 *
 * The naive `value * PPM / total` per position sums to somewhere between
 * 999_993 and 1_000_000, and the donut chart then shows an unexplained sliver
 * of nothing. Pass cash as the last element so the result covers the whole
 * portfolio.
 *
 * Ties in the remainder break by array index, and callers sort by stock id
 * before calling, so the output is identical on every run and every machine.
 */
export function allocateWeightsPpm(values: readonly bigint[], total: bigint): number[] {
  if (values.length === 0) return [];
  if (total <= 0n) return values.map(() => 0);

  const base = values.map((v) => (v * PPM) / total);
  const remainders = values.map((v, i) => v * PPM - (base[i] ?? 0n) * total);
  const assigned = base.reduce((a, b) => a + b, 0n);
  const short = Number(PPM - assigned);

  const out = base.map(Number);
  if (short <= 0) return out;

  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));

  for (let k = 0; k < short && k < order.length; k++) {
    const idx = order[k]?.i;
    if (idx !== undefined) out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

// ── Display helpers ──────────────────────────────────────────────────────────
// Formatting only. These never feed back into a calculation.

export function formatCents(cents: Cents, currency = "EUR", locale = "de-DE"): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  const body = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(whole) + Number(fraction) / 100);
  return negative ? `-${body}` : body;
}

/** 74_300 ppm -> "+7.43%". */
export function formatPpm(ppm: number, digits = 2): string {
  const percent = ppm / 10_000;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(digits)}%`;
}

/** 1_500_000 micro-shares -> "1.5". Trailing zeros trimmed. */
export function formatShares(micro: MicroShares, maxDigits = 4): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  const frac = abs % MICRO;
  const fracStr = frac.toString().padStart(6, "0").slice(0, maxDigits).replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${body}` : body;
}
