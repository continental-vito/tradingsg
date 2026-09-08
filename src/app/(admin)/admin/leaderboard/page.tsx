import type { Metadata } from "next";
import { RankingHistory, type RankingSeries } from "@/components/charts/ranking-history";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm } from "@/server/money";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function AdminLeaderboardPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  // Weekly snapshots for the history chart — a daily line for six weeks is
  // forty points of noise, and the question here is "who moved", not "when".
  const weekly = await db.leaderboardSnapshot.findMany({
    where: { competitionId: competition.id, kind: "WEEKLY" },
    orderBy: { asOfDate: "asc" },
    include: {
      entries: {
        include: { participant: { select: { id: true, displayName: true } } },
      },
    },
  });

  const latest = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: {
      entries: {
        orderBy: { displayOrder: "asc" },
        include: { participant: { select: { id: true, displayName: true } } },
      },
    },
  });

  const dates = weekly.map((s) => s.asOfDate);
  const leaders = (latest?.entries ?? []).filter((e) => e.rank !== null).slice(0, 8);

  const series: RankingSeries[] = leaders.map((leader) => ({
    participantId: leader.participantId,
    name: leader.participant.displayName,
    points: weekly.map((snapshot) => {
      const entry = snapshot.entries.find((e) => e.participantId === leader.participantId);
      return {
        date: snapshot.asOfDate,
        label: snapshot.asOfDate.slice(5),
        rank: entry?.rank ?? null,
      };
    }),
  }));

  const allSnapshots = await db.leaderboardSnapshot.findMany({
    where: { competitionId: competition.id },
    orderBy: [{ asOfDate: "desc" }, { kind: "asc" }],
    take: 30,
    select: {
      id: true,
      asOfDate: true,
      kind: true,
      rankedCount: true,
      participantCount: true,
      bestReturnPpm: true,
      medianReturnPpm: true,
      worstReturnPpm: true,
      totalAumCents: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {latest
              ? `${latest.rankedCount} ranked of ${latest.participantCount} at the close on ${latest.asOfDate}`
              : "No snapshot yet"}
          </p>
        </div>
        {latest ? (
          <a
            href="/api/admin/leaderboard.csv"
            className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--surface-sunken)]"
          >
            Export CSV
          </a>
        ) : null}
      </div>

      {!latest ? (
        <EmptyState
          title="No standings yet"
          body="Snapshots are written once a day after the close. Run make job NAME=snapshot-leaderboard to write one now."
        />
      ) : (
        <>
          <Card>
            <h2 className="text-sm font-medium text-[var(--text-muted)]">
              Ranking over time — current top {series.length}
            </h2>
            <p className="mt-1 mb-4 text-xs text-[var(--text-muted)]">
              Weekly snapshots. First place is at the top.
            </p>
            <RankingHistory series={series} dates={dates} />
          </Card>

          <Card className="overflow-hidden p-0">
            <h2 className="px-5 py-4 text-sm font-medium text-[var(--text-muted)]">
              Snapshot history
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-y border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Kind</th>
                    <th className="px-3 py-2.5 text-right font-medium">Ranked</th>
                    <th className="px-3 py-2.5 text-right font-medium">Best</th>
                    <th className="px-3 py-2.5 text-right font-medium">Median</th>
                    <th className="px-3 py-2.5 text-right font-medium">Worst</th>
                    <th className="px-5 py-2.5 text-right font-medium">Under management</th>
                  </tr>
                </thead>
                <tbody>
                  {allSnapshots.map((s) => (
                    <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="tnum px-5 py-2.5">{s.asOfDate}</td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{s.kind}</td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {s.rankedCount}/{s.participantCount}
                      </td>
                      <td
                        className={
                          "tnum px-3 py-2.5 text-right " + toneClass(s.bestReturnPpm > 0 ? 1 : -1)
                        }
                      >
                        {formatPpm(s.bestReturnPpm)}
                      </td>
                      <td
                        className={
                          "tnum px-3 py-2.5 text-right " +
                          toneClass(s.medianReturnPpm > 0 ? 1 : s.medianReturnPpm < 0 ? -1 : 0)
                        }
                      >
                        {formatPpm(s.medianReturnPpm)}
                      </td>
                      <td
                        className={
                          "tnum px-3 py-2.5 text-right " + toneClass(s.worstReturnPpm > 0 ? 1 : -1)
                        }
                      >
                        {formatPpm(s.worstReturnPpm)}
                      </td>
                      <td className="tnum px-5 py-2.5 text-right">
                        {formatCents(s.totalAumCents, competition.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
