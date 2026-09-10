import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Joining a competition.
 *
 * Registering an account and entering a competition were two separate things,
 * and nothing did the second one — so a new sign-up had a User row, no
 * Participant, and the "Build my portfolio" button on the onboarding page led
 * to a 404. That is the whole bug this function exists to close.
 *
 * Kept out of the server action so it can be tested: creating the participant,
 * the portfolio and the funding row must happen together or not at all, and
 * "not at all" is the case that produced the 404.
 *
 * Idempotent. Re-running for someone already enrolled returns their existing
 * participation rather than funding them twice — the unique index on
 * (userId, competitionId) is the real guarantee, and this is the friendly path
 * to the same answer.
 */

export type EnrolResult =
  | { ok: true; participantId: string; portfolioId: string; created: boolean }
  | { ok: false; code: string; error: string };

export async function enrolInCompetition(
  db: PrismaClient,
  args: { userId: string; competitionId?: string },
): Promise<EnrolResult> {
  const competition = args.competitionId
    ? await db.competition.findUnique({ where: { id: args.competitionId } })
    : await db.competition.findFirst({
        where: { deletedAt: null, status: { in: ["REGISTRATION", "RUNNING"] } },
        orderBy: { startsAt: "desc" },
      });

  if (!competition) {
    return {
      ok: false,
      code: "NO_COMPETITION",
      error:
        "There is no competition open at the moment. You will be able to join as soon as an administrator opens one.",
    };
  }

  const existing = await db.participant.findUnique({
    where: { userId_competitionId: { userId: args.userId, competitionId: competition.id } },
    include: { portfolio: { select: { id: true } } },
  });

  if (existing?.portfolio) {
    return {
      ok: true,
      participantId: existing.id,
      portfolioId: existing.portfolio.id,
      created: false,
    };
  }

  if (!competition.registrationOpen) {
    return {
      ok: false,
      code: "REGISTRATION_CLOSED",
      error: `Registration for ${competition.name} is closed. Ask the competition administrator to reopen it.`,
    };
  }

  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { firstName: true, lastName: true, deletedAt: true, isDisabled: true },
  });
  if (!user || user.deletedAt !== null || user.isDisabled) {
    return { ok: false, code: "NO_USER", error: "That account cannot join a competition." };
  }

  const capital = competition.startingCapitalCents;
  const joinedAt = new Date();

  // Participant, portfolio and the funding row are written together. A
  // participant without a funded portfolio is precisely the broken state that
  // produced a 404 on the page they were sent to next.
  const result = await db.$transaction(async (tx) => {
    const participant =
      existing ??
      (await tx.participant.create({
        data: {
          userId: args.userId,
          competitionId: competition.id,
          // Surname initial only, matching the seeded participants, so the
          // leaderboard reads consistently whoever created the row.
          displayName: `${user.firstName} ${user.lastName.charAt(0)}.`,
          initialCapitalCents: capital,
          status: "REGISTERED",
          joinedAt,
        },
      }));

    const portfolio = await tx.portfolio.create({
      data: {
        participantId: participant.id,
        competitionId: competition.id,
        status: "DRAFT",
        initialCapitalCents: capital,
        cashCents: capital,
        transactionSeq: 1,
      },
    });

    await tx.transaction.create({
      data: {
        portfolioId: portfolio.id,
        participantId: participant.id,
        sequence: 1,
        type: "INITIAL_FUNDING",
        tradeDate: competition.startDate,
        executedAt: joinedAt,
        cashDeltaCents: capital,
        cashAfterCents: capital,
        isExternalFlow: true,
        note: "Starting virtual capital",
      },
    });

    return { participantId: participant.id, portfolioId: portfolio.id };
  });

  return { ok: true, ...result, created: true };
}
