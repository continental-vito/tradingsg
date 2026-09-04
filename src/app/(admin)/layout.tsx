import { AppNav } from "@/components/app-nav";
import { requireAdmin } from "@/server/auth/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav
        user={user}
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
