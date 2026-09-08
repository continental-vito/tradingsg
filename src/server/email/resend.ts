import { EmailError, type EmailMessage, type EmailProvider, type SendResult } from "./provider";

/**
 * Delivery through Resend's HTTP API. The only file that names this provider.
 *
 * Called with fetch rather than the vendor SDK: one endpoint, one shape, and no
 * dependency to keep current.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey) {
      throw new EmailError(
        "Resend was selected but RESEND_API_KEY is empty. Get a key at https://resend.com/api-keys, or set EMAIL_PROVIDER=console.",
        "MISSING_API_KEY",
      );
    }
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new EmailError("Resend rejected the API key. Check RESEND_API_KEY.", "BAD_API_KEY");
    }
    if (response.status === 429) {
      throw new EmailError(
        "Resend rate limit reached. The send job will retry the remaining recipients on its next run.",
        "RATE_LIMITED",
      );
    }
    if (!response.ok) {
      const body = await response.text();
      throw new EmailError(
        `Resend returned ${response.status}: ${body.slice(0, 200)}`,
        "SEND_FAILED",
      );
    }

    const json = (await response.json()) as { id?: string };
    return { providerMessageId: json.id };
  }
}
