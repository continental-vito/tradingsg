import type { Metadata } from "next";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${env.COMPANY_NAME} Stock Challenge`,
    template: `%s · ${env.COMPANY_NAME} Stock Challenge`,
  },
  description:
    "An internal virtual stock trading competition. Build a portfolio, track your performance, climb the leaderboard. No real money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
