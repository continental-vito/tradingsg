import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EmailMessage, EmailProvider, SendResult } from "./provider";

/**
 * Writes the rendered email to disk instead of sending it.
 *
 * The default, and not a stub: a weekly report you can open in a browser and
 * read is the only way to review one before a real provider is configured, and
 * it means the whole report pipeline is exercised end to end with no
 * credentials and nothing leaving the machine.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  constructor(private readonly outboxDir: string) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const dir = resolve(process.cwd(), this.outboxDir);
    await mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = message.to.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(dir, `${stamp}--${safeTo}.html`);

    // The headers are written into the file as a comment, so an opened file
    // still says who it was for and what the subject was.
    const document =
      `<!-- To: ${message.toName ? `${message.toName} <${message.to}>` : message.to}\n` +
      `     Subject: ${message.subject}\n` +
      `     Written by the console email provider — nothing was sent. -->\n` +
      message.html;

    await writeFile(path, document, "utf8");
    console.info(`[email] wrote ${path}`);
    return { path, providerMessageId: `console:${stamp}` };
  }
}
