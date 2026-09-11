import type { Metadata } from "next";
import {
  markAllReadAction,
  markNotificationReadAction,
  setNotificationPreferenceAction,
} from "@/app/actions/notifications";
import { NotificationList, PreferenceToggles } from "@/components/notification-list";
import { Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * Only the types an administrator has enabled for this competition are offered.
 * A toggle for something that can never fire is a promise the app cannot keep.
 */
const TYPES: { type: string; label: string; description: string; setting: string }[] = [
  {
    type: "COMPETITION_START",
    label: "The competition starts",
    description: "Once, when trading opens.",
    setting: "notifyCompetitionStart",
  },
  {
    type: "SETUP_DEADLINE",
    label: "I still have not built a portfolio",
    description: "A weekly reminder while you are holding cash, not a daily one.",
    setting: "notifySetupDeadline",
  },
  {
    type: "WEEKLY_REPORT",
    label: "My weekly report is ready",
    description: "When the week's results have been sent.",
    setting: "notifyWeeklyReport",
  },
  {
    type: "ENTERED_TOP_THREE",
    label: "I reach the top three",
    description: "Only when you move into it, not every day you stay there.",
    setting: "notifyEnteredTopThree",
  },
  {
    type: "OVERTAKEN",
    label: "Someone overtakes me",
    description: "Off unless the administrator turns it on — it fires often.",
    setting: "notifyOvertaken",
  },
  {
    type: "COMPETITION_END",
    label: "The competition is ending",
    description: "In the final week, and again when it finishes.",
    setting: "notifyCompetitionEnd",
  },
];

export default async function NotificationsPage() {
  const user = await requireUser();

  const [notifications, prefs, participant] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.notificationPreference.findMany({ where: { userId: user.id } }),
    db.participant.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { joinedAt: "desc" },
      include: {
        competition: {
          include: {
            settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
          },
        },
      },
    }),
  ]);

  const settings = participant?.competition.settings[0];
  const byChannel = new Map(prefs.map((p) => [`${p.type}:${p.channel}`, p.enabled]));

  // Only the weekly report is ever sent by email, so it is the only type that
  // gets a live email toggle — offering one that can never fire is a promise
  // the app cannot keep.
  const EMAILED = new Set(["WEEKLY_REPORT"]);

  const available = TYPES.filter(
    (t) => settings?.[t.setting as keyof typeof settings] === true,
  ).map((t) => ({
    type: t.type,
    label: t.label,
    description: t.description,
    inApp: byChannel.get(`${t.type}:IN_APP`) ?? true,
    email: EMAILED.has(t.type) ? (byChannel.get(`${t.type}:EMAIL`) ?? true) : null,
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          What the competition has told you, and what you want to hear about.
        </p>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="Notifications appear here when the competition starts, when your report is ready, and when your position changes."
        />
      ) : (
        <NotificationList
          items={notifications.map((n) => ({
            id: n.id,
            type: n.type,
            severity: n.severity,
            title: n.title,
            body: n.body,
            linkUrl: n.linkUrl,
            createdAt: n.createdAt.toISOString().slice(0, 16).replace("T", " "),
            read: n.readAt !== null,
          }))}
          markRead={markNotificationReadAction}
          markAllRead={markAllReadAction}
        />
      )}

      <Card>
        <h2 className="text-sm font-medium">What to notify me about</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          &ldquo;Here&rdquo; is this page. &ldquo;Email&rdquo; stops the message reaching your inbox
          — turning it off for the weekly report means the report is not sent to you at all.
        </p>
        {available.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            The competition administrator has not enabled any notifications.
          </p>
        ) : (
          <div className="mt-3">
            <PreferenceToggles
              preferences={available}
              setPreference={setNotificationPreferenceAction}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
