/**
 * src/config/env.ts
 *
 * Single-source-of-truth for all required environment variables.
 * Validated once at process start — the server will not boot if anything is missing.
 * Every other module imports from here instead of reading process.env directly.
 */

const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function loadEnv(): Record<RequiredKey, string> & {
  PORT: number;
  JWT_EXPIRES_IN: string;
  REFRESH_EXPIRES_IN: string;
  API_RATE_LIMIT: number;
  API_RATE_LIMIT_WINDOW: number;
  TRIGGER_SECRET: string | undefined;
} {
  const missing: string[] = [];

  for (const key of REQUIRED) {
    const val = process.env[key];
    if (!val || !val.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    // Print every missing variable before crashing — easier to fix in one shot.
    console.error(
      "\n[BlowSafe] ❌  FATAL — Missing required environment variables:\n" +
        missing.map((k) => `  • ${k}`).join("\n") +
        "\n\nSet these in Render → Dashboard → Environment and redeploy.\n"
    );
    process.exit(1);
  }

  return {
    MONGO_URI:             process.env.MONGO_URI!.trim(),
    JWT_SECRET:            process.env.JWT_SECRET!.trim(),
    FIREBASE_PROJECT_ID:   process.env.FIREBASE_PROJECT_ID!.trim(),
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL!.trim(),
    // Bun reads \n literally from .env files — normalise here once.
    FIREBASE_PRIVATE_KEY:  process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),

    PORT:                  parseInt(process.env.PORT ?? "10000", 10),
    JWT_EXPIRES_IN:        process.env.JWT_EXPIRES_IN  ?? "7d",
    REFRESH_EXPIRES_IN:    process.env.REFRESH_EXPIRES_IN ?? "30d",
    API_RATE_LIMIT:        parseInt(process.env.API_RATE_LIMIT ?? "10", 10),
    API_RATE_LIMIT_WINDOW: parseInt(process.env.API_RATE_LIMIT_WINDOW ?? "60000", 10),
    TRIGGER_SECRET:        process.env.TRIGGER_SECRET?.trim(),
  };
}

export const env = loadEnv();