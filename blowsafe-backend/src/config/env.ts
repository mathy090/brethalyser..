/**
 * src/config/env.ts
 * Single source of truth for all environment variables.
 * Server will not boot if any required var is missing.
 */

const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY", // ← needed to send verification emails via REST API
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function loadEnv(): Record<RequiredKey, string> & {
  PORT: number;
  JWT_EXPIRES_IN: string;
  REFRESH_EXPIRES_IN: string;
  API_RATE_LIMIT: number;
  API_RATE_LIMIT_WINDOW: number;
  TRIGGER_SECRET: string | undefined;
  CORS_ORIGIN: string | undefined;
  NODE_ENV: string;
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
        "\n\nSet these in your environment and redeploy.\n"
    );
    process.exit(1);
  }

  return {
    MONGO_URI:             process.env.MONGO_URI!.trim(),
    JWT_SECRET:            process.env.JWT_SECRET!.trim(),
    FIREBASE_PROJECT_ID:   process.env.FIREBASE_PROJECT_ID!.trim(),
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL!.trim(),
    FIREBASE_PRIVATE_KEY:  process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    FIREBASE_WEB_API_KEY:  process.env.FIREBASE_WEB_API_KEY!.trim(),

    PORT:                  parseInt(process.env.PORT ?? "10000", 10),
    JWT_EXPIRES_IN:        process.env.JWT_EXPIRES_IN  ?? "7d",
    REFRESH_EXPIRES_IN:    process.env.REFRESH_EXPIRES_IN ?? "30d",
    API_RATE_LIMIT:        parseInt(process.env.API_RATE_LIMIT ?? "10", 10),
    API_RATE_LIMIT_WINDOW: parseInt(process.env.API_RATE_LIMIT_WINDOW ?? "60000", 10),
    TRIGGER_SECRET:        process.env.TRIGGER_SECRET?.trim(),
    CORS_ORIGIN:           process.env.CORS_ORIGIN?.trim(),
    NODE_ENV:              process.env.NODE_ENV ?? "development",
  };
}

export const env = loadEnv();