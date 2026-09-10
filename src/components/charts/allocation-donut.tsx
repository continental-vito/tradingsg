"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Slice } from "./palette";

/**
 * Portfolio allocation.
 *
 * A donut is normally the wrong form — angle is hard to compare and a pie with
 * twelve slices is unreadable. It earns its place here for two reasons: the
 * question really is part-to-whole against a fixed 100%, and the legend beside
 * it carries the actual percentages, so nobody has to judge an angle. The tail
 * is folded into one "Other" slice upstream so the slice count stays legible.
 *
 * The legend is the direct-label relief the palette check requires: three of
 * the light-mode series steps sit below 3:1 against the surface, so identity is
 * never left to colour alone. The holdings table below is the table view.
 */
export function AllocationDonut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: Slice[];
  centerLabel: string;
  centerValue: string;
}) {
  const data = slices.map((s) => ({ ...s, value: s.weightPpm }));

  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,200px)_1fr] sm:items-center">
      <div className="relative mx-auto aspect-square w-full max-w-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              // A 2px surface gap between segments, so adjacent fills read as
              // separate marks rather than one continuous band.
              paddingAngle={1.5}
              stroke="var(--surface-raised)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const slice = payload[0]?.payload as (typeof data)[number] | undefined;
                if (!slice) return null;
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium">{slice.label}</div>
                    <div className="tnum text-[var(--text-muted)]">
                      {(slice.weightPpm / 10_000).toFixed(1)}%
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-[var(--text-muted)]">{centerLabel}</span>
          <span className="tnum text-lg font-semibold">{centerValue}</span>
        </div>
      </div>

      <ul className="space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="tnum text-[var(--text-muted)]">
              {(slice.weightPpm / 10_000).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
