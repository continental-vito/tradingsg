import { AppNav } from "@/components/app-nav";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";

/**
 * The layout guard is a convenience, not the security boundary: a server action
 * is reachable by POST without this ever rendering. Every action re-checks.
 */
export default async function ParticipantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadCount = await db.notification.count({
    where: { userId: user.id, readAt: null },
  });
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav
        user={user}
        unreadCount={unreadCount}
        links={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/portfolio", label: "Portfolio" },
          { href: "/leaderboard", label: "Leaderboard" },
          { href: "/competition", label: "Competition" },
          { href: "/rules", label: "Rules" },
          ...(user.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
        ]}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
