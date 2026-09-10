"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { CASH_COLOR, seriesColor, type Slice } from "@/components/charts/palette";
import { Alert, Button, Card } from "@/components/ui";
import type { PlanPreview } from "@/app/actions/portfolio";

export interface AllocatableStock {
  id: string;
  symbol: string;
  name: string;
  sector: string | null;
  priceText: string;
  priceCents: string;
  currentWeightPpm: number;
}

const PPM = 1_000_000;

/**
 * The allocation interface.
 *
 * It edits PERCENTAGES and nothing else. Share counts, values and the resulting
 * orders are all computed on the server and shown back — the browser never
 * decides what a portfolio is worth, and the estimate below each row is
 * explicitly labelled as one.
 *
 * Cash is a row in the table rather than an invisible remainder. The brief
 * requires the total to be exactly 100% and the remainder shown prominently;
 * making cash explicit is what lets both be true at once without forcing anyone
 * to hunt for the missing 3%.
 */
export function AllocationEditor({
  portfolioId,
  stocks,
  currency,
  totalValueCents,
  totalValueText,
  maxPositionPpm,
  allowCash,
  preview,
  submit,
}: {
  portfolioId: string;
  stocks: AllocatableStock[];
  currency: string;
  totalValueCents: string;
  totalValueText: string;
  maxPositionPpm: number;
  allowCash: boolean;
  preview: (portfolioId: string, targets: unknown) => Promise<PlanPreview>;
  submit: (
    portfolioId: string,
    targets: unknown,
    key?: string,
  ) => Promise<{ ok: boolean; errors: { code: string; message: string }[] }>;
}) {
  const router = useRouter();
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(stocks.map((s) => [s.id, s.currentWeightPpm])),
  );
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Minted once per editor instance, so a double-click on Confirm replays
  // rather than trading twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const allocated = useMemo(() => Object.values(weights).reduce((a, b) => a + b, 0), [weights]);
  const cashPpm = PPM - allocated;
  const overAllocated = allocated > PPM;
  const canSubmit = !overAllocated && (allowCash || cashPpm === 0) && allocated > 0;

  const total = BigInt(totalValueCents);
  const money = new Intl.NumberFormat("de-DE", { style: "currency", currency });

  const setWeight = (id: string, ppm: number) => {
    setWeights((w) => ({ ...w, [id]: Math.max(0, Math.min(PPM, Math.round(ppm))) }));
    setPlan(null);
    setSubmitError(null);
  };

  const held = stocks
    .filter((s) => (weights[s.id] ?? 0) > 0)
    .sort((a, b) => (weights[b.id] ?? 0) - (weights[a.id] ?? 0));

  const slices: Slice[] = held.slice(0, 8).map((s, i) => ({
    key: s.id,
    label: s.symbol,
    valueCents: "0",
    weightPpm: weights[s.id] ?? 0,
    color: seriesColor(i),
  }));
  if (held.length > 8) {
    slices.push({
      key: "__other",
      label: `${held.length - 8} more`,
      valueCents: "0",
      weightPpm: held.slice(8).reduce((sum, s) => sum + (weights[s.id] ?? 0), 0),
      color: "var(--chart-other)",
    });
  }
  if (cashPpm > 0) {
    slices.push({
      key: "__cash",
      label: "Cash",
      valueCents: "0",
      weightPpm: cashPpm,
      color: CASH_COLOR,
    });
  }

  const targets = () =>
    Object.entries(weights)
      .filter(([, ppm]) => ppm > 0)
      .map(([stockId, weightPpm]) => ({ stockId, weightPpm }));

  const onPreview = () =>
    startTransition(async () => {
      setSubmitError(null);
      setPlan(await preview(portfolioId, targets()));
    });

  const onConfirm = () =>
    startTransition(async () => {
      const result = await submit(portfolioId, targets(), idempotencyKey);
      if (result.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setSubmitError(result.errors[0]?.message ?? "That change could not be saved. Try again.");
        setPlan(null);
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="w-[36%] px-3 py-2.5 font-medium">Allocation</th>
                  <th className="px-4 py-2.5 text-right font-medium">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => {
                  const ppm = weights[stock.id] ?? 0;
                  const amountCents = (total * BigInt(ppm)) / BigInt(PPM);
                  const priceCents = BigInt(stock.priceCents);
                  const estShares = priceCents > 0n ? Number(amountCents) / Number(priceCents) : 0;
                  const overCap = ppm > maxPositionPpm;

                  return (
                    <tr key={stock.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{stock.symbol}</div>
                        <div className="text-xs text-[var(--text-muted)]">{stock.name}</div>
                      </td>
                      <td className="tnum px-3 py-3 text-right whitespace-nowrap">
                        {stock.priceText}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={Math.min(maxPositionPpm, PPM)}
                            step={5_000}
                            value={Math.min(ppm, maxPositionPpm)}
                            onChange={(e) => setWeight(stock.id, Number(e.target.value))}
                            aria-label={`${stock.symbol} allocation`}
                            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent-600"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={Number((ppm / 10_000).toFixed(1))}
                              onChange={(e) => setWeight(stock.id, Number(e.target.value) * 10_000)}
                              aria-label={`${stock.symbol} percentage`}
                              className={
                                "tnum w-16 rounded-md border bg-[var(--surface)] px-2 py-1 text-right text-sm " +
                                (overCap
                                  ? "border-down-500 text-down-600"
                                  : "border-[var(--border)]")
                              }
                            />
                            <span className="text-xs text-[var(--text-muted)]">%</span>
                          </div>
                        </div>
                        {overCap ? (
                          <p className="mt-1 text-xs text-down-600">
                            Above the {(maxPositionPpm / 10_000).toFixed(0)}% cap for one stock.
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="tnum">{money.format(Number(amountCents) / 100)}</div>
                        <div className="tnum text-xs text-[var(--text-muted)]">
                          ≈ {estShares.toFixed(2)} shares
                        </div>
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-[var(--surface-sunken)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">Cash</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      Whatever you do not allocate
                    </div>
                  </td>
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3">
                    <span
                      className={
                        "tnum text-sm font-medium " +
                        (cashPpm < 0 ? "text-down-600" : "text-[var(--text-muted)]")
                      }
                    >
                      {(cashPpm / 10_000).toFixed(1)}%
                    </span>
                  </td>
                  <td className="tnum px-4 py-3 text-right">
                    {money.format(
                      Number((total * BigInt(Math.max(0, cashPpm))) / BigInt(PPM)) / 100,
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {plan?.summary ? <PlanSummary plan={plan} /> : null}
      </div>

      <div className="space-y-4 lg:sticky lg:top-6">
        <Card>
          <div className="text-sm text-[var(--text-muted)]">To allocate</div>
          <div className="tnum mt-1 text-2xl font-semibold">{totalValueText}</div>

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[var(--text-muted)]">Remaining</span>
              <span
                className={
                  "tnum text-2xl font-semibold " +
                  (overAllocated
                    ? "text-down-600"
                    : cashPpm === 0
                      ? "text-up-600"
                      : "text-[var(--text)]")
                }
              >
                {(cashPpm / 10_000).toFixed(1)}%
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
              role="progressbar"
              aria-valuenow={Math.round(allocated / 10_000)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={
                  "h-full rounded-full transition-all " +
                  (overAllocated ? "bg-down-500" : "bg-accent-600")
                }
                style={{ width: `${Math.min(100, allocated / 10_000)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {overAllocated
                ? `You have allocated ${(allocated / 10_000).toFixed(1)}%. Reduce by ${((allocated - PPM) / 10_000).toFixed(1)}%.`
                : cashPpm === 0
                  ? "Fully allocated."
                  : allowCash
                    ? "The remainder stays in cash, which is allowed in this competition."
                    : `This competition requires you to invest everything. Allocate the remaining ${(cashPpm / 10_000).toFixed(1)}%.`}
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-[var(--text-muted)]">Your allocation</h2>
          {slices.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing allocated yet. Move a slider to begin.
            </p>
          ) : (
            <AllocationDonut
              slices={slices}
              centerLabel="Stocks"
              centerValue={String(held.length)}
            />
          )}
        </Card>

        {submitError ? <Alert>{submitError}</Alert> : null}
        {plan && plan.errors.length > 0 ? (
          <Alert>
            <ul className="space-y-1.5">
              {plan.errors.map((e) => (
                <li key={e.code + (e.symbol ?? "")}>{e.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          {plan?.summary && plan.ok ? (
            <Button onClick={onConfirm} disabled={pending}>
              {pending ? "Saving…" : "Confirm these changes"}
            </Button>
          ) : (
            <Button onClick={onPreview} disabled={!canSubmit || pending}>
              {pending ? "Checking…" : "Preview changes"}
            </Button>
          )}
          {plan ? (
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={pending}>
              Keep editing
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlanSummary({ plan }: { plan: PlanPreview }) {
  const summary = plan.summary;
  if (!summary) return null;
  return (
    <Card>
      <h2 className="text-sm font-medium">What will happen</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        These are the exact orders that will be recorded, priced at today&rsquo;s close. Nothing is
        saved until you confirm.
      </p>

      {plan.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1.5 rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-xs text-[var(--text-muted)]">
          {plan.warnings.map((w) => (
            <li key={w.code + (w.symbol ?? "")}>{w.message}</li>
          ))}
        </ul>
      ) : null}

      {summary.orders.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Nothing to do — this matches what you already hold.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="py-2 font-medium">Order</th>
                <th className="py-2 text-right font-medium">Shares</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 text-right font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {summary.orders.map((o, i) => (
                <tr
                  key={`${o.symbol}-${i}`}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="py-2.5">
                    <span
                      className={
                        "mr-2 rounded px-1.5 py-0.5 text-xs font-medium " +
                        (o.side === "BUY" ? "bg-up-50 text-up-700" : "bg-down-50 text-down-700")
                      }
                    >
                      {o.side}
                    </span>
                    {o.symbol}
                    {o.scaled ? (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">reduced</span>
                    ) : null}
                  </td>
                  <td className="tnum py-2.5 text-right">{o.shares}</td>
                  <td className="tnum py-2.5 text-right">{o.price}</td>
                  <td className="tnum py-2.5 text-right">{o.amount}</td>
                  <td className="tnum py-2.5 text-right text-[var(--text-muted)]">
                    {(o.prevWeightPpm / 10_000).toFixed(1)}% →{" "}
                    {(o.newWeightPpm / 10_000).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-xs text-[var(--text-muted)]">Value before</dt>
          <dd className="tnum">{summary.valueBefore}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-muted)]">Value after</dt>
          <dd className="tnum">{summary.valueAfter}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-muted)]">Fees</dt>
          <dd className="tnum">{summary.fees}</dd>
        </div>
        <div>
          {/* Named separately from fees so the difference between before and
              after is fully accounted for. Shares are bought in whole
              micro-shares, so each order costs at most a cent more than the
              shares it receives are worth — and that is the whole gap. */}
          <dt className="text-xs text-[var(--text-muted)]">Rounding</dt>
          <dd className="tnum">{summary.rounding}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-muted)]">Left in cash</dt>
          <dd className="tnum">{summary.cashAfter}</dd>
        </div>
      </dl>
    </Card>
  );
}
