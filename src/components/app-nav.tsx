import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { env } from "@/lib/env";
import type { SessionUser } from "@/server/auth/session";

export function AppNav({
  user,
  links,
}: {
  user: SessionUser;
  links: { href: string; label: string }[];
}) {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          {env.COMPANY_NAME} <span className="text-[var(--text-muted)]">Challenge</span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:mx-0 sm:w-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user.isDemo ? (
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              demo
            </span>
          ) : null}
          <span className="hidden text-sm text-[var(--text-muted)] sm:inline">
            {user.firstName} {user.lastName}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
