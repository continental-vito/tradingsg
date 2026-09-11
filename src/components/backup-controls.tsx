"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import type { BackupResult } from "@/app/actions/backups";

export function GenerateBackupButton({
  competitionId,
  generate,
}: {
  competitionId: string;
  generate: (competitionId: string) => Promise<BackupResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<BackupResult | null>(null);

  return (
    <div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await generate(competitionId);
            setResult(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Writing…" : "Back up now"}
      </Button>
      {result ? (
        <div className="mt-3">
          {result.ok ? (
            <Alert tone="success">{result.message}</Alert>
          ) : (
            <Alert>{result.error}</Alert>
          )}
        </div>
      ) : null}
    </div>
  );
}
