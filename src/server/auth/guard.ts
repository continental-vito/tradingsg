import "server-only";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { findOwnParticipation, findOwnedPortfolio } from "./ownership";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Every route handler and every server action calls one of these. There is no
 * "the layout already checked it" — a server action is reachable by POST
 * without ever rendering the layout that guards its page.
 */

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    // Not 403. A participant probing /admin learns only that there is nothing
    // there, which is also true from their point of view.
    notFound();
  }
  return user;
}

export interface ParticipantContext {
  user: SessionUser;
  participantId: string;
  competitionId: string;
  portfolioId: string | null;
}

/**
 * Resolves the caller's own participation in a competition.
 *
 * Ownership is filtered in the same query that finds the row, never checked
 * afterwards: a "find then compare" pair is one forgotten early-return away
 * from leaking someone else's portfolio.
 */
export async function requireParticipant(competitionId: string): Promise<ParticipantContext> {
  const user = await requireUser();

  const participant = await findOwnParticipation(db, { userId: user.id, competitionId });
  if (!participant) notFound();

  return {
    user,
    participantId: participant.id,
    competitionId: participant.competitionId,
    portfolioId: participant.portfolioId,
  };
}

/**
 * Loads a portfolio the caller is allowed to see, or 404s.
 *
 * A missing portfolio and someone else's portfolio return the SAME result. A
 * 403 would confirm the id exists, which is precisely the fact being withheld.
 * Admins bypass the ownership filter but not the existence check.
 */
export async function requireOwnedPortfolio(portfolioId: string): Promise<{
  user: SessionUser;
  portfolioId: string;
  participantId: string;
  competitionId: string;
}> {
  const user = await requireUser();

  const portfolio = await findOwnedPortfolio(db, {
    userId: user.id,
    role: user.role,
    portfolioId,
  });
  if (!portfolio) notFound();

  return {
    user,
    portfolioId: portfolio.id,
    participantId: portfolio.participantId,
    competitionId: portfolio.competitionId,
  };
}

/** True when the caller may see another participant's holdings. */
export function canViewOthersHoldings(user: SessionUser, showOthersHoldings: boolean): boolean {
  return user.role === "ADMIN" || showOthersHoldings;
}
