"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { ActionResult } from "@/app/actions/admin";

/** Shared feedback strip, so every admin form reports the same way. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
    });

  return { pending, result, run };
}

function Feedback({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className="mt-3">
      {result.ok ? <Alert tone="success">{result.message}</Alert> : <Alert>{result.error}</Alert>}
    </div>
  );
}

export function ParticipantActions({
  participantId,
  userId,
  status,
  isDisabled,
  setStatus,
  setDisabled,
}: {
  participantId: string;
  userId: string;
  status: string;
  isDisabled: boolean;
  setStatus: (
    id: string,
    status: "ACTIVE" | "WITHDRAWN" | "DISQUALIFIED",
    reason?: string,
  ) => Promise<ActionResult>;
  setDisabled: (userId: string, disabled: boolean) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== "DISQUALIFIED" ? (
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={pending}
            onClick={() =>
              run(() =>
                setStatus(participantId, "DISQUALIFIED", "Disqualified by an administrator"),
              )
            }
          >
            Disqualify
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={pending}
            onClick={() => run(() => setStatus(participantId, "ACTIVE"))}
          >
            Reinstate
          </Button>
        )}
        <Button
          variant={isDisabled ? "secondary" : "danger"}
          className="px-2.5 py-1.5 text-xs"
          disabled={pending}
          onClick={() => run(() => setDisabled(userId, !isDisabled))}
        >
          {isDisabled ? "Re-enable account" : "Disable account"}
        </Button>
      </div>
      <Feedback result={result} />
    </div>
  );
}

export function AddStockForm({
  competitionId,
  addStock,
}: {
  competitionId: string;
  addStock: (input: {
    competitionId: string;
    symbol: string;
    name: string;
    sector?: string;
  }) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");

  return (
    <div>
      <form
        className="grid gap-3 sm:grid-cols-[120px_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await addStock({
              competitionId,
              symbol,
              name,
              sector: sector || undefined,
            });
            if (r.ok) {
              setSymbol("");
              setName("");
              setSector("");
            }
            return r;
          });
        }}
      >
        <Field label="Ticker">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            required
            maxLength={12}
          />
        </Field>
        <Field label="Company">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apple"
            required
          />
        </Field>
        <Field label="Sector">
          <Input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Technology"
          />
        </Field>
        <Button type="submit" disabled={pending || !symbol || !name}>
          {pending ? "Adding…" : "Add stock"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}

export function RemoveStockButton({
  competitionId,
  stockId,
  symbol,
  holders,
  removeStock,
}: {
  competitionId: string;
  stockId: string;
  symbol: string;
  holders: number;
  removeStock: (competitionId: string, stockId: string) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (result?.ok) return <span className="text-xs text-up-600">Removed</span>;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-down-600 hover:text-down-700"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="text-right">
      <p className="mb-1.5 text-xs text-[var(--text-muted)]">
        {holders > 0
          ? `${holders} still hold ${symbol}. They keep it and can sell; nobody can buy more.`
          : `Remove ${symbol} from the tradable list?`}
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-[var(--text-muted)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => removeStock(competitionId, stockId))}
          className="text-xs font-medium text-down-600"
        >
          {pending ? "Removing…" : "Confirm"}
        </button>
      </div>
      <Feedback result={result} />
    </div>
  );
}

export function CompetitionSettingsForm({
  competitionId,
  initial,
  save,
}: {
  competitionId: string;
  initial: {
    tradingMode: string;
    maxChangesPerPeriod: number;
    maxPositionPct: number;
    minPositionPct: number;
    allowCash: boolean;
    allowFractionalShares: boolean;
    feeBps: number;
    revision: number;
  };
  save: (input: {
    competitionId: string;
    tradingMode: "ANYTIME" | "ONCE_PER_PERIOD" | "WINDOWS" | "LOCKED";
    maxChangesPerPeriod: number;
    maxPositionPct: number;
    minPositionPct: number;
    allowCash: boolean;
    allowFractionalShares: boolean;
    feeBps: number;
  }) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [form, setForm] = useState(initial);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            save({
              competitionId,
              tradingMode: form.tradingMode as "ANYTIME",
              maxChangesPerPeriod: form.maxChangesPerPeriod,
              maxPositionPct: form.maxPositionPct,
              minPositionPct: form.minPositionPct,
              allowCash: form.allowCash,
              allowFractionalShares: form.allowFractionalShares,
              feeBps: form.feeBps,
            }),
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When participants may trade">
            <select
              value={form.tradingMode}
              onChange={(e) => set("tradingMode", e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
            >
              <option value="ANYTIME">Any time</option>
              <option value="ONCE_PER_PERIOD">A limited number of times per week</option>
              <option value="WINDOWS">Only during scheduled windows</option>
              <option value="LOCKED">Locked after setup</option>
            </select>
          </Field>
          <Field
            label="Changes allowed per week"
            hint={
              form.tradingMode === "ONCE_PER_PERIOD" ? undefined : "Only used in the limited mode."
            }
          >
            <Input
              type="number"
              min={1}
              max={50}
              value={form.maxChangesPerPeriod}
              onChange={(e) => set("maxChangesPerPeriod", Number(e.target.value))}
              disabled={form.tradingMode !== "ONCE_PER_PERIOD"}
            />
          </Field>
          <Field label="Largest single position (%)">
            <Input
              type="number"
              min={1}
              max={100}
              step={1}
              value={form.maxPositionPct}
              onChange={(e) => set("maxPositionPct", Number(e.target.value))}
            />
          </Field>
          <Field label="Smallest position (%)" hint="0 to allow any size.">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={form.minPositionPct}
              onChange={(e) => set("minPositionPct", Number(e.target.value))}
            />
          </Field>
          <Field label="Transaction fee (basis points)" hint="25 bps is 0.25% of each order.">
            <Input
              type="number"
              min={0}
              max={1000}
              value={form.feeBps}
              onChange={(e) => set("feeBps", Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowCash}
              onChange={(e) => set("allowCash", e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Participants may hold cash
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowFractionalShares}
              onChange={(e) => set("allowFractionalShares", e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Fractional shares allowed
          </label>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Saving writes revision {initial.revision + 1}. The current rules are kept, so a rebalance
          made last week can still be checked against the rules that were live last week.
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save rules"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}
