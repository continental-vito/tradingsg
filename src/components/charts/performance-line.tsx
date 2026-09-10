"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface PerformancePoint {
  date: string;
  valueCents: number;
  label: string;
}

export type RangeKey = "1D" | "1W" | "1M" | "ALL";

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "1D", label: "1D", days: 1 },
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
  { key: "ALL", label: "Competition", days: null },
];

/**
 * Portfolio value over time.
 *
 * ONE series, so there is no legend box — the card's title names it — and no
 * categorical colour is spent. The fill is a single accent hue at low opacity;
 * the line is 2px. The starting capital is drawn as a recessive reference line,
 * because "am I up or down" is the actual question and a bare value axis makes
 * the reader do that subtraction themselves.
 *
 * The y-axis does NOT start at zero. This is a value series around a known
 * baseline, not a magnitude comparison, and zeroing the axis would compress
 * every real movement into a flat line at the top of the plot.
 */
export function PerformanceLine({
  points,
  initialCapitalCents,
  currency,
  locale = "de-DE",
}: {
  points: PerformancePoint[];
  initialCapitalCents: number;
  currency: string;
  locale?: string;
}) {
  const [range, setRange] = useState<RangeKey>("ALL");

  // Formatting happens here rather than being handed down as a callback: a
  // function cannot cross the server/client boundary, and this is display only
  // — no money arithmetic is done on these numbers, which stay exact as strings
  // everywhere a participant reads them.
  const formatCents = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  const shown = days === null ? points : points.slice(Math.max(0, points.length - days - 1));

  const values = shown.map((p) => p.valueCents);
  const min = Math.min(initialCapitalCents, ...values);
  const max = Math.max(initialCapitalCents, ...values);
  const pad = Math.max((max - min) * 0.12, 1000);

  const last = shown[shown.length - 1]?.valueCents ?? initialCapitalCents;
  const first = shown[0]?.valueCents ?? initialCapitalCents;
  const up = last >= first;
  const stroke = up ? "var(--color-up-500)" : "var(--color-down-500)";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">Portfolio value</h2>
        <div
          role="group"
          aria-label="Time range"
          className="flex gap-0.5 rounded-lg bg-[var(--surface-sunken)] p-0.5"
        >
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (range === r.key
                  ? "bg-[var(--surface-raised)] text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length < 2 ? (
        <p className="py-12 text-center text-sm text-[var(--text-muted)]">
          Not enough history yet for this range. The chart fills in as the competition runs.
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={shown} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[min - pad, max + pad]}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
                axisLine={false}
                width={68}
                tickFormatter={(v: number) => formatCents(v)}
              />
              <ReferenceLine
                y={initialCapitalCents}
                stroke="var(--text-muted)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                label={{
                  value: "Start",
                  position: "insideTopLeft",
                  fill: "var(--text-muted)",
                  fontSize: 10,
                }}
              />
              <Tooltip
                cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as PerformancePoint | undefined;
                  if (!point) return null;
                  const delta = point.valueCents - initialCapitalCents;
                  return (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-sm">
                      <div className="text-[var(--text-muted)]">{point.label}</div>
                      <div className="tnum font-semibold">{formatCents(point.valueCents)}</div>
                      <div className={"tnum " + (delta >= 0 ? "text-up-600" : "text-down-600")}>
                        {delta >= 0 ? "+" : "−"}
                        {formatCents(Math.abs(delta))} since start
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="valueCents"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#perf-fill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-raised)" }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
