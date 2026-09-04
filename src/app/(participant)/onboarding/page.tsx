import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";

export const metadata: Metadata = { title: "How this works" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireUser();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null, status: { in: ["REGISTRATION", "RUNNING"] } },
    orderBy: { startsAt: "desc" },
    include: {
      settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
    },
  });

  const capital = competition?.startingCapitalCents ?? 10_000_000n;
  const settings = competition?.settings[0];
  const maxPositionPct = settings ? (settings.maxPositionPpm / 10_000).toFixed(0) : "30";

  const steps = [
    {
      title: "You start with virtual capital",
      body: `Every participant is funded with exactly ${formatCents(capital)}. Nobody starts with more, and no money is ever added — which is what makes comparing returns fair.`,
    },
    {
      title: "You allocate it across the competition's stocks",
      body: `Choose what percentage goes into each name. Your allocation must add up to exactly 100%, and no single stock may exceed ${maxPositionPct}% of your portfolio. Cash counts as an allocation.`,
    },
    {
      title: "Performance is calculated on closing prices",
      body: "Your portfolio is valued once a day at the official close, using the same prices for everyone. Historical values are stored, so a chart you look at tomorrow shows the same past it showed today.",
    },
    {
      title: "The leaderboard ranks percentage return",
      body: "Not euros gained — percentage. Everyone started with the same amount, so the ranking measures your decisions and nothing else. Participants who have not invested yet are listed separately rather than ranked at 0%.",
    },
    {
      title: "You get a weekly report",
      body: "Every week you receive your portfolio value, your weekly and total return, your rank, how many places you moved, and your best and worst holdings.",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Before you start</h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          Five things worth knowing. It takes a minute to read and saves the support question later.
        </p>
      </div>

      <ol className="space-y-4">
        {steps.map((s, i) => (
          <Card key={s.title} className="flex gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700">
              {i + 1}
            </span>
            <div>
              <h2 className="font-medium">{s.title}</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{s.body}</p>
            </div>
          </Card>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/portfolio/allocate"
          className="rounded-lg bg-accent-600 px-5 py-3 text-sm font-medium text-white hover:bg-accent-700"
        >
          Build my portfolio
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-[var(--border)] px-5 py-3 text-sm font-medium hover:bg-[var(--surface-sunken)]"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
