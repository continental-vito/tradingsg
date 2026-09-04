import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { daysBetween, formatRemaining } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, formatPpm } from "@/server/money";

export const metadata: Metadata = { title: "Competition" };
export const dynamic = "force-dynamic";

export default async function CompetitionPage() {
  const user = await requireUser();

  const participant = await db.participant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: { competition: true },
  });
  if (!participant) notFound();

  const competition = participant.competition;

  const [participantCount, snapshot] = await Promise.all([
    db.participant.count({ where: { competitionId: competition.id, deletedAt: null } }),
    db.leaderboardSnapshot.findFirst({
      where: { competitionId: competition.id, kind: "DAILY" },
      orderBy: { asOfDate: "desc" },
      include: {
        entries: {
          where: { rank: 1 },
          take: 1,
          include: { participant: { select: { displayName: true } } },
        },
      },
    }),
  ]);
  const leader = snapshot?.entries[0];

  const totalDays = daysBetween(competition.startDate, competition.endDate);
  const elapsed = Math.max(
    0,
    Math.min(totalDays, daysBetween(competition.startDate, new Date().toISOString().slice(0, 10))),
  );
  const progressPct = totalDays > 0 ? Math.round((elapsed / totalDays) * 100) : 0;
  const ended = new Date() >= competition.endsAt;

  const timeline = [
    { label: "Registration", done: true },
    { label: "Portfolio setup", done: participant.activatedAt !== null },
    { label: "Competition", done: ended, current: !ended && competition.status === "RUNNING" },
    { label: "Weekly reports", done: false, current: !ended },
    { label: "Final ranking", done: ended },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{competition.name}</h1>
        {competition.description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--text-muted)]">
            {competition.description}
          </p>
        ) : null}
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-muted)]">
              {ended ? "This competition has finished" : "Time remaining"}
            </div>
            <div className="tnum mt-1 text-4xl font-semibold tracking-tight">
              {formatRemaining(competition.endsAt)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--text-muted)]">Current leader</div>
            <div className="mt-1 text-2xl font-semibold">
              {leader ? leader.participant.displayName : "Not yet decided"}
            </div>
            {leader ? (
              <div
                className={
                  "tnum text-sm font-medium " +
                  toneClass(leader.totalReturnPpm > 0 ? 1 : leader.totalReturnPpm < 0 ? -1 : 0)
                }
              >
                {formatPpm(leader.totalReturnPpm)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs text-[var(--text-muted)]">
            <span>{competition.startDate}</span>
            <span>
              day {elapsed} of {totalDays}
            </span>
            <span>{competition.endDate}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <div
              className="h-full rounded-full bg-accent-600 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </Card>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Participants" value={String(participantCount)} />
        <Fact
          label="Starting capital"
          value={formatCents(competition.startingCapitalCents, competition.currency)}
        />
        <Fact label="Status" value={competition.status.toLowerCase()} capitalize />
        <Fact label="Registration" value={competition.registrationOpen ? "Open" : "Closed"} />
      </dl>

      <Card>
        <h2 className="text-sm font-medium text-[var(--text-muted)]">How the competition runs</h2>
        <ol className="mt-4 flex flex-wrap gap-x-2 gap-y-3">
          {timeline.map((step, i) => (
            <li key={step.label} className="flex items-center gap-2">
              <span
                className={
                  "flex size-6 items-center justify-center rounded-full text-xs font-medium " +
                  (step.done
                    ? "bg-up-500 text-white"
                    : step.current
                      ? "bg-accent-600 text-white"
                      : "bg-[var(--surface-sunken)] text-[var(--text-muted)]")
                }
              >
                {step.done ? "✓" : i + 1}
              </span>
              <span
                className={
                  "text-sm " +
                  (step.current ? "font-medium" : step.done ? "" : "text-[var(--text-muted)]")
                }
              >
                {step.label}
              </span>
              {i < timeline.length - 1 ? (
                <span aria-hidden className="mx-1 text-[var(--text-muted)]">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <h2 className="text-sm font-medium">The rules that apply</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Every rule in this competition is configurable by the administrator rather than fixed in
          the software.{" "}
          <Link href="/rules" className="font-medium text-accent-600 hover:text-accent-700">
            Read the current rules
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

function Fact({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <dt className="text-sm text-[var(--text-muted)]">{label}</dt>
      <dd className={"tnum mt-1 text-xl font-semibold " + (capitalize ? "capitalize" : "")}>
        {value}
      </dd>
    </div>
  );
}
