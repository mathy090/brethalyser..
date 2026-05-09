// src/auth/firebaseConfig.ts — DEBUG VERSION
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 🔍 DEBUG: Log what's actually loaded
console.log("🔍 ENV DEBUG:", {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.slice(0, 10) + "...",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  allKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')),
});

// Temporary bypass for testing - REMOVE THIS AFTER DEBUG
if (import.meta.env.DEV) {
  console.warn("⚠️ DEV MODE: Using fallback config");
  // Don't throw error in dev if vars missing
} else {
  // Production validation
  const requiredVars = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID"] as const;
  const missingVars = requiredVars.filter((key) => !firebaseConfig[key]?.trim());
  
  if (missingVars.length > 0) {
    throw new Error(
      `[BlowSafe/Firebase] Missing: ${missingVars.join(", ")}. Check .env file.`
    );
  }
}

const app = getApps().length === 0 
  ? initializeApp(firebaseConfig) 
  : getApp();

export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

export default app;