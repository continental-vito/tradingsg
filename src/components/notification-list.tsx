"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui";

export interface NotificationItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: string;
  read: boolean;
}

const SEVERITY: Record<string, string> = {
  SUCCESS: "bg-up-500",
  WARNING: "bg-[var(--color-gold)]",
  ERROR: "bg-down-500",
  INFO: "bg-accent-500",
};

export function NotificationList({
  items,
  markRead,
  markAllRead,
}: {
  items: NotificationItem[];
  markRead: (id: string) => Promise<{ ok: boolean }>;
  markAllRead: () => Promise<{ ok: boolean; count: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="space-y-4">
      {unread > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-muted)]">{unread} unread</p>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markAllRead();
                router.refresh();
              })
            }
          >
            Mark all read
          </Button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={
              "rounded-[var(--radius-card)] border p-4 transition-colors " +
              (item.read
                ? "border-[var(--border)] bg-[var(--surface-raised)]"
                : "border-accent-500/30 bg-accent-50/40")
            }
          >
            <div className="flex gap-3">
              <span
                aria-hidden
                className={
                  "mt-1.5 size-2 shrink-0 rounded-full " +
                  (SEVERITY[item.severity] ?? "bg-accent-500")
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-medium">{item.title}</h2>
                  <time className="tnum text-xs text-[var(--text-muted)]">{item.createdAt}</time>
                </div>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{item.body}</p>
                <div className="mt-2 flex gap-4 text-sm">
                  {item.linkUrl ? (
                    <Link
                      href={item.linkUrl}
                      className="font-medium text-accent-600 hover:text-accent-700"
                      onClick={() => void markRead(item.id)}
                    >
                      Open
                    </Link>
                  ) : null}
                  {!item.read ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await markRead(item.id);
                          router.refresh();
                        })
                      }
                      className="text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PreferenceToggles({
  preferences,
  setPreference,
}: {
  preferences: {
    type: string;
    label: string;
    description: string;
    inApp: boolean;
    /** Null when this type is never emailed, so no dead toggle is offered. */
    email: boolean | null;
  }[];
  setPreference: (input: {
    type: string;
    channel: string;
    enabled: boolean;
  }) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = (type: string, channel: string, enabled: boolean) =>
    start(async () => {
      await setPreference({ type, channel, enabled });
      router.refresh();
    });

  return (
    <div>
      <div className="flex justify-end gap-6 pb-2 text-xs text-[var(--text-muted)]">
        <span className="w-12 text-center">Here</span>
        <span className="w-12 text-center">Email</span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {preferences.map((p) => (
          <li key={p.type} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.label}</div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{p.description}</p>
            </div>
            <div className="flex shrink-0 gap-6">
              <span className="flex w-12 justify-center">
                <input
                  type="checkbox"
                  checked={p.inApp}
                  disabled={pending}
                  onChange={(e) => toggle(p.type, "IN_APP", e.target.checked)}
                  aria-label={`${p.label} — show here`}
                  className="size-4 accent-accent-600"
                />
              </span>
              <span className="flex w-12 justify-center">
                {p.email === null ? (
                  <span className="text-xs text-[var(--text-muted)]" title="Never emailed">
                    —
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={p.email}
                    disabled={pending}
                    onChange={(e) => toggle(p.type, "EMAIL", e.target.checked)}
                    aria-label={`${p.label} — email me`}
                    className="size-4 accent-accent-600"
                  />
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
