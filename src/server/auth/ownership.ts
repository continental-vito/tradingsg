import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The ownership queries, separated from the guards that call them.
 *
 * The guards in guard.ts call notFound() and redirect(), which only work inside
 * a Next request. Access control is the one thing here that must be provable by
 * a test rather than by reading, so the query lives on its own where a test can
 * run it against a real database.
 *
 * In every case ownership is expressed as part of the `where` clause, never as
 * a comparison after the fact. A "find, then check" pair is one forgotten early
 * return away from serving someone else's portfolio.
 */

export interface OwnedPortfolio {
  id: string;
  participantId: string;
  competitionId: string;
}

export async function findOwnedPortfolio(
  db: PrismaClient,
  { userId, role, portfolioId }: { userId: string; role: string; portfolioId: string },
): Promise<OwnedPortfolio | null> {
  const portfolio = await db.portfolio.findFirst({
    where:
      role === "ADMIN"
        ? { id: portfolioId }
        : { id: portfolioId, participant: { userId, deletedAt: null } },
    select: { id: true, participantId: true, competitionId: true },
  });
  return portfolio ?? null;
}

export interface OwnedParticipation {
  id: string;
  competitionId: string;
  portfolioId: string | null;
}

export async function findOwnParticipation(
  db: PrismaClient,
  { userId, competitionId }: { userId: string; competitionId: string },
): Promise<OwnedParticipation | null> {
  const participant = await db.participant.findFirst({
    where: { userId, competitionId, deletedAt: null },
    select: { id: true, competitionId: true, portfolio: { select: { id: true } } },
  });
  if (!participant) return null;
  return {
    id: participant.id,
    competitionId: participant.competitionId,
    portfolioId: participant.portfolio?.id ?? null,
  };
}
