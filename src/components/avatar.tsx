/**
 * A participant's avatar.
 *
 * Initials on a colour derived from the name, not an upload. Deliberately:
 *
 *   - an upload needs storage that survives a deploy, a size and type check, an
 *     image pipeline, and a moderation answer for a competition that is
 *     company-wide, and
 *   - the thing an avatar is actually for here — telling one row from another
 *     at a glance — is served perfectly well by two letters.
 *
 * `avatarUrl` is honoured when set, so an upload or a Gravatar can be added
 * later without changing anything that renders one.
 */

const TONES = [
  "bg-[var(--color-series-1)]",
  "bg-[var(--color-series-2)]",
  "bg-[var(--color-series-3)]",
  "bg-[var(--color-series-4)]",
  "bg-[var(--color-series-5)]",
  "bg-[var(--color-series-6)]",
  "bg-[var(--color-series-7)]",
  "bg-[var(--color-series-8)]",
];

/** Stable per name, so somebody's colour does not change between pages. */
function toneFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return TONES[(hash >>> 0) % TONES.length] ?? TONES[0]!;
}

function initialsOf(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s.'-]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
} as const;

export function Avatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  if (avatarUrl) {
    return (
      /* An arbitrary external avatar cannot go through next/image: the
         optimiser needs every host allow-listed at build time, and the point
         of this field is that the URL is not known in advance. */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        className={`${SIZES[size]} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${SIZES[size]} ${toneFor(name)} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}
    >
      {initialsOf(name)}
    </span>
  );
}
