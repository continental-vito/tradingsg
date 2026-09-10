"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "./palette";

export interface RankingSeries {
  participantId: string;
  name: string;
  points: { date: string; label: string; rank: number | null }[];
}

/**
 * Ranking over time for the leading participants.
 *
 * Capped at the categorical palette's eight slots — a ninth line would need a
 * hue that does not exist, and nine lines on one chart is unreadable anyway.
 * Every line is direct-labelled in the legend, which is also the relief the
 * light-mode palette requires.
 *
 * The y-axis is REVERSED: rank 1 belongs at the top. A rank chart that puts
 * first place at the bottom reads as the exact opposite of what happened.
 */
export function RankingHistory({ series, dates }: { series: RankingSeries[]; dates: string[] }) {
  if (series.length === 0 || dates.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-[var(--text-muted)]">
        Ranking history appears once there are at least two snapshots.
      </p>
    );
  }

  const shown = series.slice(0, 8);
  const maxRank = Math.max(...shown.flatMap((s) => s.points.map((p) => p.rank ?? 0)), shown.length);

  // Always 1, always the last rank, and a handful of round numbers between.
  const rankTicks = [
    1,
    ...[5, 10, 15, 20, 25, 30, 40, 50].filter((t) => t > 1 && t < maxRank),
    maxRank,
  ].filter((t, i, all) => all.indexOf(t) === i);

  const data = dates.map((date, i) => {
    const row: Record<string, string | number | null> = {
      date,
      label: shown[0]?.points[i]?.label ?? date.slice(5),
    };
    for (const s of shown) {
      row[s.participantId] = s.points[i]?.rank ?? null;
    }
    return row;
  });

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              reversed
              domain={[1, maxRank]}
              // Ticks are given explicitly so #1 is always labelled. Left to
              // pick its own, the axis started at #7 — on a chart whose entire
              // point is "first place is at the top", the top is the one tick
              // that must be readable.
              ticks={rankTicks}
              interval={0}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v: number) => `#${v}`}
            />
            <Tooltip
              cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const sorted = [...payload]
                  .filter((p) => p.value !== null && p.value !== undefined)
                  .sort((a, b) => Number(a.value) - Number(b.value));
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-sm">
                    <div className="mb-1 text-[var(--text-muted)]">{String(label)}</div>
                    {sorted.map((p) => {
                      const s = shown.find((x) => x.participantId === p.dataKey);
                      return (
                        <div key={String(p.dataKey)} className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 rounded-[2px]"
                            style={{ background: p.color }}
                          />
                          <span className="flex-1">{s?.name}</span>
                          <span className="tnum font-medium">#{String(p.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {shown.map((s, i) => (
              <Line
                key={s.participantId}
                type="monotone"
                dataKey={s.participantId}
                stroke={seriesColor(i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-raised)" }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {shown.map((s, i) => (
          <li key={s.participantId} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: seriesColor(i) }}
            />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
