import { env } from "@/lib/env";
import { ConsoleEmailProvider } from "./console";
import { ResendEmailProvider } from "./resend";
import { SmtpEmailProvider } from "./smtp";
import type { EmailProvider } from "./provider";

export type { EmailMessage, EmailProvider, SendResult } from "./provider";
export { EmailError } from "./provider";

export function createEmailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return new SmtpEmailProvider({
        host: env.SMTP_HOST ?? "",
        port: env.SMTP_PORT ?? 587,
        user: env.SMTP_USER ?? "",
        password: env.SMTP_PASSWORD ?? "",
        from: env.EMAIL_FROM,
      });
    case "resend":
      return new ResendEmailProvider(env.RESEND_API_KEY ?? "", env.EMAIL_FROM);
    case "console":
      return new ConsoleEmailProvider(env.EMAIL_OUTBOX_DIR);
  }
}
