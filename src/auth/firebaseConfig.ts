/**
 * src/auth/firebaseConfig.ts
 *
 * Bulletproof single-instance Firebase initialisation for React Native / Android.
 *
 * Problem solved
 * ──────────────
 * React Native's Fast Refresh and Metro's module re-evaluation can cause this
 * file to be executed multiple times inside the same JS runtime.  Calling
 * initializeApp() or initializeAuth() a second time throws:
 *
 *   "Firebase: Firebase App named '[DEFAULT]' already exists (app/duplicate-app)"
 *   "Firebase: Auth instance is already initialised (auth/already-initialized)"
 *
 * Solution
 * ────────
 * 1. Use getApps().length to guard initializeApp() — Firebase's own recommended
 *    pattern.
 * 2. Use a module-level nullable reference (_authInstance) to guard
 *    initializeAuth().  On subsequent evaluations of this module the reference
 *    is already set, so we return it directly without calling initializeAuth()
 *    again.
 * 3. Never use try/catch to swallow these errors — masking them loses the
 *    AsyncStorage persistence layer and causes silent sign-out on every cold
 *    start.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
  type Auth,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
} from "@env";

// ─── 1. Env validation ──────────────────────────────────────────────────────────
// Fail at boot with a descriptive message rather than a cryptic Firebase error.

const ENV = {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
} as const;

const missingVars = (Object.entries(ENV) as [string, string | undefined][])
  .filter(([, value]) => !value?.trim())
  .map(([key]) => key);

if (missingVars.length > 0) {
  throw new Error(
    `[BlowSafe/Firebase] Missing environment variable(s): ${missingVars.join(", ")}.\n` +
    "Check your .env file and restart the Metro bundler — env changes are not hot-reloaded."
  );
}

// ─── 2. Firebase App (singleton) ────────────────────────────────────────────────
// getApps() returns every app registered in the current JS runtime.
// Empty on first load → initialise.  Non-empty on re-evaluation → reuse.

const app: FirebaseApp =
  getApps().length === 0 ? initializeApp({
    apiKey:            ENV.FIREBASE_API_KEY!.trim(),
    authDomain:        ENV.FIREBASE_AUTH_DOMAIN!.trim(),
    projectId:         ENV.FIREBASE_PROJECT_ID!.trim(),
    storageBucket:     ENV.FIREBASE_STORAGE_BUCKET!.trim(),
    messagingSenderId: ENV.FIREBASE_MESSAGING_SENDER_ID!.trim(),
    appId:             ENV.FIREBASE_APP_ID!.trim(),
  }) : getApp();

// ─── 3. Firebase Auth (singleton) ───────────────────────────────────────────────
// initializeAuth() must be called exactly ONCE per app instance.
//
// We use a module-scoped nullable reference rather than try/catch because:
//
//   - try/catch masks the crash but the getAuth() fallback does NOT carry the
//     AsyncStorage persistence config, silently breaking session persistence and
//     logging the user out on every cold start.
//
//   - Metro preserves module-level variable state across Fast Refresh cycles, so
//     _authInstance remains set and initializeAuth() is never called twice.

let _authInstance: Auth | null = null;

function resolveAuth(): Auth {
  if (_authInstance !== null) return _authInstance;

  _authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });

  return _authInstance;
}

export const auth: Auth = resolveAuth();
export default app;