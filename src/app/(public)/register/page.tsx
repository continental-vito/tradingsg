import type { Metadata } from "next";
import { registerAction } from "@/app/actions/auth";
import { RegisterForm } from "@/components/auth-forms";
import { AuthLink, AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Sign up" };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Join the competition"
      subtitle="It takes about a minute. You will pick your portfolio next."
      footer={
        <>
          Already registered? <AuthLink href="/login">Log in</AuthLink>
        </>
      }
    >
      <RegisterForm action={registerAction} />
    </AuthShell>
  );
}
