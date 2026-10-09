import type { Metadata } from "next";
import Link from "next/link";
import {
  createCompetitionAction,
  relaunchCompetitionAction,
  updateCompetitionAction,
} from "@/app/actions/admin";
import {
  CompetitionForm,
  CreateCompetitionForm,
  RelaunchCompetitionForm,
} from "@/components/admin-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { formatRemaining } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { UNIVERSE } from "@/server/competition/universe";

export const metadata: Metadata = { title: "Competition" };
export const dynamic = "force-dynamic";
// The relaunch fetches price history for every stock it adds, which is one
// request per name and takes longer than a default serverless invocation.
export const maxDuration = 300;

export default async function AdminCompetitionPage() {
  await requireAdmin();

  const competitions = await db.competition.findMany({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    include: {
      _count: { select: { participants: true, stocks: true } },
    },
  });

  const current = competitions[0];
  const hasValuations = current
    ? (await db.portfolioValuation.count({ where: { competitionId: current.id } })) > 0
    : false;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competition</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Create one, set its dates, open registration, and start, pause or end it.
        </p>
      </div>

      {current ? (
        <>
          <Card>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">{current.name}</h2>
              <span className="text-xs text-[var(--text-muted)]">
                {current._count.participants} participants · {current._count.stocks} stocks ·{" "}
                {formatCents(current.startingCapitalCents, current.currency)} each ·{" "}
                {formatRemaining(current.endsAt)}
              </span>
            </div>

            {current.status === "DRAFT" ? (
              <div className="mb-4">
                <Alert tone="info">
                  This competition is a draft: nobody can see or join it. Add stocks on the{" "}
                  <Link href="/admin/stocks" className="font-medium underline">
                    stocks page
                  </Link>
                  , check the{" "}
                  <Link href="/admin/settings" className="font-medium underline">
                    rules
                  </Link>
                  , then set the status to registration.
                </Alert>
              </div>
            ) : null}

            {current._count.stocks === 0 ? (
              <div className="mb-4">
                <Alert>
                  No stocks yet. Nobody can allocate anything until this competition has a stock
                  universe.
                </Alert>
              </div>
            ) : null}

            <CompetitionForm
              competition={{
                id: current.id,
                name: current.name,
                description: current.description ?? "",
                status: current.status,
                registrationOpen: current.registrationOpen,
                startDate: current.startDate,
                endDate: current.endDate,
                hasValuations,
              }}
              save={updateCompetitionAction}
            />
          </Card>

          {hasValuations ? (
            <Alert tone="info">
              The start date is locked because {current._count.participants} portfolios have already
              been valued against it. Moving it would silently change what every stored return was
              measured from — end this competition and create a new one instead.
            </Alert>
          ) : null}

          <Card>
            <h2 className="text-sm font-medium">Relaunch on the CAC 40</h2>
            <p className="mt-1 mb-4 text-sm text-[var(--text-muted)]">
              For when the trading so far was a trial. In one step: the tradable list becomes the{" "}
              {UNIVERSE.length - 2} CAC 40 stocks plus Bitcoin and an S&amp;P 500 ETF, and every
              other stock is removed; every portfolio goes back to{" "}
              {formatCents(current.startingCapitalCents, current.currency)} in cash, with its
              trades, valuations, leaderboard history and reports deleted; and the rules gain a 1%
              transaction cost and one rebalance per week, reset every Monday. Participants keep
              their accounts.
            </p>
            <RelaunchCompetitionForm
              competitionId={current.id}
              relaunch={relaunchCompetitionAction}
            />
          </Card>
        </>
      ) : (
        <EmptyState
          title="No competition yet"
          body="Create one below. It starts as a draft, so nothing is visible to anybody until you open registration."
        />
      )}

      <Card>
        <h2 className="mb-4 text-sm font-medium">Create a competition</h2>
        <CreateCompetitionForm
          {...(current
            ? {
                copyStocksFrom: {
                  id: current.id,
                  name: current.name,
                  stockCount: current._count.stocks,
                },
              }
            : {})}
          create={createCompetitionAction}
        />
      </Card>

      {competitions.length > 1 ? (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
            All competitions
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {competitions.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{c.slug}</div>
                    </td>
                    <td className="tnum px-3 py-2.5 text-xs text-[var(--text-muted)]">
                      {c.startDate} → {c.endDate}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{c.status.toLowerCase()}</td>
                    <td className="tnum px-5 py-2.5 text-right text-[var(--text-muted)]">
                      {c._count.participants}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
