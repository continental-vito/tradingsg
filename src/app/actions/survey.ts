"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { recordAnswers } from "@/server/survey/questions";

/**
 * A participant answering the login questions. The user is always the caller:
 * nobody can answer, or change an answer, for anyone else, and whether an
 * answer may change at all is decided in recordAnswers, not here.
 */

const answersSchema = z
  .array(z.object({ questionId: z.string().min(1), answer: z.boolean() }))
  .min(1)
  .max(50);

export interface AnswerResult {
  ok: boolean;
  error?: string;
}

export async function submitAnswersAction(
  rawAnswers: unknown,
  next: "dashboard" | "account" = "dashboard",
): Promise<AnswerResult> {
  const user = await requireUser();
  const parsed = answersSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    return { ok: false, error: "Those answers could not be read. Reload the page and try again." };
  }

  const result = await recordAnswers(db, user.id, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  await db.auditLog.create({
    data: {
      actorUserId: user.id,
      actorRole: user.role,
      action: "survey.answer",
      entityType: "User",
      entityId: user.id,
      afterJson: JSON.stringify(parsed.data),
    },
  });

  if (next === "account") {
    revalidatePath("/account");
    return { ok: true };
  }
  redirect("/dashboard");
}
