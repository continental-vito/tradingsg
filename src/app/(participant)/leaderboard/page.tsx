import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { toneClass } from "@/components/stat";
import { requireUser } from "@/server/auth/guard";
import {
  loadLeaderboard,
  type LeaderboardRow,
  type LeaderboardScope,
} from "@/server/dto/leaderboard.dto";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

const MEDALS: Record<number, { emoji: string; ring: string }> = {
  1: { emoji: "🥇", ring: "ring-[var(--color-gold)]" },
  2: { emoji: "🥈", ring: "ring-[var(--color-silver)]" },
  3: { emoji: "🥉", ring: "ring-[var(--color-bronze)]" },
};

const UNRANKED_LABEL: Record<string, string> = {
  NOT_INVESTED: "Not yet invested",
  NO_PORTFOLIO: "No portfolio",
  NO_VALUATION: "Not yet valued",
  WITHDRAWN: "Withdrawn",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireUser();
  const { scope: rawScope } = await searchParams;
  const scope: LeaderboardScope =
    rawScope === "week" || rawScope === "month" ? rawScope : "overall";

  const data = await loadLeaderboard(user.id, scope);
  if (!data) {
    return (
      <EmptyState
        title="You have not joined a competition yet"
        body="The leaderboard appears once you are part of a competition."
      />
    );
  }

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="No standings yet"
        body="The leaderboard is written once a day after the close. It will appear here as soon as the first snapshot has been taken."
      />
    );
  }

  const ranked = data.rows.filter((r) => r.isRanked);
  const unranked = data.rows.filter((r) => !r.isRanked);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {data.rankedCount} of {data.participantCount} participants ranked
            {data.asOfDate ? ` · at the close on ${data.asOfDate}` : ""}
          </p>
        </div>
        <div
          role="group"
          aria-label="Ranking period"
          className="flex gap-0.5 rounded-lg bg-[var(--surface-sunken)] p-0.5"
        >
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={s.key === "overall" ? "/leaderboard" : `/leaderboard?scope=${s.key}`}
              aria-current={scope === s.key ? "true" : undefined}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (scope === s.key
                  ? "bg-[var(--surface-raised)] text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Someone who joined since the last snapshot is in the competition but
          not on this board yet. Saying so beats leaving them to wonder whether
          they are missing or the app is broken. */}
      {data.youJoinedAfterSnapshot ? (
        <Card className="border-accent-500/40 bg-accent-50/40">
          <p className="text-sm">
            <strong>You joined after these standings were taken.</strong>{" "}
            <span className="text-[var(--text-muted)]">
              The leaderboard is written once a day after the close, so you will appear on it in the
              next one. Build your portfolio in the meantime and you will arrive ranked rather than
              waiting.
            </span>
          </p>
        </Card>
      ) : null}

      {/* The participant's own position, called out whether they are 2nd or
          22nd — scrolling to find yourself is the single most common thing
          anyone does on a leaderboard. */}
      {data.you ? (
        <Card className="border-accent-500/40 bg-accent-50/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-[var(--text-muted)]">
                {data.you.isRanked ? "You are currently" : "You are"}
              </div>
              <div className="mt-0.5 flex items-baseline gap-3">
                <span className="text-3xl font-semibold">
                  {data.you.rank !== null ? `#${data.you.rank}` : "Unranked"}
                </span>
                {data.you.isRanked ? (
                  <span
                    className={
                      "tnum text-xl font-medium " + toneClass(data.you.scopeReturn.direction)
                    }
                  >
                    {data.you.scopeReturn.text}
                  </span>
                ) : null}
              </div>
              {!data.you.isRanked ? (
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  An uninvested portfolio returns exactly 0.00%, so it is listed separately rather
                  than ranked.{" "}
                  <Link href="/portfolio/allocate" className="font-medium text-accent-600">
                    Build your portfolio
                  </Link>
                  .
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  of {data.rankedCount} ranked · {data.you.value.text}
                </p>
              )}
            </div>
            {data.you.rankChange !== null && data.you.rankChange !== 0 ? (
              <RankChange change={data.you.rankChange} large />
            ) : null}
          </div>
        </Card>
      ) : null}

      {data.stats ? (
        <dl className="grid gap-4 sm:grid-cols-4">
          <MiniStat
            label="Best"
            value={data.stats.best.text}
            direction={data.stats.best.direction}
          />
          <MiniStat
            label="Median"
            value={data.stats.median.text}
            direction={data.stats.median.direction}
          />
          <MiniStat
            label="Worst"
            value={data.stats.worst.text}
            direction={data.stats.worst.direction}
          />
          <MiniStat label="Under management" value={data.stats.aum.text} direction={0} />
        </dl>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                <th className="w-16 px-5 py-2.5 font-medium">Rank</th>
                <th className="px-3 py-2.5 font-medium">Participant</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {scope === "overall" ? "Return" : scope === "week" ? "This week" : "This month"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Gain / loss</th>
                <th className="px-5 py-2.5 text-right font-medium">Portfolio value</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <Row key={row.participantId} row={row} />
              ))}
            </tbody>
          </table>
        </div>

        {unranked.length > 0 ? (
          <div className="border-t border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-4">
            <h2 className="text-xs font-medium text-[var(--text-muted)]">
              Not yet ranked ({unranked.length})
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              An uninvested portfolio is exactly flat, so ranking it mid-table would put it ahead of
              everyone who is down.
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              {unranked.map((row) => (
                <li
                  key={row.participantId}
                  className={row.isYou ? "font-medium text-accent-700" : "text-[var(--text-muted)]"}
                >
                  {row.displayName}
                  {row.isYou ? " (you)" : ""}
                  <span className="ml-1.5 text-xs">
                    {UNRANKED_LABEL[row.unrankedReason ?? ""] ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function MiniStat({
  label,
  value,
  direction,
}: {
  label: string;
  value: string;
  direction: -1 | 0 | 1;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className={"tnum mt-0.5 text-lg font-semibold " + toneClass(direction)}>{value}</dd>
    </div>
  );
}

function Row({ row }: { row: LeaderboardRow }) {
  const medal = row.rank !== null ? MEDALS[row.rank] : undefined;
  return (
    <tr
      className={
        "border-b border-[var(--border)] last:border-0 " + (row.isYou ? "bg-accent-50/60" : "")
      }
    >
      <td className="px-5 py-3">
        <span className="tnum flex items-center gap-1.5 font-medium">
          {medal ? <span aria-hidden>{medal.emoji}</span> : null}
          <span className={medal ? "" : "text-[var(--text-muted)]"}>{row.rank}</span>
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.displayName}</span>
          {row.isYou ? (
            <span className="rounded-full bg-accent-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              you
            </span>
          ) : null}
          {row.isNewEntry ? (
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              new
            </span>
          ) : null}
          {row.rankChange !== null && row.rankChange !== 0 ? (
            <RankChange change={row.rankChange} />
          ) : null}
        </div>
        {row.department ? (
          <div className="text-xs text-[var(--text-muted)]">{row.department}</div>
        ) : null}
      </td>
      <td
        className={"tnum px-3 py-3 text-right font-medium " + toneClass(row.scopeReturn.direction)}
      >
        {row.scopeReturn.text}
      </td>
      <td className={"tnum px-3 py-3 text-right " + toneClass(row.overallReturn.direction)}>
        {row.gainLoss.text}
      </td>
      <td className="tnum px-5 py-3 text-right">{row.value.text}</td>
    </tr>
  );
}

/** Positive means climbed. A first appearance renders nothing, not a zero. */
function RankChange({ change, large = false }: { change: number; large?: boolean }) {
  const up = change > 0;
  return (
    <span
      className={
        "tnum inline-flex items-center gap-0.5 font-medium " +
        (up ? "text-up-600" : "text-down-600") +
        (large ? " text-lg" : " text-xs")
      }
      title={up ? `Up ${change} places` : `Down ${Math.abs(change)} places`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(change)}
    </span>
  );
}
