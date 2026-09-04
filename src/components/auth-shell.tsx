import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
      <div className="mt-8">{children}</div>
      {footer ? (
        <div className="mt-6 text-center text-sm text-[var(--text-muted)]">{footer}</div>
      ) : null}
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent-600 hover:text-accent-700">
      {children}
    </Link>
  );
}
