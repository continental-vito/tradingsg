/**
 * The seam every outgoing email crosses.
 *
 * No provider's name appears outside its own file in this directory —
 * build/check-scripts.sh greps for `resend` and `nodemailer` across src/ and
 * fails CI on a hit anywhere else.
 */

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  providerMessageId?: string;
  /** Where a file-based provider put it, so the admin UI can link to it. */
  path?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "EmailError";
  }
}
