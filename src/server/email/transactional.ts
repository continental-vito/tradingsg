import "server-only";
import { env } from "@/lib/env";
import { db } from "@/server/db";
import { createEmailProvider } from "./index";

/**
 * One-off emails that are not the weekly report.
 *
 * These go through the same provider seam, and every attempt is logged the same
 * way — written before the send, with a unique dedupe key — so "did the reset
 * link actually go out?" is a question the admin can answer.
 */

const INK = "#151b26";
const MUTED = "#677186";
const BORDER = "#d7dbe3";
const ACCENT = "#3b5bdb";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function shell(title: string, body: string): string {
  return `<div style="margin:0;padding:0;background:#f6f7f9;font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;font-family:${FONT}">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid ${BORDER};font-family:${FONT}">
        <tr><td style="padding:28px;font-family:${FONT}">
          <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT}">${env.COMPANY_NAME} Stock Challenge</p>
          <h1 style="margin:6px 0 16px;font-size:20px;font-weight:600;color:${INK}">${title}</h1>
          ${body}
          <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.5;color:${MUTED}">
            Every euro in this competition is virtual. Nothing here is investment advice.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0">
    <tr><td style="background:${ACCENT};border-radius:8px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none">${label}</a>
    </td></tr>
  </table>`;
}

async function deliver(args: {
  kind: "PASSWORD_RESET" | "WELCOME";
  dedupeKey: string;
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const provider = createEmailProvider();

  // Written first, deliberately: a crash between the log and the send loses one
  // email, and the other order sends it twice.
  let log;
  try {
    log = await db.emailLog.create({
      data: {
        dedupeKey: args.dedupeKey,
        provider: provider.name,
        kind: args.kind,
        toEmail: args.to,
        toName: args.toName,
        fromEmail: env.EMAIL_FROM,
        subject: args.subject,
        bodyHash: "",
        status: "SENDING",
      },
    });
  } catch {
    // The unique key rejected it — this exact message already went out.
    return;
  }

  try {
    const result = await provider.send({
      to: args.to,
      toName: args.toName,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    await db.emailLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: result.providerMessageId ?? null,
        htmlPath: result.path ?? null,
        attempts: 1,
      },
    });
  } catch (error: unknown) {
    await db.emailLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
        attempts: 1,
      },
    });
    // Deliberately swallowed. The caller is the password-reset action, which
    // must answer identically whether or not the address exists — surfacing a
    // send failure there would turn the reset form into an account oracle.
    console.error(`[email] ${args.kind} to ${args.to} failed:`, error);
  }
}

export async function sendPasswordResetEmail(args: {
  to: string;
  firstName: string;
  token: string;
  tokenId: string;
}): Promise<void> {
  const link = `${env.APP_URL}/reset-password/${args.token}`;
  await deliver({
    kind: "PASSWORD_RESET",
    // Keyed on the token row, so one request sends one email even if the action
    // is retried, while a genuinely new request gets a new key.
    dedupeKey: `password-reset:${args.tokenId}`,
    to: args.to,
    toName: args.firstName,
    subject: `Reset your ${env.COMPANY_NAME} Stock Challenge password`,
    html: shell(
      "Reset your password",
      `<p style="margin:0;font-size:15px;line-height:1.55;color:${INK}">
         Hi ${args.firstName}, someone asked to reset the password for this address.
         The link below works once and expires in an hour.
       </p>
       ${button(link, "Choose a new password")}
       <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${MUTED}">
         If that was not you, nothing has changed and you can ignore this. Setting a
         new password signs out every other device.
       </p>`,
    ),
    text: [
      `Hi ${args.firstName},`,
      "",
      "Someone asked to reset the password for this address. The link below works once and expires in an hour.",
      "",
      link,
      "",
      "If that was not you, nothing has changed and you can ignore this.",
    ].join("\n"),
  });
}

export async function sendWelcomeEmail(args: {
  to: string;
  firstName: string;
  userId: string;
  startingCapital: string;
}): Promise<void> {
  await deliver({
    kind: "WELCOME",
    dedupeKey: `welcome:${args.userId}`,
    to: args.to,
    toName: args.firstName,
    subject: `Welcome to the ${env.COMPANY_NAME} Stock Challenge`,
    html: shell(
      "You're in",
      `<p style="margin:0;font-size:15px;line-height:1.55;color:${INK}">
         Hi ${args.firstName}, you have <strong>${args.startingCapital}</strong> of virtual
         capital waiting. Until you allocate it you are not on the leaderboard — an
         uninvested portfolio is exactly flat, so it is listed separately rather than
         ranked.
       </p>
       ${button(`${env.APP_URL}/portfolio/allocate`, "Build my portfolio")}`,
    ),
    text: [
      `Hi ${args.firstName},`,
      "",
      `You have ${args.startingCapital} of virtual capital waiting.`,
      `Build your portfolio: ${env.APP_URL}/portfolio/allocate`,
    ].join("\n"),
  });
}
