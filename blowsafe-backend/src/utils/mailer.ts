/**
 * src/utils/mailer.ts
 * Gmail API sender (OAuth2 refresh token)
 */

import { google } from "googleapis";
import { MailerError } from "./mailerError"; // (same class if already inside file, otherwise keep inline)

export class MailerError extends Error {
  constructor(
    public readonly code: "MAILER_CONFIG_MISSING" | "MAILER_SEND_FAILED",
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "MailerError";
  }
}

// ─── Validate env ───────────────────────────────────────────────

const required = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GMAIL_USER",
] as const;

const missing = required.filter((k) => !process.env[k]);

if (missing.length > 0) {
  throw new MailerError(
    "MAILER_CONFIG_MISSING",
    `Missing env vars: ${missing.join(", ")}`
  );
}

// ─── OAuth Client ───────────────────────────────────────────────

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
});

// ─── Send Mail ───────────────────────────────────────────────

interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function encodeMessage(message: string) {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendMail(opts: MailOptions): Promise<void> {
  console.log("\n📨 [GMAIL] Sending email...");
  console.log("➡️ To:", opts.to);

  try {
    const accessToken = await oAuth2Client.getAccessToken();

    const rawMessage = [
      `From: BlowSafe <${process.env.GMAIL_USER}>`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      `Content-Type: text/html; charset="UTF-8"`,
      "",
      opts.html || opts.text,
    ].join("\n");

    const encodedMessage = encodeMessage(rawMessage);

    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log("✅ [GMAIL] Email sent successfully");
  } catch (err) {
    console.error("❌ [GMAIL] Send failed:", err);

    throw new MailerError(
      "MAILER_SEND_FAILED",
      "Failed to send email",
      err
    );
  }
}