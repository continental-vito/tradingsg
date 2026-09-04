import type { Metadata } from "next";
import { resetPasswordAction } from "@/app/actions/auth";
import { ResetPasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Setting a new password signs out every other device."
    >
      <ResetPasswordForm action={resetPasswordAction} token={token} />
    </AuthShell>
  );
}
