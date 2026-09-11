"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { AccountResult } from "@/app/actions/account";

function useAccountAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AccountResult | null>(null);
  const run = (fn: () => Promise<AccountResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
    });
  return { pending, result, run, setResult };
}

function Feedback({ result }: { result: AccountResult | null }) {
  if (!result) return null;
  if (result.error) return <Alert>{result.error}</Alert>;
  if (result.ok && result.message) return <Alert tone="success">{result.message}</Alert>;
  return null;
}

export function ProfileForm({
  initial,
  save,
}: {
  initial: { firstName: string; lastName: string; department: string; displayName: string };
  save: (input: {
    firstName: string;
    lastName: string;
    department?: string;
    displayName?: string;
  }) => Promise<AccountResult>;
}) {
  const { pending, result, run } = useAccountAction();
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => result?.fieldErrors?.[k];

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            save({
              firstName: form.firstName,
              lastName: form.lastName,
              department: form.department || undefined,
              displayName: form.displayName || undefined,
            }),
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={err("firstName")}>
            <Input
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              required
            />
          </Field>
          <Field label="Last name" error={err("lastName")}>
            <Input
              value={form.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Department" hint="Shown beside your name on the leaderboard.">
          <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
        </Field>
        <Field
          label="Leaderboard name"
          hint="How you appear to everyone else."
          error={err("displayName")}
        >
          <Input
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            maxLength={40}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
      <div className="mt-3">
        <Feedback result={result} />
      </div>
    </div>
  );
}

export function PasswordForm({
  change,
}: {
  change: (input: { currentPassword: string; newPassword: string }) => Promise<AccountResult>;
}) {
  const { pending, result, run } = useAccountAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const err = (k: string) => result?.fieldErrors?.[k];

  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await change({ currentPassword: current, newPassword: next });
            if (r.ok) {
              setCurrent("");
              setNext("");
            }
            return r;
          });
        }}
      >
        <Field
          label="Current password"
          hint="Asked for even though you are signed in — a session proves somebody opened this laptop, not that they are you."
          error={err("currentPassword")}
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint="At least 8 characters." error={err("newPassword")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Button type="submit" disabled={pending || !current || !next}>
          {pending ? "Changing…" : "Change password"}
        </Button>
      </form>
      <div className="mt-3">
        <Feedback result={result} />
      </div>
    </div>
  );
}
