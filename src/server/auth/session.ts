import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/server/db";

export const SESSION_COOKIE = "tradingsg_session";

/** Seven days, refreshed at most once an hour (see touchSession). */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 60 * 60 * 1000;

/**
 * The cookie carries 32 random bytes; the database stores only their SHA-256.
 * A database dump therefore does not hand over live sessions. SHA-256 rather
 * than argon2 here on purpose: the token is already 256 bits of entropy, so
 * there is nothing to brute-force, and this runs on every single request.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl: string | null;
  department: string | null;
  isDemo: boolean;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      // The raw address is never stored — it is only ever compared, and a hash
      // compares just as well without keeping personal data around.
      ipHash: meta.ip ? createHash("sha256").update(meta.ip).digest("hex") : null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Wrapped in React's `cache` so that a page with a layout guard, three server
 * components and a server action performs one database read, not five.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  // A disabled account must lose access on its next request, not when its
  // cookie happens to expire a week later.
  if (session.user.isDisabled || session.user.deletedAt !== null) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    role: session.user.role,
    avatarUrl: session.user.avatarUrl,
    department: session.user.department,
    isDemo: session.user.isDemo,
  };
});

/** Slides the expiry, but writes at most once an hour per session. */
export async function touchSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;

  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({ where: { tokenHash } });
  if (!session || session.revokedAt !== null) return;
  if (Date.now() - session.lastSeenAt.getTime() < SESSION_REFRESH_MS) return;

  await db.session.update({
    where: { tokenHash },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "LOGOUT" },
    });
  }
  store.delete(SESSION_COOKIE);
}

/** Every session of one user, e.g. after a password change or an admin disable. */
export async function revokeAllSessions(userId: string, reason: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
