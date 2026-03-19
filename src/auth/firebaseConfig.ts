import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
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

// ✅ Validate ENV (prevents invalid-api-key crash)
if (!FIREBASE_API_KEY) {
  throw new Error("🔥 FIREBASE_API_KEY is missing from .env");
}

const firebaseConfig = {
  apiKey: FIREBASE_API_KEY?.trim(),
  authDomain: FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: FIREBASE_PROJECT_ID?.trim(),
  storageBucket: FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: FIREBASE_APP_ID?.trim(),
};

// ✅ Initialize app once
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// ✅ Ensure SINGLE auth instance (fixes onAuth crash)
let authInstance;

try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  // Already initialized → fallback safely
  authInstance = getAuth(app);
}

// ✅ Export stable auth
export const auth = authInstance;
export default app;