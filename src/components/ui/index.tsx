import type { ComponentProps, ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
  ...rest
}: ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      {...rest}
      className={cx(
        "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium " +
    "transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500";
  const variants = {
    primary: "bg-accent-600 text-white hover:bg-accent-700",
    secondary:
      "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)] hover:bg-[var(--surface-sunken)]",
    ghost: "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]",
    danger: "bg-down-600 text-white hover:bg-down-700",
  } as const;
  return <button {...rest} className={cx(base, variants[variant], className)} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--text)]">{label}</span>
      {children}
      {/* The hint is hidden once there is an error: two competing explanations
          of the same field is how people re-submit the same wrong value. */}
      {error ? (
        <span className="mt-1.5 block text-sm text-down-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return (
    <input
      {...rest}
      className={cx(
        "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm",
        "text-[var(--text)] placeholder:text-[var(--text-muted)]",
        "focus:border-accent-500 focus:outline-2 focus:outline-offset-0 focus:outline-accent-500/40",
        className,
      )}
    />
  );
}

/** A single positive/negative figure. The sign and the colour always agree. */
export function Delta({
  ppm,
  children,
  className,
}: {
  ppm: number;
  children: ReactNode;
  className?: string;
}) {
  const tone = ppm > 0 ? "text-up-600" : ppm < 0 ? "text-down-600" : "text-[var(--text-muted)]";
  return <span className={cx("tnum font-medium", tone, className)}>{children}</span>;
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
}) {
  const tones = {
    error: "border-down-500/30 bg-down-50 text-down-700",
    info: "border-accent-500/30 bg-accent-50 text-accent-700",
    success: "border-up-500/30 bg-up-50 text-up-700",
  } as const;
  return (
    <div role="alert" className={cx("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <p className="text-base font-medium text-[var(--text)]">{title}</p>
      <p className="max-w-md text-sm text-[var(--text-muted)]">{body}</p>
      {action}
    </div>
  );
}
