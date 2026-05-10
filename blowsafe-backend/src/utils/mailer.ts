/**
 * src/utils/mailer.ts
 *
 * Lightweight SMTP mailer using nodemailer.
 * Reads credentials from environment — never hardcoded.
 * All send failures are caught and re-thrown as MailerError
 * so callers can map them to consistent API responses.
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import nodemailer, { type Transporter } from "nodemailer";

// ─── Error type ───────────────────────────────────────────────────────────────

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

// ─── Singleton transporter ────────────────────────────────────────────────────

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const missing = required.filter((k) => !process.env[k]?.trim());

  if (missing.length > 0) {
    throw new MailerError(
      "MAILER_CONFIG_MISSING",
      `Missing email config env vars: ${missing.join(", ")}`
    );
  }

  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST!.trim(),
    port:   parseInt(process.env.SMTP_PORT!, 10),
    secure: parseInt(process.env.SMTP_PORT!, 10) === 465,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!.trim(),
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });

  return _transporter;
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

interface VerificationMailOptions {
  to:              string;
  officerId:       string;
  verificationUrl: string;
}

export async function sendVerificationEmail(opts: VerificationMailOptions): Promise<void> {
  const from = process.env.SMTP_FROM!.trim();

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Verify your BlowSafe account</title>
    </head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="520" cellpadding="0" cellspacing="0"
                   style="background:#151515;border-radius:12px;border:1px solid #222;overflow:hidden;max-width:520px;width:100%;">

              <!-- Header -->
              <tr>
                <td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
                  <h1 style="margin:0;font-size:24px;font-weight:700;color:#1DB954;letter-spacing:-0.5px;">
                    Blow Safe
                  </h1>
                  <p style="margin:4px 0 0;font-size:12px;color:#555;letter-spacing:1px;text-transform:uppercase;">
                    Zimbabwe Republic Police · Traffic Enforcement Platform
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px 40px;">
                  <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#fff;">
                    Verify your email address
                  </h2>
                  <p style="margin:0 0 8px;color:#888;font-size:14px;line-height:1.6;">
                    Officer ID: <strong style="color:#ccc;">${opts.officerId}</strong>
                  </p>
                  <p style="margin:0 0 28px;color:#888;font-size:14px;line-height:1.6;">
                    Your account has been created and is pending administrator approval.
                    Please verify your email address first — your account will be reviewed
                    by an administrator within 24–48 hours.
                  </p>
                  <a href="${opts.verificationUrl}"
                     style="display:inline-block;padding:14px 32px;background:#1DB954;
                            color:#000;font-size:15px;font-weight:700;border-radius:30px;
                            text-decoration:none;letter-spacing:0.3px;">
                    Verify Email Address
                  </a>
                  <p style="margin:24px 0 0;color:#555;font-size:12px;line-height:1.6;">
                    This link expires in 24 hours. If you did not create a BlowSafe account,
                    you can safely ignore this email.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 40px;border-top:1px solid #222;">
                  <p style="margin:0;color:#444;font-size:11px;line-height:1.6;">
                    BlowSafe · Zimbabwe Republic Police · Traffic Enforcement Division<br/>
                    Unauthorised access is a criminal offence under the Computer Crime and
                    Cyber Crime Act [Chapter 9:23].
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const text = [
    "BlowSafe — Email Verification",
    "",
    `Officer ID: ${opts.officerId}`,
    "",
    "Your account is pending administrator approval.",
    "Please verify your email by visiting the link below:",
    "",
    opts.verificationUrl,
    "",
    "This link expires in 24 hours.",
  ].join("\n");

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from,
      to:      opts.to,
      subject: "Verify your BlowSafe account",
      html,
      text,
    });
    console.log(`[BlowSafe/Mailer] ✅  Verification email sent to ${opts.to} — messageId: ${info.messageId}`);
  } catch (err) {
    console.error("[BlowSafe/Mailer] ❌  Send failed:", err);
    throw new MailerError("MAILER_SEND_FAILED", "Failed to send verification email.", err);
  }
}