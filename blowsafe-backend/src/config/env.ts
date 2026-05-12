/**
 * src/config/env.ts
 *
 * Single source of truth for all environment variables.
 * The server will not boot if any required variable is missing or empty.
 *
 * JWT lifetime is intentionally short (5 minutes) to limit the blast radius
 * of a stolen token. Clients must use the /refresh endpoint before expiry.
 */

const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function loadEnv(): Record<RequiredKey, string> & {
  PORT:                  number;
  JWT_EXPIRES_IN:        string;
  REFRESH_EXPIRES_IN:    string;
  API_RATE_LIMIT:        number;
  API_RATE_LIMIT_WINDOW: number;
  TRIGGER_SECRET:        string | undefined;
  CORS_ORIGIN:           string | undefined;
  REDIS_URL:             string;  // ✅ Added
  NODE_ENV:              string;
} {
  const missing: string[] = [];

  for (const key of REQUIRED) {
    const val = process.env[key];
    if (!val || !val.trim()) missing.push(key);
  }

  if (missing.length > 0) {
    console.error(
      "\n[BlowSafe] ❌  FATAL — Missing required environment variables:\n" +
        missing.map((k) => `  • ${k}`).join("\n") +
        "\n\nSet these in your Render dashboard (or .env file) and redeploy.\n"
    );
    process.exit(1);
  }

  return {
    // ── Required ──────────────────────────────────────────────────────────
    MONGO_URI:             process.env.MONGO_URI!.trim(),
    JWT_SECRET:            process.env.JWT_SECRET!.trim(),
    FIREBASE_PROJECT_ID:   process.env.FIREBASE_PROJECT_ID!.trim(),
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL!.trim(),
    FIREBASE_PRIVATE_KEY:  process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    FIREBASE_WEB_API_KEY:  process.env.FIREBASE_WEB_API_KEY!.trim(),

    // ── Optional with safe defaults ────────────────────────────────────────
    PORT: parseInt(process.env.PORT ?? "10000", 10),

    /**
     * Access token lifetime.
     * Default: 5 minutes — intentionally short.
     * Override via JWT_EXPIRES_IN env var (e.g. "10m", "1h").
     */
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "5m",

    /**
     * Refresh token lifetime.
     * Default: 30 days.
     */
    REFRESH_EXPIRES_IN: process.env.REFRESH_EXPIRES_IN ?? "30d",

    /** Max requests per IP per window (used by the in-process rate limiter). */
    API_RATE_LIMIT:        parseInt(process.env.API_RATE_LIMIT        ?? "10",    10),
    API_RATE_LIMIT_WINDOW: parseInt(process.env.API_RATE_LIMIT_WINDOW ?? "60000", 10),

    /** Shared secret for the Atlas / webhook trigger endpoint. */
    TRIGGER_SECRET: process.env.TRIGGER_SECRET?.trim(),

    /** Allowed CORS origin in production. */
    CORS_ORIGIN: process.env.CORS_ORIGIN?.trim(),

    /**
     * Redis connection URL.
     * Default: redis://localhost:6379 (for local dev)
     * Render auto-injects this when Redis addon is enabled.
     */
    REDIS_URL: process.env.REDIS_URL?.trim() ?? "redis://localhost:6379", // ✅ Added

    NODE_ENV: process.env.NODE_ENV ?? "development",
  };
}

export const env = loadEnv();