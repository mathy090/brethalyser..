/**
 * src/auth/firebaseConfig.ts
 * Firebase initialization for Web — No type import issues
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeAuth, 
  browserLocalPersistence,
  getAuth
} from "firebase/auth";

// ─── 1. Environment Variables ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// ─── 2. Validate required env vars ──────────────────────────────────────────
const requiredVars = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID"] as const;
const missingVars = requiredVars.filter(
  (key) => !firebaseConfig[key]?.trim()
);

if (missingVars.length > 0) {
  throw new Error(
    `[BlowSafe/Firebase] Missing: ${missingVars.join(", ")}. Check .env file.`
  );
}

// ─── 3. Firebase App Singleton ──────────────────────────────────────────────
const app = getApps().length === 0 
  ? initializeApp(firebaseConfig) 
  : getApp();

// ─── 4. Firebase Auth Singleton — ✅ NO TYPE IMPORT NEEDED ─────────────────
// Use ReturnType to infer the auth type instead of importing 'Auth'
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

// Optional: Export the inferred type for use elsewhere (if needed)
export type FirebaseAuth = ReturnType<typeof getAuth>;

export default app;