/**
 * src/utils/mailer.ts
 *
 * Email sender using Nodemailer + Gmail App Password.
 *
 * WHY NOT OAuth2 REFRESH TOKEN?
 *   The previous implementation used OAuth2 with a refresh token, which
 *   throws `unauthorized_client` (401) when the token expires or the
 *   OAuth client lacks the `https://mail.google.com/` scope.
 *
 * SETUP (one-time):
 *   1. Enable 2FA on the Gmail account.
 *   2. Go to Google Account → Security → App Passwords.
 *   3. Generate a new app password (select "Mail" + "Other").
 *   4. Set env vars:
 *        GMAIL_USER=youraddress@gmail.com
 *        GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   (16-char app password)
 */

import nodemailer from "nodemailer";

// ─── Custom error ────────────────────────────────────────────────────────────

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

// ─── Validate required env vars ──────────────────────────────────────────────

const GMAIL_USER         = process.env.GMAIL_USER?.trim();
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.trim();

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  const missing: string[] = [];
  if (!GMAIL_USER)         missing.push("GMAIL_USER");
  if (!GMAIL_APP_PASSWORD) missing.push("GMAIL_APP_PASSWORD");

  console.error(
    `[Mailer] ❌ FATAL — Missing env vars: ${missing.join(", ")}.\n` +
    `         Set GMAIL_USER and GMAIL_APP_PASSWORD (Gmail App Password, NOT your account password).`
  );

  throw new MailerError(
    "MAILER_CONFIG_MISSING",
    `Missing env vars: ${missing.join(", ")}`
  );
}

// ─── Nodemailer transport (lazy singleton) ───────────────────────────────────

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  console.log("[Mailer] 🔧 Creating Nodemailer transporter (Gmail / App Password)…");

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  console.log(`[Mailer] ✅ Transporter ready — from: ${GMAIL_USER}`);
  return _transporter;
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface MailOptions {
  to:       string;
  subject:  string;
  text:     string;
  html?:    string;
}

/**
 * Send an email via Gmail.
 * Throws `MailerError` on failure so callers can handle it gracefully.
 */
export async function sendMail(opts: MailOptions): Promise<void> {
  const transporter = getTransporter();

  console.log("\n[Mailer] 📨 Sending email…");
  console.log(`[Mailer]    To      : ${opts.to}`);
  console.log(`[Mailer]    Subject : ${opts.subject}`);

  try {
    const info = await transporter.sendMail({
      from:    `"BlowSafe ZRP" <${GMAIL_USER}>`,
      to:      opts.to,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html ?? opts.text,
    });

    console.log(`[Mailer] ✅ Email sent — messageId: ${info.messageId}`);
  } catch (err: unknown) {
    console.error("[Mailer] ❌ Send failed:", err);

    throw new MailerError(
      "MAILER_SEND_FAILED",
      "Failed to send email via Gmail",
      err
    );
  }
}