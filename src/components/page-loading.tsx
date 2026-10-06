/**
 * Shown the instant a nav link is clicked, while the server renders the page.
 *
 * Every page here is dynamic, and Next.js does not prefetch a dynamic route
 * without a loading boundary — so a click showed nothing at all until the
 * whole page had come back from the server, the first click looked ignored,
 * and people clicked twice. With this boundary the nav stays put, the
 * placeholder appears immediately, and the route's shell is prefetched.
 */
export function PageLoading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-[var(--surface-raised)]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)]"
          />
        ))}
      </div>
      <div className="h-80 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-raised)]" />
    </div>
  );
}
