import type { Metadata } from "next";
import Link from "next/link";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { PerformanceLine } from "@/components/charts/performance-line";
import { CASH_COLOR, topNWithOther } from "@/components/charts/palette";
import { Alert, Card, EmptyState } from "@/components/ui";
import { Stat, toneClass } from "@/components/stat";
import { formatRemaining } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { loadDashboard } from "@/server/dto/portfolio.dto";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await loadDashboard(user.id);

  if (!data) {
    return (
      <EmptyState
        title="You have not joined a competition yet"
        body="Once an administrator opens registration, the competition appears here and you can build your portfolio."
        action={
          <Link href="/" className="text-sm font-medium text-accent-600 hover:text-accent-700">
            Back to the overview
          </Link>
        }
      />
    );
  }

  const { headline, holdings, competition } = data;

  if (!data.participant.hasInvested) {
    return (
      <div className="space-y-6">
        <Header data={data} />
        <EmptyState
          title="Your portfolio is still all cash"
          body={`You hold ${headline.cash.text} and have not invested any of it. Until you do you are not on the leaderboard — an uninvested portfolio returns exactly 0.00%, and ranking that mid-table would reward not playing.`}
          action={
            <Link
              href="/portfolio/allocate"
              className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              Build my portfolio
            </Link>
          }
        />
      </div>
    );
  }

  const slices = topNWithOther(holdings, 7, (h) => ({
    key: h.stockId,
    label: h.symbol,
    valueCents: BigInt(h.value.cents),
    weightPpm: h.weightPpm,
  }));
  if (headline.cashWeightPpm > 0) {
    slices.push({
      key: "__cash",
      label: "Cash",
      valueCents: headline.cash.cents,
      weightPpm: headline.cashWeightPpm,
      // Cash is not a series: it is the absence of a position, so it takes the
      // neutral rather than spending a categorical hue.
      color: CASH_COLOR,
    });
  }

  return (
    <div className="space-y-6">
      <Header data={data} />

      {headline.priceQuality !== "OK" ? (
        <Alert tone="info">
          Some prices in this valuation were carried forward from an earlier close. Affected
          holdings are marked in the table below.
        </Alert>
      ) : null}

      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-muted)]">Portfolio value</div>
            <div className="tnum mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
              {headline.currentValue.text}
            </div>
            <div
              className={
                "tnum mt-1 text-lg font-medium " + toneClass(headline.totalReturn.direction)
              }
            >
              {headline.totalReturn.direction < 0 ? "−" : "+"}
              {headline.totalGainLoss.text.replace(/^-/, "")} ({headline.totalReturn.text})
            </div>
          </div>
          {data.rank?.position ? (
            <Link
              href="/leaderboard"
              className="rounded-[var(--radius-card)] border border-[var(--border)] px-4 py-3 text-right hover:bg-[var(--surface-sunken)]"
            >
              <div className="text-xs text-[var(--text-muted)]">Your position</div>
              <div className="tnum text-2xl font-semibold">#{data.rank.position}</div>
              <div className="text-xs text-[var(--text-muted)]">of {data.rank.of} ranked</div>
            </Link>
          ) : null}
        </div>
        {headline.asOfDate ? (
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Valued at the close on {headline.asOfDate}, using the same prices for everyone.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Starting capital" value={headline.initialCapital.text} />
        <Stat
          label="Today"
          value={headline.todayGainLoss?.text ?? "—"}
          ratio={headline.todayReturn}
        />
        <Stat
          label="This week"
          value={headline.weekGainLoss?.text ?? "—"}
          ratio={headline.weekReturn}
        />
        <Stat
          label="Cash"
          value={headline.cash.text}
          hint={`${(headline.cashWeightPpm / 10_000).toFixed(1)}% of the portfolio`}
        />
      </div>

      {data.best || data.worst ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.best ? (
            <Card>
              <div className="text-sm text-[var(--text-muted)]">Best performer</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold">{data.best.symbol}</span>
                <span className="text-sm text-[var(--text-muted)]">{data.best.name}</span>
              </div>
              <div className={"tnum mt-0.5 font-medium " + toneClass(1)}>
                {data.best.ratio.text} · {data.best.gain.text}
              </div>
            </Card>
          ) : null}
          {data.worst ? (
            <Card>
              <div className="text-sm text-[var(--text-muted)]">Worst performer</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold">{data.worst.symbol}</span>
                <span className="text-sm text-[var(--text-muted)]">{data.worst.name}</span>
              </div>
              <div className={"tnum mt-0.5 font-medium " + toneClass(-1)}>
                {data.worst.ratio.text} · {data.worst.gain.text}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <PerformanceLine
            points={data.series}
            initialCapitalCents={headline.initialCapital.plot}
            currency={competition.currency}
          />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-[var(--text-muted)]">Allocation</h2>
          <AllocationDonut
            slices={slices}
            centerLabel="Positions"
            centerValue={String(holdings.length)}
          />
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">Holdings</h2>
          <Link
            href="/portfolio"
            className="text-sm font-medium text-accent-600 hover:text-accent-700"
          >
            Manage portfolio
          </Link>
        </div>
        <HoldingsTable data={data} />
      </Card>
    </div>
  );
}

function Header({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadDashboard>>> }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        {data.participant.displayName.split(" ")[0]}&rsquo;s portfolio
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        {data.competition.name} · {formatRemaining(new Date(data.competition.endsAt))} remaining
      </p>
    </div>
  );
}

function HoldingsTable({ data }: { data: NonNullable<Awaited<ReturnType<typeof loadDashboard>>> }) {
  if (data.holdings.length === 0) {
    return (
      <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">
        You hold no positions — your whole portfolio is in cash.
      </p>
    );
  }
  return (
    // Wide content scrolls inside its own container; the page body never scrolls
    // sideways on a phone.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
            <th className="px-5 py-2.5 font-medium">Stock</th>
            <th className="px-3 py-2.5 text-right font-medium">Shares</th>
            <th className="px-3 py-2.5 text-right font-medium">Price</th>
            <th className="px-3 py-2.5 text-right font-medium">Value</th>
            <th className="px-3 py-2.5 text-right font-medium">Weight</th>
            <th className="px-5 py-2.5 text-right font-medium">Gain / loss</th>
          </tr>
        </thead>
        <tbody>
          {data.holdings.map((h) => (
            <tr key={h.stockId} className="border-b border-[var(--border)] last:border-0">
              <td className="px-5 py-3">
                <div className="font-medium">{h.symbol}</div>
                <div className="text-xs text-[var(--text-muted)]">{h.name}</div>
              </td>
              <td className="tnum px-3 py-3 text-right">{h.shares.text}</td>
              <td className="tnum px-3 py-3 text-right">
                {h.price.text}
                {h.priceIsStale ? (
                  <span
                    className="ml-1 text-[var(--text-muted)]"
                    title="Carried forward from an earlier close"
                  >
                    *
                  </span>
                ) : null}
              </td>
              <td className="tnum px-3 py-3 text-right">{h.value.text}</td>
              <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">{h.weightText}</td>
              <td className={"tnum px-5 py-3 text-right " + toneClass(h.gainLossRatio.direction)}>
                <div>{h.gainLoss.text}</div>
                <div className="text-xs">{h.gainLossRatio.text}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
