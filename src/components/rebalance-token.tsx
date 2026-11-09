import { Alert } from "@/components/ui";
import { formatDateKeyLong } from "@/lib/dates";
import type { RebalanceTokens } from "@/server/portfolio/access";

const UNIT = { DAY: "daily", WEEK: "weekly", MONTH: "monthly" } as const;
const PERIOD = { DAY: "day", WEEK: "week", MONTH: "month" } as const;

/**
 * The rebalance-token state, in one sentence.
 *
 * With `reason`, trading is closed and this is the banner shown instead of the
 * allocation editor. The reason comes from the same window check the commit
 * runs, so the banner cannot promise a trade the server would then refuse.
 */
export function TokenBanner({
  tokens,
  reason,
}: {
  tokens: RebalanceTokens | null;
  reason?: string;
}) {
  if (reason) {
    return (
      <Alert tone="info">
        <strong className="block">
          {tokens?.expired && tokens.used < tokens.allowance
            ? `Your ${UNIT[tokens.periodUnit]} rebalance token has expired`
            : tokens && tokens.remaining === 0
              ? `You used your ${UNIT[tokens.periodUnit]} rebalance token`
              : "You cannot rebalance right now"}
        </strong>
        {reason}
      </Alert>
    );
  }
  if (!tokens) return null;

  const unit = UNIT[tokens.periodUnit];
  return (
    <p className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">
        {tokens.remaining} of {tokens.allowance} {unit} rebalance token
        {tokens.allowance === 1 ? "" : "s"} left.
      </span>{" "}
      Confirming a change uses {tokens.remaining === 1 ? "it" : "one"}
      {tokens.usableUntil ? (
        <>
          . Use it by <strong>{formatDateKeyLong(tokens.usableUntil)}</strong> — after that it
          expires unused, and the next one arrives on {formatDateKeyLong(tokens.refillsOn)}.
        </>
      ) : (
        <>; a fresh token arrives on {formatDateKeyLong(tokens.refillsOn)}.</>
      )}
    </p>
  );
}

/**
 * For someone who has never built a portfolio. Their first build is allowed on
 * any day and does not use the monthly token, so the token banner — which
 * would talk about windows and expiry — would only mislead them.
 */
export function FirstBuildNote({ tokens }: { tokens: RebalanceTokens | null }) {
  return (
    <p className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">This is your first portfolio.</span> You can
      build it on any day, and it does not use your rebalance token.
      {tokens
        ? ` After that, changes follow the normal rule: one per ${PERIOD[tokens.periodUnit]}${tokens.usableUntil ? ", in its first days only" : ""}.`
        : ""}
    </p>
  );
}
