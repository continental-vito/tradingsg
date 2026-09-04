import Link from "next/link";
import { env } from "@/lib/env";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {env.COMPANY_NAME} <span className="text-[var(--text-muted)]">Stock Challenge</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-accent-600 px-3.5 py-2 font-medium text-white hover:bg-accent-700"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[var(--border)] px-5 py-6 text-center text-xs text-[var(--text-muted)]">
        Virtual capital only. No real money is invested and nothing here is investment advice.
      </footer>
    </div>
  );
}
