/**
 * The categorical slot order, read from CSS custom properties so light and dark
 * resolve from one definition.
 *
 * Assigned in FIXED ORDER and never cycled. A ninth holding does not get a
 * generated ninth hue — the caller folds the tail into "Other", which is what
 * `topNWithOther` below is for. Cash is not a series at all: it gets the
 * neutral, because it is the absence of a position rather than one more of them.
 */
export const SERIES_SLOTS = 8;

export function seriesColor(index: number): string {
  // Clamped rather than wrapped. Wrapping would give slot 9 the same colour as
  // slot 1 and quietly make two holdings indistinguishable.
  const slot = Math.min(index, SERIES_SLOTS - 1) + 1;
  return `var(--color-series-${slot})`;
}

export const CASH_COLOR = "var(--chart-cash)";
export const OTHER_COLOR = "var(--chart-other)";

export interface Slice {
  key: string;
  label: string;
  valueCents: string;
  weightPpm: number;
  color: string;
}

/**
 * Keeps the largest `limit` entries and folds the rest into one "Other" slice,
 * so the chart never needs a hue it does not have.
 */
export function topNWithOther<T>(
  items: readonly T[],
  limit: number,
  read: (item: T) => { key: string; label: string; valueCents: bigint; weightPpm: number },
): Slice[] {
  const mapped = items.map(read).sort((a, b) => b.weightPpm - a.weightPpm);
  const head = mapped.slice(0, limit);
  const tail = mapped.slice(limit);

  const slices: Slice[] = head.map((item, i) => ({
    key: item.key,
    label: item.label,
    valueCents: item.valueCents.toString(),
    weightPpm: item.weightPpm,
    color: seriesColor(i),
  }));

  if (tail.length > 0) {
    slices.push({
      key: "__other",
      label: `${tail.length} more`,
      valueCents: tail.reduce((s, i) => s + i.valueCents, 0n).toString(),
      weightPpm: tail.reduce((s, i) => s + i.weightPpm, 0),
      color: OTHER_COLOR,
    });
  }
  return slices;
}
