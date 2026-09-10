"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { ReportActionResult } from "@/app/actions/reports";

function useReportAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReportActionResult | null>(null);
  const run = (fn: () => Promise<ReportActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
    });
  return { pending, result, run };
}

function Feedback({ result }: { result: ReportActionResult | null }) {
  if (!result) return null;
  if (result.error) return <Alert>{result.error}</Alert>;
  return <Alert tone="success">{result.message}</Alert>;
}

export function BuildReportForm({
  competitionId,
  defaultSubject,
  build,
}: {
  competitionId: string;
  defaultSubject: string;
  build: (input: {
    competitionId: string;
    subject?: string;
    introMessage?: string;
    showLeaderboard: boolean;
    showIndividual: boolean;
    leaderboardSize: number;
    force: boolean;
  }) => Promise<ReportActionResult>;
}) {
  const { pending, result, run } = useReportAction();
  const [subject, setSubject] = useState(defaultSubject);
  const [intro, setIntro] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showIndividual, setShowIndividual] = useState(true);
  const [size, setSize] = useState(10);
  const [force, setForce] = useState(false);

  return (
    <div className="space-y-3">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            build({
              competitionId,
              subject: subject || undefined,
              introMessage: intro || undefined,
              showLeaderboard,
              showIndividual,
              leaderboardSize: size,
              force,
            }),
          );
        }}
      >
        <Field label="Subject line">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </Field>

        <Field
          label="Introductory message"
          hint="Optional. Appears above everyone's personal section."
        >
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Leaderboard size" hint="How many places to list.">
            <Input
              type="number"
              min={3}
              max={50}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showLeaderboard}
              onChange={(e) => setShowLeaderboard(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Include the leaderboard
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showIndividual}
              onChange={(e) => setShowIndividual(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Include each person&rsquo;s own performance
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Rebuild even if already sent
          </label>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Building…" : "Build this week's report"}
        </Button>
      </form>
      <Feedback result={result} />
    </div>
  );
}

export function SendControls({
  reportId,
  status,
  recipientCount,
  testSend,
  send,
  schedule,
}: {
  reportId: string;
  status: string;
  recipientCount: number;
  testSend: (id: string, email: string) => Promise<ReportActionResult>;
  send: (id: string) => Promise<ReportActionResult>;
  schedule: (id: string, whenIso: string) => Promise<ReportActionResult>;
}) {
  const { pending, result, run } = useReportAction();
  const [testEmail, setTestEmail] = useState("");
  const [when, setWhen] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Send a test to" hint="Sends the top-ranked recipient's real email.">
          <Input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Button
          variant="secondary"
          disabled={pending || !testEmail}
          onClick={() => run(() => testSend(reportId, testEmail))}
        >
          Send test
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Or schedule it">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          disabled={pending || !when}
          onClick={() => run(() => schedule(reportId, new Date(when).toISOString()))}
        >
          Schedule
        </Button>
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        {status === "SENT" ? (
          <p className="text-sm text-[var(--text-muted)]">
            This report has been sent. Sending again would deliver a second copy of the same week.
          </p>
        ) : !confirming ? (
          <Button onClick={() => setConfirming(true)} disabled={pending}>
            Send to all {recipientCount} recipients
          </Button>
        ) : (
          <div>
            <p className="mb-3 text-sm">
              This delivers {recipientCount} emails immediately. Each one is the exact HTML you can
              preview above — nothing is re-rendered at send time.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => run(() => send(reportId))} disabled={pending}>
                {pending ? "Sending…" : "Yes, send now"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <Feedback result={result} />
    </div>
  );
}
