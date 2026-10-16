import { env } from "@/lib/env";

/**
 * Its own layout, outside (participant), because the participant layout is
 * what sends people here: inside it, this page would redirect to itself.
 */
export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-5 py-4 text-sm font-semibold tracking-tight">
          {env.COMPANY_NAME} <span className="text-[var(--text-muted)]">Stock Challenge</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
