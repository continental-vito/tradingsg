"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { enrolInCompetition } from "@/server/portfolio/enrol";

export interface JoinResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Joins the open competition. Used by the empty state anyone lands on when they
 * have an account but no participation — a colleague who registered while
 * registration was closed, an administrator who wants to play too, or anyone
 * whose enrolment failed at sign-up.
 */
export async function joinCompetitionAction(): Promise<JoinResult> {
  const user = await requireUser();
  const result = await enrolInCompetition(db, { userId: user.id });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/portfolio");
  revalidatePath("/competition");
  revalidatePath("/leaderboard");

  return {
    ok: true,
    message: result.created
      ? "You are in. Build your portfolio to join the leaderboard."
      : "You are already taking part.",
  };
}
