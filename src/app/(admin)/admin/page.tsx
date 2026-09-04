import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });

  const [participants, stocks, invested] = await Promise.all([
    competition
      ? db.participant.count({ where: { competitionId: competition.id, deletedAt: null } })
      : 0,
    competition ? db.competitionStock.count({ where: { competitionId: competition.id } }) : 0,
    competition
      ? db.portfolio.count({
          where: { competitionId: competition.id, setupCompletedAt: { not: null } },
        })
      : 0,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competition administration</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {competition ? competition.name : "No competition has been created yet."}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-4">
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Participants</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">{participants}</dd>
        </Card>
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Portfolios built</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">
            {invested}
            <span className="text-base font-normal text-[var(--text-muted)]">
              {" "}
              / {participants}
            </span>
          </dd>
        </Card>
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Stocks available</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">{stocks}</dd>
        </Card>
        <Card>
          <dt className="text-sm text-[var(--text-muted)]">Starting capital</dt>
          <dd className="tnum mt-1 text-2xl font-semibold">
            {competition ? formatCents(competition.startingCapitalCents) : "—"}
          </dd>
        </Card>
      </dl>

      <Card>
        <p className="text-sm text-[var(--text-muted)]">
          Participant management, stock management, competition settings, analytics and the report
          tools land in the admin phase. The counts above are live.
        </p>
      </Card>
    </div>
  );
}
