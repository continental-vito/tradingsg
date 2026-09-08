"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, EmptyState } from "@/components/ui";
import type { JoinResult } from "@/app/actions/join";

/**
 * What anyone sees when they have an account but no participation.
 *
 * This replaces a bare 404. Being told a page does not exist, on your own
 * portfolio, is both wrong and unactionable — the page exists, you are simply
 * not in a competition yet, and that is fixable from right here.
 */
export function JoinPrompt({
  competitionName,
  registrationOpen,
  startingCapital,
  join,
}: {
  competitionName: string | null;
  registrationOpen: boolean;
  startingCapital: string | null;
  join: () => Promise<JoinResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<JoinResult | null>(null);

  if (!competitionName) {
    return (
      <EmptyState
        title="No competition is running"
        body="There is nothing to join at the moment. When an administrator opens one, it will appear here and you can build your portfolio."
      />
    );
  }

  return (
    <div className="space-y-4">
      <EmptyState
        title={`You have not joined ${competitionName} yet`}
        body={
          registrationOpen
            ? `Joining gives you ${startingCapital} of virtual capital to allocate. You will not appear on the leaderboard until you have invested it.`
            : `Registration for ${competitionName} is closed. Ask the competition administrator to reopen it if you would like to take part.`
        }
        action={
          registrationOpen ? (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await join();
                  setResult(r);
                  if (r.ok) router.refresh();
                })
              }
            >
              {pending ? "Joining…" : "Join the competition"}
            </Button>
          ) : undefined
        }
      />
      {result?.error ? <Alert>{result.error}</Alert> : null}
      {result?.ok ? <Alert tone="success">{result.message}</Alert> : null}
    </div>
  );
}
