import { Alert } from "@/components/ui";
import { formatDateKeyLong } from "@/lib/dates";
import type { PreLaunchWindow } from "@/server/competition/prelaunch";

/**
 * What pre-launch means for the person reading it: nothing has been bought,
 * the three dates that matter, and whether their order is in.
 */
export function PreLaunchBanner({
  window,
  queuedPositions,
}: {
  window: PreLaunchWindow;
  /** Positions in the queued order; null when nothing is queued yet. */
  queuedPositions: number | null;
}) {
  const launch = formatDateKeyLong(window.launchOn);
  const building =
    window.opensOn && window.closesOn
      ? `from ${formatDateKeyLong(window.opensOn)} to ${formatDateKeyLong(window.closesOn)}`
      : window.closesOn
        ? `until ${formatDateKeyLong(window.closesOn)}`
        : `until ${launch}`;
  const queued =
    queuedPositions === null
      ? null
      : `Your portfolio is queued (${queuedPositions} position${queuedPositions === 1 ? "" : "s"}).`;

  const title =
    window.state === "BEFORE"
      ? `Portfolio building opens on ${formatDateKeyLong(window.opensOn ?? window.launchOn)}`
      : window.state === "OPEN"
        ? queued
          ? "Your portfolio is queued for launch"
          : `Build your portfolio ${window.closesOn ? `by ${formatDateKeyLong(window.closesOn)}` : `before ${launch}`}`
        : "Portfolio building is closed";

  return (
    <Alert tone={queued ? "success" : "info"}>
      <strong className="block">{title}</strong>
      Nothing is bought yet. You can build or change your portfolio {building}; every
      participant&rsquo;s order then executes together at the close on {launch}, at the same prices,
      and portfolios are valued from that day.{" "}
      {queued
        ? window.state === "OPEN"
          ? `${queued} You can still change it.`
          : queued
        : window.state === "CLOSED"
          ? "You did not queue a portfolio, so you start in cash and can invest in the next monthly window."
          : ""}
    </Alert>
  );
}
