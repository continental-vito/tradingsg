import "server-only";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";

/**
 * The competition someone could join, for the empty state shown when they have
 * no participation. Returns nulls rather than throwing, because "you are not in
 * a competition" is a state to render, not an error.
 */
export async function loadJoinable(): Promise<{
  competitionName: string | null;
  registrationOpen: boolean;
  startingCapital: string | null;
}> {
  const competition = await db.competition.findFirst({
    where: { deletedAt: null, status: { in: ["REGISTRATION", "RUNNING"] } },
    orderBy: { startsAt: "desc" },
    select: {
      name: true,
      registrationOpen: true,
      startingCapitalCents: true,
      currency: true,
    },
  });

  if (!competition) {
    return { competitionName: null, registrationOpen: false, startingCapital: null };
  }

  return {
    competitionName: competition.name,
    registrationOpen: competition.registrationOpen,
    startingCapital: formatCents(competition.startingCapitalCents, competition.currency),
  };
}
