import type { Metadata } from "next";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { AuthLink, AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link. It is valid for one hour."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm action={requestPasswordResetAction} />
    </AuthShell>
  );
}
