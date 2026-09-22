"use client";

import { useState, useTransition, type ReactNode } from "react";
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

export interface SettingsFormValues {
  tradingMode: string;
  periodUnit: string;
  maxChangesPerPeriod: number;
  lockAfterDate: string;
  allowTradingBeforeStart: boolean;
  maxPositionPct: number;
  minPositionPct: number;
  minPositionEuros: number;
  minPositions: number;
  maxPositions: number;
  allowCash: boolean;
  minCashPct: number;
  maxCashPct: number;
  allowFractionalShares: boolean;
  minTradeEuros: number;
  minTradeShares: number;
  cashToleranceEuros: number;
  feeBps: number;
  feeFlatEuros: number;
  feeMinEuros: number;
  feeMaxEuros: number;
  priceMode: string;
  maxPriceStalenessDays: number;
  maxQuoteAgeSeconds: number;
  allowShort: boolean;
  allowNegativeCash: boolean;
  maxShortPositionPct: number;
  maxGrossExposurePct: number;
  weeklyReportEnabled: boolean;
  leaderboardVisibility: string;
  leaderboardTopN: number;
  showOthersHoldings: boolean;
  notifyCompetitionStart: boolean;
  notifySetupDeadline: boolean;
  notifyWeeklyReport: boolean;
  notifyEnteredTopThree: boolean;
  notifyOvertaken: boolean;
  notifyCompetitionEnd: boolean;
  revision: number;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-[var(--border)] pt-4">
      <legend className="sr-only">{title}</legend>
      <h3 className="text-sm font-medium">{title}</h3>
      {hint ? (
        <p className="mt-0.5 mb-3 text-xs text-[var(--text-muted)]">{hint}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </fieldset>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-accent-600"
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-[var(--text-muted)]">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Every rule the engine reads, in one form.
 *
 * Anything missing here is a rule the software enforces and nobody can change
 * without editing the database — and several of these were already being shown
 * to participants on the rules page, which made that page a description of
 * settings their administrator had no way to reach.
 */
export function CompetitionSettingsForm({
  competitionId,
  initial,
  save,
}: {
  competitionId: string;
  initial: SettingsFormValues;
  // Deliberately loose: the server action validates every field with Zod, and a
  // prop type that claimed the narrowed shape would be asserting exactly what
  // that validation exists to check.
  save: (input: never) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [f, setF] = useState(initial);
  const set = <K extends keyof SettingsFormValues>(k: K, v: SettingsFormValues[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  // step="any" by default, and never a step ladder anchored to a non-zero min.
  // With min={0.1} step={0.5} the browser's valid values are 0.1, 0.6, 1.1 …,
  // so a perfectly sensible 100% is a step mismatch — and the form then refuses
  // to submit with no message, no server request and nothing in any log. Every
  // one of these is validated properly by Zod on the server anyway.
  const num = (k: keyof SettingsFormValues, props: Record<string, unknown> = {}) => (
    <Input
      type="number"
      step="any"
      value={String(f[k])}
      onChange={(e) => set(k, Number(e.target.value) as never)}
      {...props}
    />
  );

  return (
    <div>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => save({ competitionId, ...f } as never));
        }}
      >
        <Section title="Trading" hint="When participants may change their portfolio.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode">
              <select
                value={f.tradingMode}
                onChange={(e) => set("tradingMode", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <option value="ANYTIME">Any time</option>
                <option value="ONCE_PER_PERIOD">A limited number of times per period</option>
                <option value="WINDOWS">Only during scheduled windows</option>
                <option value="LOCKED">Locked after setup</option>
              </select>
            </Field>
            <Field label="Period">
              <select
                value={f.periodUnit}
                disabled={f.tradingMode !== "ONCE_PER_PERIOD"}
                onChange={(e) => set("periodUnit", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm disabled:opacity-50"
              >
                <option value="DAY">Per day</option>
                <option value="WEEK">Per week</option>
                <option value="MONTH">Per month</option>
              </select>
            </Field>
            <Field label="Changes allowed per period">
              {num("maxChangesPerPeriod", {
                min: 1,
                max: 50,
                disabled: f.tradingMode !== "ONCE_PER_PERIOD",
              })}
            </Field>
            <Field label="Lock portfolios from" hint="Leave empty for no lock date.">
              <Input
                type="date"
                value={f.lockAfterDate}
                onChange={(e) => set("lockAfterDate", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Check
              label="Allow building a portfolio before the competition starts"
              checked={f.allowTradingBeforeStart}
              onChange={(v) => set("allowTradingBeforeStart", v)}
            />
          </div>
        </Section>

        <Section
          title="Position limits"
          hint="Checked against what a participant would actually hold after rounding, not against what they typed."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Largest single position (%)">
              {num("maxPositionPct", { min: 0.1, max: 100 })}
            </Field>
            <Field label="Smallest position (%)" hint="0 for no minimum.">
              {num("minPositionPct", { min: 0, max: 100 })}
            </Field>
            <Field label="Smallest position (€)" hint="0 for no minimum.">
              {num("minPositionEuros", { min: 0 })}
            </Field>
            <Field label="Fewest stocks" hint="0 for no minimum.">
              {num("minPositions", { min: 0, max: 50 })}
            </Field>
            <Field label="Most stocks" hint="0 for no maximum.">
              {num("maxPositions", { min: 0, max: 50 })}
            </Field>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Minimum cash (%)">{num("minCashPct", { min: 0, max: 100 })}</Field>
            <Field label="Maximum cash (%)">{num("maxCashPct", { min: 0, max: 100 })}</Field>
          </div>
          <div className="mt-3">
            <Check
              label="Participants may hold cash"
              hint="With this off, an allocation must invest everything within a €1 tolerance — whole shares make exactly zero impossible."
              checked={f.allowCash}
              onChange={(v) => set("allowCash", v)}
            />
          </div>
        </Section>

        <Section title="Shares and dust">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Smallest trade (€)"
              hint="Smaller changes are skipped rather than creating an order for nothing."
            >
              {num("minTradeEuros", { min: 0 })}
            </Field>
            <Field
              label="Smallest trade (shares)"
              hint="The other half of the dust guard. Without it a target of 33.33% churns a sliver every week forever."
            >
              {num("minTradeShares", { min: 0 })}
            </Field>
            <Field
              label="Cash tolerance (€)"
              hint="How much may be left over when cash is not allowed — whole shares make exactly zero impossible."
            >
              {num("cashToleranceEuros", { min: 0 })}
            </Field>
          </div>
          <div className="mt-3">
            <Check
              label="Fractional shares allowed"
              hint="With this off, amounts round down to whole shares and the remainder stays in cash."
              checked={f.allowFractionalShares}
              onChange={(v) => set("allowFractionalShares", v)}
            />
          </div>
        </Section>

        <Section
          title="Fees"
          hint="Fees come out of the portfolio, so trading often costs return. Set everything to zero for no fees."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Percentage (basis points)" hint="25 bps = 0.25%.">
              {num("feeBps", { min: 0, max: 1000 })}
            </Field>
            <Field label="Flat per order (€)">{num("feeFlatEuros", { min: 0 })}</Field>
            <Field label="Minimum fee (€)">{num("feeMinEuros", { min: 0 })}</Field>
            <Field label="Maximum fee (€)" hint="0 for no cap.">
              {num("feeMaxEuros", { min: 0 })}
            </Field>
          </div>
        </Section>

        <Section title="Pricing">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Participants' own figures">
              <select
                value={f.priceMode}
                onChange={(e) => set("priceMode", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <option value="LAST_CLOSE">The last close, same as the leaderboard</option>
                <option value="LIVE">The latest available price</option>
              </select>
            </Field>
            <Field label="Carry a price forward for at most (days)">
              {num("maxPriceStalenessDays", { min: 1, max: 365 })}
            </Field>
            <Field label="Refuse a quote older than (seconds)" hint="Only used in live mode.">
              {num("maxQuoteAgeSeconds", { min: 30, max: 86400 })}
            </Field>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            The leaderboard always uses the committed close, whichever of these is chosen, so
            everyone comparing standings sees identical numbers.
          </p>
        </Section>

        <Section
          title="Leaderboard and reports"
          hint="What participants can see, and whether the weekly email is produced at all."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who can see the leaderboard">
              <select
                value={f.leaderboardVisibility}
                onChange={(e) => set("leaderboardVisibility", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <option value="ALL">Everyone, in full</option>
                <option value="TOP_N">Everyone, but only the top few</option>
                <option value="ADMIN_ONLY">Administrators only</option>
              </select>
            </Field>
            <Field label="Places to show" hint="Used with “only the top few”.">
              {num("leaderboardTopN", {
                min: 1,
                max: 500,
                disabled: f.leaderboardVisibility !== "TOP_N",
              })}
            </Field>
          </div>
          <div className="mt-3 space-y-3">
            <Check
              label="Participants may open each other's portfolios"
              hint="From the leaderboard. Administrators always can."
              checked={f.showOthersHoldings}
              onChange={(v) => set("showOthersHoldings", v)}
            />
            <Check
              label="Produce the weekly report"
              hint="With this off, no report is built and nothing can be sent."
              checked={f.weeklyReportEnabled}
              onChange={(v) => set("weeklyReportEnabled", v)}
            />
          </div>
        </Section>

        <Section
          title="Notifications"
          hint="Participants can still opt out of each one individually."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Check
              label="The competition starts"
              checked={f.notifyCompetitionStart}
              onChange={(v) => set("notifyCompetitionStart", v)}
            />
            <Check
              label="Somebody has not built a portfolio"
              checked={f.notifySetupDeadline}
              onChange={(v) => set("notifySetupDeadline", v)}
            />
            <Check
              label="The weekly report is ready"
              checked={f.notifyWeeklyReport}
              onChange={(v) => set("notifyWeeklyReport", v)}
            />
            <Check
              label="Somebody reaches the top three"
              checked={f.notifyEnteredTopThree}
              onChange={(v) => set("notifyEnteredTopThree", v)}
            />
            <Check
              label="Somebody is overtaken"
              hint="Fires often; off by default."
              checked={f.notifyOvertaken}
              onChange={(v) => set("notifyOvertaken", v)}
            />
            <Check
              label="The competition is ending"
              checked={f.notifyCompetitionEnd}
              onChange={(v) => set("notifyCompetitionEnd", v)}
            />
          </div>
        </Section>

        <Section
          title="Short selling"
          hint="A long can only go to zero; a short can go to any price. These caps are what stop one participant turning the competition into a single unhedged bet nobody can catch up with."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Check
              label="Allow short positions"
              hint="Participants can then set a negative allocation, which sells a stock they do not hold."
              checked={f.allowShort}
              onChange={(v) => set("allowShort", v)}
            />
            <Check
              label="Allow a negative cash balance"
              hint="Borrowing. Off means every position is paid for out of what the portfolio holds."
              checked={f.allowNegativeCash}
              onChange={(v) => set("allowNegativeCash", v)}
            />
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Largest single short (%)" hint="Of portfolio value.">
              {num("maxShortPositionPct", { min: 0, max: 100, disabled: !f.allowShort })}
            </Field>
            <Field
              label="Total exposure cap (%)"
              hint="Longs plus shorts at their size. 100% means no leverage at all."
            >
              {num("maxGrossExposurePct", { min: 100, max: 500, disabled: !f.allowShort })}
            </Field>
          </div>
        </Section>

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

export function LiquidateStockButton({
  competitionId,
  stockId,
  symbol,
  holders,
  lastTradeDate,
  ageDays,
  liquidate,
}: {
  competitionId: string;
  stockId: string;
  symbol: string;
  holders: number;
  lastTradeDate: string | null;
  ageDays: number;
  liquidate: (competitionId: string, stockId: string) => Promise<ActionResult>;
}) {
  const { pending, result, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (result?.ok) return <span className="text-xs text-up-600">Liquidated</span>;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-down-600 hover:text-down-700"
      >
        Liquidate
      </button>
    );
  }

  return (
    <div className="text-right">
      <p className="mb-1.5 text-xs text-[var(--text-muted)]">
        Sells {symbol} for all {holders} holder{holders === 1 ? "" : "s"} at its last close
        {lastTradeDate ? ` on ${lastTradeDate}` : ""}, {ageDays} days ago. No fee. It cannot be
        bought afterwards, and this cannot be undone.
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
          onClick={() => run(() => liquidate(competitionId, stockId))}
          className="text-xs font-medium text-down-600"
        >
          {pending ? "Selling…" : "Liquidate for everyone"}
        </button>
      </div>
      <Feedback result={result} />
    </div>
  );
}
