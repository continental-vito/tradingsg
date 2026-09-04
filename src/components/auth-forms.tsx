"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { FormState } from "@/app/actions/auth";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Split out so the button can read useFormStatus, which only reports the status
 * of the <form> above it in the tree.
 */
function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : children}
    </Button>
  );
}

export function LoginForm({ action, notice }: { action: Action; notice?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Submit>Log in</Submit>
      <p className="text-center text-sm text-[var(--text-muted)]">
        <Link href="/forgot-password" className="hover:text-[var(--text)]">
          Forgotten your password?
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={err("firstName")}>
          <Input name="firstName" autoComplete="given-name" required autoFocus />
        </Field>
        <Field label="Last name" error={err("lastName")}>
          <Input name="lastName" autoComplete="family-name" required />
        </Field>
      </div>
      <Field label="Email" error={err("email")}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" hint="At least 8 characters." error={err("password")}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Department" hint="Optional — it groups the leaderboard by team.">
        <Input name="department" autoComplete="organization" />
      </Field>
      <Submit>Create my account</Submit>
    </form>
  );
}

export function ForgotPasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Submit>Send me a reset link</Submit>
    </form>
  );
}

export function ResetPasswordForm({ action, token }: { action: Action; token: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="New password" hint="At least 8 characters." error={state.fieldErrors?.password}>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
        />
      </Field>
      <Submit>Set my new password</Submit>
    </form>
  );
}
