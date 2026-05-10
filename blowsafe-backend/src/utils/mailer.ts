/**
 * src/utils/mailer.ts
 * Resend-based email sender (API KEY only)
 */

import { Resend } from "resend";

// ─── Error type ───────────────────────────────────────────────

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

// ─── Init Resend ───────────────────────────────────────────────

if (!process.env.RESEND_API_KEY) {
  throw new MailerError(
    "MAILER_CONFIG_MISSING",
    "Missing RESEND_API_KEY"
  );
}

if (!process.env.EMAIL_FROM) {
  throw new MailerError(
    "MAILER_CONFIG_MISSING",
    "Missing EMAIL_FROM"
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);

console.log("📡 [Resend] Initialized");

// ─── Send Function ───────────────────────────────────────────────

interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const from = process.env.EMAIL_FROM!;

  console.log("\n📨 [Resend] Sending email...");
  console.log("➡️ To:", opts.to);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    if (error) {
      console.error("❌ [Resend] Error:", error);

      throw new MailerError(
        "MAILER_SEND_FAILED",
        "Failed to send email",
        error
      );
    }

    console.log("✅ [Resend] Email sent successfully");
    console.log("📧 ID:", data?.id);

  } catch (err) {
    console.error("❌ [Resend] Exception:", err);

    throw new MailerError(
      "MAILER_SEND_FAILED",
      "Failed to send email",
      err
    );
  }
}