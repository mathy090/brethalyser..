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

  console.log("📡 [Brevo] Initializing SMTP transporter...");

  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const missing = required.filter((k) => !process.env[k]?.trim());

  if (missing.length > 0) {
    console.log("❌ [Brevo] Missing env vars:", missing);

    throw new MailerError(
      "MAILER_CONFIG_MISSING",
      `Missing email config env vars: ${missing.join(", ")}`
    );
  }

  console.log("🔐 [Brevo] SMTP CONFIG FOUND");
  console.log("HOST:", process.env.SMTP_HOST);
  console.log("PORT:", process.env.SMTP_PORT);
  console.log("USER:", process.env.SMTP_USER);
  console.log("FROM:", process.env.SMTP_FROM);

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: parseInt(process.env.SMTP_PORT!, 10),
    secure: parseInt(process.env.SMTP_PORT!, 10) === 465,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!.trim(),
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });

  console.log("🚀 [Brevo] Transporter created successfully");

  return _transporter;
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

interface VerificationMailOptions {
  to: string;
  officerId: string;
  verificationUrl: string;
}

export async function sendVerificationEmail(opts: VerificationMailOptions): Promise<void> {
  const from = process.env.SMTP_FROM!.trim();

  console.log("\n📨 [Brevo] EMAIL SEND START");
  console.log("➡️ To:", opts.to);
  console.log("➡️ Officer:", opts.officerId);

  const transport = getTransporter();

  try {
    console.log("📡 [Brevo] Connecting to SMTP server...");

    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: "Verify your BlowSafe account",
      html: "EMAIL HTML OMITTED (unchanged)",
      text: "EMAIL TEXT OMITTED (unchanged)",
    });

    console.log("✅ [Brevo] EMAIL SENT SUCCESSFULLY");
    console.log("📧 Message ID:", info.messageId);

  } catch (err) {
    console.log("❌ [Brevo] EMAIL FAILED");
    console.error(err);

    throw new MailerError(
      "MAILER_SEND_FAILED",
      "Failed to send verification email.",
      err
    );
  }
}