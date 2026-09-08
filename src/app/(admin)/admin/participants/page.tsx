import type { Metadata } from "next";
import Link from "next/link";
import { setParticipantStatusAction, setUserDisabledAction } from "@/app/actions/admin";
import { ParticipantActions } from "@/components/admin-controls";
import { Card, EmptyState, Input } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm } from "@/server/money";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const participants = await db.participant.findMany({
    where: {
      competitionId: competition.id,
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { displayName: { contains: query } },
              { user: { firstName: { contains: query } } },
              { user: { lastName: { contains: query } } },
              { user: { email: { contains: query } } },
              { user: { department: { contains: query } } },
            ],
          }
        : {}),
    },
    include: {
      user: true,
      portfolio: { select: { id: true, setupCompletedAt: true, cashCents: true } },
      _count: { select: { transactions: true } },
    },
    orderBy: { displayName: "asc" },
  });

  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: { entries: true },
  });
  const entryByParticipant = new Map((snapshot?.entries ?? []).map((e) => [e.participantId, e]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Participants</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {participants.length}
            {query ? ` matching “${query}”` : ""} in {competition.name}
          </p>
        </div>
        <form className="flex gap-2">
          <Input
            name="q"
            defaultValue={query}
            placeholder="Search name, email or team"
            className="w-64"
            aria-label="Search participants"
          />
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--surface-sunken)]"
          >
            Search
          </button>
        </form>
      </div>

      {participants.length === 0 ? (
        <EmptyState
          title="Nobody found"
          body={query ? `Nothing matches “${query}”.` : "Nobody has registered yet."}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2.5 font-medium">Participant</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rank</th>
                  <th className="px-3 py-2.5 text-right font-medium">Return</th>
                  <th className="px-3 py-2.5 text-right font-medium">Value</th>
                  <th className="px-3 py-2.5 text-right font-medium">Trades</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => {
                  const entry = entryByParticipant.get(p.id);
                  const invested = p.portfolio?.setupCompletedAt !== null;
                  return (
                    <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/participants/${p.id}`}
                            className="font-medium hover:text-accent-600"
                          >
                            {p.user.firstName} {p.user.lastName}
                          </Link>
                          {p.user.isDemo ? (
                            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                              demo
                            </span>
                          ) : null}
                          {p.user.role === "ADMIN" ? (
                            <span className="rounded-full bg-accent-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              admin
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {p.user.email}
                          {p.user.department ? ` · ${p.user.department}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge
                          status={p.status}
                          disabled={p.user.isDisabled}
                          invested={invested}
                        />
                      </td>
                      <td className="tnum px-3 py-3 text-right">
                        {entry?.rank !== null && entry?.rank !== undefined ? `#${entry.rank}` : "—"}
                      </td>
                      <td
                        className={
                          "tnum px-3 py-3 text-right " +
                          toneClass(
                            (entry?.totalReturnPpm ?? 0) > 0
                              ? 1
                              : (entry?.totalReturnPpm ?? 0) < 0
                                ? -1
                                : 0,
                          )
                        }
                      >
                        {entry ? formatPpm(entry.totalReturnPpm) : "—"}
                      </td>
                      <td className="tnum px-3 py-3 text-right">
                        {entry
                          ? formatCents(entry.totalValueCents, competition.currency)
                          : formatCents(p.initialCapitalCents, competition.currency)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-[var(--text-muted)]">
                        {p._count.transactions}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ParticipantActions
                          participantId={p.id}
                          userId={p.userId}
                          status={p.status}
                          isDisabled={p.user.isDisabled}
                          setStatus={setParticipantStatusAction}
                          setDisabled={setUserDisabledAction}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  disabled,
  invested,
}: {
  status: string;
  disabled: boolean;
  invested: boolean;
}) {
  if (disabled) {
    return <Badge tone="down">account disabled</Badge>;
  }
  if (status === "DISQUALIFIED") return <Badge tone="down">disqualified</Badge>;
  if (status === "WITHDRAWN") return <Badge tone="muted">withdrawn</Badge>;
  if (!invested) return <Badge tone="muted">not invested</Badge>;
  return <Badge tone="up">active</Badge>;
}

function Badge({ tone, children }: { tone: "up" | "down" | "muted"; children: React.ReactNode }) {
  const tones = {
    up: "bg-up-50 text-up-700",
    down: "bg-down-50 text-down-700",
    muted: "bg-[var(--surface-sunken)] text-[var(--text-muted)]",
  } as const;
  return (
    <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + tones[tone]}>{children}</span>
  );
}
