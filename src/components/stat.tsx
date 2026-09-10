import type { ReactNode } from "react";
import type { MoneyDto, RatioDto } from "@/server/dto/serialize";

/** The one place a positive/negative figure picks its colour. */
export function toneClass(direction: -1 | 0 | 1): string {
  return direction > 0
    ? "text-up-600"
    : direction < 0
      ? "text-down-600"
      : "text-[var(--text-muted)]";
}

export function Stat({
  label,
  value,
  delta,
  ratio,
  hint,
}: {
  label: string;
  value: string;
  delta?: MoneyDto | null;
  ratio?: RatioDto | null;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
      <div className="tnum mt-1 text-xl font-semibold">{value}</div>
      {ratio ? (
        <div className={"tnum mt-0.5 text-sm font-medium " + toneClass(ratio.direction)}>
          {delta ? `${ratio.direction < 0 ? "−" : "+"}${stripSign(delta.text)} · ` : ""}
          {ratio.text}
        </div>
      ) : null}
      {hint ? <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div> : null}
    </div>
  );
}

/** The sign comes from the ratio's direction, so the amount must not carry one too. */
function stripSign(text: string): string {
  return text.replace(/^-/, "");
}
