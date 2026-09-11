"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/guard";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { revokeOtherSessions } from "@/server/auth/session";
import { db } from "@/server/db";

export interface AccountResult {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(60),
  lastName: z.string().trim().min(1, "Enter your last name.").max(60),
  department: z.string().trim().max(80).optional(),
  displayName: z
    .string()
    .trim()
    .min(2, "Your leaderboard name needs at least two characters.")
    .max(40)
    .optional(),
});

export async function updateProfileAction(
  input: z.input<typeof profileSchema>,
): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      department: parsed.data.department || null,
    },
  });

  // The leaderboard name is per-competition, so it lives on the participant
  // rather than the account — the same person could play under different
  // names in different seasons.
  if (parsed.data.displayName) {
    await db.participant.updateMany({
      where: { userId: user.id, deletedAt: null },
      data: { displayName: parsed.data.displayName },
    });
  }

  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  return { ok: true, message: "Saved." };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(200, "That is longer than 200 characters."),
});

/**
 * Changing a password while signed in.
 *
 * The current password is required even though the session already proves who
 * this is: a session is proof that somebody opened the laptop, not that they
 * are the account holder. Without it, an unattended screen is a permanent
 * account takeover.
 */
export async function changePasswordAction(
  input: z.input<typeof passwordSchema>,
): Promise<AccountResult> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const record = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!(await verifyPassword(record.passwordHash, parsed.data.currentPassword))) {
    return { ok: false, fieldErrors: { currentPassword: "That is not your current password." } };
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { ok: false, fieldErrors: { newPassword: "That is the password you already have." } };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // Every OTHER device loses its session, which is the main thing a password
  // change is for. This one is deliberately kept, so improving your security
  // does not sign you out of the page you just used.
  const revoked = await revokeOtherSessions(user.id, "PASSWORD_CHANGE");

  await db.auditLog.create({
    data: {
      actorUserId: user.id,
      actorRole: user.role,
      action: "account.password_change",
      entityType: "User",
      entityId: user.id,
    },
  });

  return {
    ok: true,
    message:
      revoked > 0
        ? `Password changed. ${revoked} other session${revoked === 1 ? "" : "s"} signed out; this one is still active.`
        : "Password changed.",
  };
}
