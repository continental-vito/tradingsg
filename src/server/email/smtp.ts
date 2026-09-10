import { createTransport, type Transporter } from "nodemailer";
import { EmailError, type EmailMessage, type EmailProvider, type SendResult } from "./provider";

/**
 * SMTP delivery. The only file that knows this library exists.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    if (!config.host || !config.user) {
      throw new EmailError(
        "SMTP was selected but SMTP_HOST or SMTP_USER is empty. Fill both in .env, or set EMAIL_PROVIDER=console to write emails to disk instead.",
        "MISSING_CONFIG",
      );
    }
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      // 465 is implicit TLS; everything else negotiates STARTTLS.
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.config.from,
        to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      return { providerMessageId: info.messageId };
    } catch (error: unknown) {
      throw new EmailError(
        `The mail server refused the message: ${error instanceof Error ? error.message : String(error)}`,
        "SEND_FAILED",
      );
    }
  }
}
