"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { burnPasswordTime, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, revokeAllSessions } from "@/server/auth/session";
import { sendPasswordResetEmail, sendWelcomeEmail } from "@/server/email/transactional";
import { enrolInCompetition } from "@/server/portfolio/enrol";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
}

/** Lowercased and trimmed, because User.email is unique and case is not identity. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

const passwordRule = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(200, "That is longer than 200 characters.");

const registerSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name."),
  lastName: z.string().trim().min(1, "Enter your last name."),
  email: z.string().trim().email("That does not look like an email address."),
  password: passwordRule,
  department: z.string().trim().max(80).optional(),
});

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
    department: formData.get("department") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return {
      fieldErrors: {
        email:
          "An account already exists for this address. Sign in instead, or reset your password.",
      },
    };
  }

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      department: parsed.data.department ?? null,
      role: "PARTICIPANT",
    },
    select: { id: true },
  });

  // Signing up IS joining. Creating an account without a participant row left
  // people with a working login and a 404 on the page onboarding sent them to
  // next, which is the worst possible first impression.
  //
  // A failure here is not fatal — the account exists and the dashboard explains
  // what happened with a button to retry — so registration is never blocked by
  // a competition being closed.
  await enrolInCompetition(db, { userId: user.id });

  const competition = await db.competition.findFirst({
    where: { deletedAt: null, status: { in: ["REGISTRATION", "RUNNING"] } },
    orderBy: { startsAt: "desc" },
    select: { startingCapitalCents: true, currency: true },
  });
  await sendWelcomeEmail({
    to: email,
    firstName: parsed.data.firstName,
    userId: user.id,
    startingCapital: formatCents(
      competition?.startingCapitalCents ?? 10_000_000n,
      competition?.currency ?? "EUR",
    ),
  });

  await createSession(user.id, await requestMeta());
  redirect("/onboarding");
}

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter your email address and password." };
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await db.user.findUnique({ where: { email } });

  // One message for "no such account" and for "wrong password", and the same
  // work done in both branches — otherwise the response time enumerates who
  // works here.
  const wrong = { error: "That email address and password do not match." };

  if (!user || user.deletedAt !== null) {
    await burnPasswordTime(parsed.data.password);
    return wrong;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return {
      error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`,
    };
  }

  if (!(await verifyPassword(user.passwordHash, parsed.data.password))) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        // Ten attempts then a fifteen-minute pause. Long enough to stop online
        // guessing, short enough that a forgetful colleague is not locked out
        // of a competition for the afternoon.
        lockedUntil: failed >= 10 ? new Date(Date.now() + 15 * 60_000) : null,
      },
    });
    return wrong;
  }

  if (user.isDisabled) {
    return {
      error: "This account has been disabled. Contact the competition administrator.",
    };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, await requestMeta());
  redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  // Always the same answer. Telling an anonymous visitor whether an address is
  // registered is a membership disclosure, and here membership is employment.
  const answer = {
    success:
      "If that address has an account, a reset link is on its way. The link is valid for one hour.",
  };

  if (!email) return { error: "Enter the email address you registered with." };

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, deletedAt: true },
  });
  if (!user || user.deletedAt !== null) return answer;

  const token = randomBytes(32).toString("base64url");
  const record = await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  // Awaited, but its failures are swallowed inside: this action must answer
  // identically whether or not the address exists, and letting a send error
  // surface here would turn the reset form into an account oracle.
  await sendPasswordResetEmail({
    to: email,
    firstName: user.firstName,
    token,
    tokenId: record.id,
  });

  return answer;
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: passwordRule,
});

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: { password: parsed.error.issues[0]?.message ?? "Invalid password." } };
  }

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!record || record.consumedAt !== null || record.expiresAt.getTime() < Date.now()) {
    return {
      error: "That reset link has expired or has already been used. Request a new one.",
    };
  }

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(parsed.data.password),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  // Anyone holding a stolen session must lose it when the password changes —
  // that is the main thing a password reset is for.
  await revokeAllSessions(record.userId, "PASSWORD_CHANGE");

  redirect("/login?reset=1");
}
