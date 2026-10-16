import { Alert } from "@/components/ui";
import { daysBetween, formatDateKeyLong, type DateKey } from "@/lib/dates";

/**
 * What pre-launch means for the person reading it: nothing has been bought,
 * when it will be, and whether their order is in.
 */
export function PreLaunchBanner({
  launchDate,
  today,
  queuedPositions,
}: {
  launchDate: DateKey;
  today: DateKey;
  /** Positions in the queued order; null when nothing is queued yet. */
  queuedPositions: number | null;
}) {
  const days = daysBetween(today, launchDate);
  const when =
    days > 1
      ? `in ${days} days, on ${formatDateKeyLong(launchDate)}`
      : days === 1
        ? "tomorrow"
        : "today";
  return (
    <Alert tone={queuedPositions === null ? "info" : "success"}>
      <strong className="block">Pre-launch: the competition starts {when}</strong>
      {queuedPositions === null
        ? "Build your portfolio before then. Nothing is bought yet: every participant's order executes together at the close on launch day, at the same prices, so nobody gets a head start."
        : `Your portfolio is queued (${queuedPositions} position${queuedPositions === 1 ? "" : "s"}) and executes at the close on launch day, together with everyone else's. You can change it until then.`}
    </Alert>
  );
}
