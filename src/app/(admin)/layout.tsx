import { AppNav } from "@/components/app-nav";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const unreadCount = await db.notification.count({
    where: { userId: user.id, readAt: null },
  });
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav
        user={user}
        unreadCount={unreadCount}
        links={[
          { href: "/admin", label: "Overview" },
          { href: "/admin/participants", label: "Participants" },
          { href: "/admin/stocks", label: "Stocks" },
          { href: "/admin/leaderboard", label: "Leaderboard" },
          { href: "/admin/reports", label: "Reports" },
          { href: "/dashboard", label: "My portfolio" },
        ]}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
