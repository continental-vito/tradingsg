import type { Metadata } from "next";
import { loginAction } from "@/app/actions/auth";
import { LoginForm } from "@/components/auth-forms";
import { AuthLink, AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your portfolio and where you stand."
      footer={
        <>
          No account yet? <AuthLink href="/register">Sign up</AuthLink>
        </>
      }
    >
      <LoginForm
        action={loginAction}
        notice={reset ? "Your password has been changed. Sign in with your new one." : undefined}
      />
    </AuthShell>
  );
}
