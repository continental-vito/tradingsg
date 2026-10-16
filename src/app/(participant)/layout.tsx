import { ADMIN_LINKS, AppNav } from "@/components/app-nav";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { pendingQuestions } from "@/server/survey/questions";

/**
 * The layout guard is a convenience, not the security boundary: a server action
 * is reachable by POST without this ever rendering. Every action re-checks.
 */
export default async function ParticipantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Unanswered login questions come before anything else. Asked here rather
  // than in the login action so a question added mid-competition is put to
  // people who are already signed in, at their next page load.
  if (user.role !== "ADMIN" && (await pendingQuestions(db, user.id)).length > 0) {
    redirect("/questions");
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav
        user={user}
        links={
          user.role === "ADMIN"
            ? ADMIN_LINKS
            : [
                { href: "/dashboard", label: "Dashboard" },
                { href: "/portfolio", label: "Portfolio" },
                { href: "/leaderboard", label: "Leaderboard" },
                { href: "/competition", label: "Competition" },
                { href: "/rules", label: "Rules" },
              ]
        }
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
