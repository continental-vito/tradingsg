import { formatCents, formatPpm, formatShares, type Cents, type MicroShares } from "@/server/money";

/**
 * The BigInt boundary.
 *
 * Prisma returns `bigint` for every cents column, and `JSON.stringify` throws
 * on one — which will hit you in a server-action return value, an API route, a
 * log line, or a `console.log` of a Prisma object. Worse, the obvious fix,
 * `Number(someBigInt)`, silently loses precision above 2^53 and looks fine
 * until it does not.
 *
 * So there is exactly one conversion, here, and it emits both halves: the exact
 * value as a decimal string, and the formatted text the UI renders. A client
 * component never does money arithmetic, so it never needs the number.
 */

export interface MoneyDto {
  /** Exact, as a decimal string. Never parsed back into a Number for maths. */
  cents: string;
  /** Pre-formatted for display. */
  text: string;
  /**
   * A lossy Number, for chart geometry ONLY. A pixel position does not need
   * 64-bit precision, and every charting library takes numbers. Never use this
   * for a comparison, a total, or anything a participant reads as a figure.
   */
  plot: number;
}

export function money(cents: Cents, currency = "EUR"): MoneyDto {
  return {
    cents: cents.toString(),
    text: formatCents(cents, currency),
    plot: Number(cents),
  };
}

export interface RatioDto {
  ppm: number;
  text: string;
  /** -1, 0 or 1, so the UI picks a colour without re-deriving the sign. */
  direction: -1 | 0 | 1;
}

export function ratio(ppm: number): RatioDto {
  return {
    ppm,
    text: formatPpm(ppm),
    direction: ppm > 0 ? 1 : ppm < 0 ? -1 : 0,
  };
}

export interface SharesDto {
  micro: string;
  text: string;
}

export function shares(micro: MicroShares): SharesDto {
  return { micro: micro.toString(), text: formatShares(micro) };
}
