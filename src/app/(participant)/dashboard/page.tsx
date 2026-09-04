import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { formatRemaining } from "@/lib/dates";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();

  const participant = await db.participant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: { competition: true, portfolio: true },
  });

  if (!participant) {
    return (
      <EmptyState
        title="You have not joined a competition yet"
        body="Once an administrator opens registration, the competition will appear here and you can build your portfolio."
        action={
          <Link href="/" className="text-sm font-medium text-accent-600 hover:text-accent-700">
            Back to the overview
          </Link>
        }
      />
    );
  }

  const portfolio = participant.portfolio;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {user.firstName}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {participant.competition.name} · {formatRemaining(participant.competition.endsAt)}{" "}
          remaining
        </p>
      </div>

      {portfolio && portfolio.setupCompletedAt === null ? (
        <EmptyState
          title="Your portfolio is still all cash"
          body={`You hold ${formatCents(portfolio.cashCents)} and have not invested any of it yet. Until you do, you are not on the leaderboard.`}
          action={
            <Link
              href="/portfolio/allocate"
              className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              Build my portfolio
            </Link>
          }
        />
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-3">
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Starting capital</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">
            {formatCents(participant.initialCapitalCents)}
          </dd>
        </Card>
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Cash</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">
            {portfolio ? formatCents(portfolio.cashCents) : "—"}
          </dd>
        </Card>
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Competition</dt>
          <dd className="mt-1 text-2xl font-semibold capitalize">
            {participant.competition.status.toLowerCase()}
          </dd>
        </Card>
      </dl>

      <Card>
        <p className="text-sm text-[var(--text-muted)]">
          Portfolio value, performance charts, holdings and gain/loss arrive with the valuation
          engine. Prices are not yet loaded, and this page deliberately shows nothing rather than a
          placeholder number that would be wrong.
        </p>
      </Card>
    </div>
  );
}
