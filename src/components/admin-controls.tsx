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

export function AdjustPortfolioForm({
  portfolioId,
  cashText,
  adjust,
}: {
  portfolioId: string;
  cashText: string;
  adjust: (input: {
    portfolioId: string;
    amountCents: string;
    reason: string;
  }) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        Adjusts cash only. Starting capital is never edited — total return is measured against it,
        and an administrator who could change that denominator could hand someone a rank. The
        adjustment is written to the ledger as an external flow, so it is excluded from the
        participant&rsquo;s return rather than counted as performance, and their portfolio is
        flagged. Currently holding {cashText}.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await adjust({
              portfolioId,
              amountCents: String(Math.round(Number(amount) * 100)),
              reason,
            });
            if (r.ok) {
              setAmount("");
              setReason("");
            }
            return r;
          });
        }}
      >
        <Field label="Amount" hint="Negative to debit.">
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="-250.00"
            required
          />
        </Field>
        <Field label="Reason" hint="Written into the audit trail.">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Correcting a duplicated fee"
            required
            minLength={3}
          />
        </Field>
        <Button type="submit" variant="danger" disabled={pending || !amount || reason.length < 3}>
          {pending ? "Recording…" : "Record adjustment"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}

const STATUSES = [
  { value: "DRAFT", label: "Draft", what: "Nobody can see or join it." },
  {
    value: "REGISTRATION",
    label: "Registration open",
    what: "People can join and build portfolios; trading has not started.",
  },
  { value: "RUNNING", label: "Running", what: "Trading is open and portfolios are valued daily." },
  { value: "PAUSED", label: "Paused", what: "Trading is refused; valuations continue." },
  { value: "ENDED", label: "Ended", what: "Final standings. Portfolios can no longer change." },
] as const;

export function CompetitionForm({
  competition,
  save,
}: {
  competition: {
    id: string;
    name: string;
    description: string;
    status: string;
    registrationOpen: boolean;
    startDate: string;
    endDate: string;
    hasValuations: boolean;
  };
  save: (input: {
    competitionId: string;
    name: string;
    description?: string;
    status: "DRAFT" | "REGISTRATION" | "RUNNING" | "PAUSED" | "ENDED";
    registrationOpen: boolean;
    startDate: string;
    endDate: string;
  }) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [form, setForm] = useState(competition);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const current = STATUSES.find((s) => s.value === form.status);

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            save({
              competitionId: competition.id,
              name: form.name,
              description: form.description || undefined,
              status: form.status as "RUNNING",
              registrationOpen: form.registrationOpen,
              startDate: form.startDate,
              endDate: form.endDate,
            }),
          );
        }}
      >
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>

        <Field label="Description" hint="Shown on the landing page and the competition page.">
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Starts"
            hint={
              competition.hasValuations
                ? "Locked — portfolios have already been valued against this date."
                : undefined
            }
          >
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              disabled={competition.hasValuations}
              required
            />
          </Field>
          <Field label="Ends">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        {current ? <p className="-mt-2 text-xs text-[var(--text-muted)]">{current.what}</p> : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.registrationOpen}
            onChange={(e) => set("registrationOpen", e.target.checked)}
            className="size-4 accent-accent-600"
          />
          Accept new participants
        </label>
        <p className="-mt-2 text-xs text-[var(--text-muted)]">
          Registering an account always works; this controls whether it joins this competition.
          Closing it mid-competition stops late entries without locking anybody out.
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save competition"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}

export function CreateCompetitionForm({
  copyStocksFrom,
  create,
}: {
  copyStocksFrom?: { id: string; name: string; stockCount: number };
  create: (input: {
    name: string;
    slug: string;
    description?: string;
    startDate: string;
    endDate: string;
    startingCapitalEuros: number;
    timezone: string;
    copyStocksFrom?: string;
  }) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capital, setCapital] = useState(100_000);
  const [copyStocks, setCopyStocks] = useState(true);

  const slugify = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await create({
              name,
              slug: slug || slugify(name),
              startDate,
              endDate,
              startingCapitalEuros: capital,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
              ...(copyStocks && copyStocksFrom ? { copyStocksFrom: copyStocksFrom.id } : {}),
            });
            if (r.ok) {
              setName("");
              setSlug("");
            }
            return r;
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug("");
              }}
              placeholder="Spring 2027 Stock Challenge"
              required
            />
          </Field>
          <Field label="Address" hint="Used in links. Letters, numbers and hyphens.">
            <Input
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder={slugify(name) || "spring-2027"}
            />
          </Field>
          <Field label="Starts">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Ends">
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Starting capital (€ per person)">
            <Input
              type="number"
              min={1}
              step={1000}
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        {copyStocksFrom ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copyStocks}
              onChange={(e) => setCopyStocks(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Copy the {copyStocksFrom.stockCount} stocks from {copyStocksFrom.name}
          </label>
        ) : null}

        <p className="text-xs text-[var(--text-muted)]">
          Created as a draft with default rules and nobody able to join. Add or adjust stocks, set
          the rules, then open registration.
        </p>

        <Button type="submit" disabled={pending || !name || !startDate || !endDate}>
          {pending ? "Creating…" : "Create competition"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}

export function TradingWindows({
  competitionId,
  windows,
  mode,
  create,
  remove,
}: {
  competitionId: string;
  windows: { id: string; label: string; opensAt: string; closesAt: string; isOpenNow: boolean }[];
  mode: string;
  create: (input: {
    competitionId: string;
    label: string;
    opensAt: string;
    closesAt: string;
  }) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [label, setLabel] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");

  const relevant = mode === "WINDOWS";

  return (
    <div>
      {relevant && windows.length === 0 ? (
        <div className="mb-4">
          <Alert>
            Trading is set to windows only and none are scheduled, so{" "}
            <strong>nobody can trade at all</strong>. Add one below, or change the mode above.
          </Alert>
        </div>
      ) : null}

      {!relevant ? (
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          These only take effect when the trading mode is “only during scheduled windows”. They are
          kept either way, so switching to that mode does not lose them.
        </p>
      ) : null}

      {windows.length > 0 ? (
        <ul className="mb-4 divide-y divide-[var(--border)]">
          {windows.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <div>
                <span className="text-sm font-medium">{w.label}</span>
                {w.isOpenNow ? (
                  <span className="ml-2 rounded bg-up-50 px-1.5 py-0.5 text-xs font-medium text-up-700">
                    open now
                  </span>
                ) : null}
                <div className="tnum text-xs text-[var(--text-muted)]">
                  {w.opensAt} → {w.closesAt}
                </div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => remove(w.id))}
                className="text-xs font-medium text-down-600 hover:text-down-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await create({ competitionId, label, opensAt, closesAt });
            if (r.ok) {
              setLabel("");
              setOpensAt("");
              setClosesAt("");
            }
            return r;
          });
        }}
      >
        <Field label="Name">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Monday morning"
            required
            maxLength={60}
          />
        </Field>
        <Field label="Opens">
          <Input
            type="datetime-local"
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
            required
          />
        </Field>
        <Field label="Closes">
          <Input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            required
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || !label || !opensAt || !closesAt}
        >
          Add window
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}
