"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { NotificationType } from "@/lib/enums";

/**
 * Notifications are per-user, so every mutation here filters by the caller's own
 * id in the same query that finds the row — never a lookup followed by a check.
 */

export async function markNotificationReadAction(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const result = await db.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return { ok: result.count > 0 };
}

export async function markAllReadAction(): Promise<{ ok: boolean; count: number }> {
  const user = await requireUser();
  const result = await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true, count: result.count };
}

const prefSchema = z.object({
  type: NotificationType.schema,
  // IN_APP silences the item in the notifications list; EMAIL stops the weekly
  // report being sent. They are separate because wanting one is not wanting
  // both — and until the report honoured EMAIL, turning it off was a lie.
  channel: z.enum(["IN_APP", "EMAIL"]).default("IN_APP"),
  enabled: z.boolean(),
});

/**
 * The parameter is deliberately the loose wire shape, not the narrowed union.
 * Anything a browser sends is a string until it has been validated, and the
 * Zod parse below is what narrows it — a signature that claims the union would
 * be asserting the very thing this function exists to check.
 */
export async function setNotificationPreferenceAction(input: {
  type: string;
  channel?: string;
  enabled: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a notification type." };

  await db.notificationPreference.upsert({
    where: {
      userId_type_channel: {
        userId: user.id,
        type: parsed.data.type,
        channel: parsed.data.channel,
      },
    },
    update: { enabled: parsed.data.enabled },
    create: {
      userId: user.id,
      type: parsed.data.type,
      channel: parsed.data.channel,
      enabled: parsed.data.enabled,
    },
  });

  revalidatePath("/notifications");
  return { ok: true };
}
