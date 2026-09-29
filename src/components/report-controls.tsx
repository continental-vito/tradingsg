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
  build,
}: {
  competitionId: string;
  build: (input: {
    competitionId: string;
    introMessage?: string;
    showLeaderboard: boolean;
    showIndividual: boolean;
    leaderboardSize: number;
  }) => Promise<ReportActionResult>;
}) {
  const { pending, result, run } = useReportAction();
  const [intro, setIntro] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showIndividual, setShowIndividual] = useState(true);
  const [size, setSize] = useState(10);

  return (
    <div className="space-y-3">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            build({
              competitionId,
              introMessage: intro || undefined,
              showLeaderboard,
              showIndividual,
              leaderboardSize: size,
            }),
          );
        }}
      >
        <Field label="Introductory message" hint="Optional. Printed at the top of the PDF.">
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
            Include the top of the leaderboard
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showIndividual}
              onChange={(e) => setShowIndividual(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            Include every participant&rsquo;s results
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
