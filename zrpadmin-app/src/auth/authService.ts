/**
 * src/auth/authService.ts
 *
 * Authentication service for the ZRP Admin web application.
 * All registration logic runs server-side — no Firebase client SDK involved
 * in the register flow. Login still uses Firebase client SDK to obtain an
 * ID token which the backend then validates.
 */

import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebaseConfig";
import axios, { type AxiosError } from "axios";

// ─── API client ───────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

// ─── Result types ─────────────────────────────────────────────────────────────

export type RegisterResult =
  | { success: true }
  | { success: false; code: string; message: string };

export type LoginResult =
  | { success: true; uid: string; role: string; status: string; officerId: string }
  | { success: false; code: string; message: string };

// ─── Error normaliser ─────────────────────────────────────────────────────────

function normaliseAxiosError(err: unknown): { code: string; message: string } {
  const ax = err as AxiosError<{ code?: string; message?: string; error?: string }>;

  if (ax.response) {
    const data   = ax.response.data ?? {};
    const code   = data.code    ?? "SERVER_ERROR";
    const message = data.message ?? data.error ?? "An unexpected server error occurred.";
    return { code, message };
  }

  if (ax.request) {
    return {
      code:    "NETWORK_ERROR",
      message: "Network error — check your internet connection.",
    };
  }

  return {
    code:    "CLIENT_ERROR",
    message: (err as Error).message ?? "An unexpected error occurred.",
  };
}

// ─── Register — fully server-side ─────────────────────────────────────────────

/**
 * Registers a new officer by sending credentials to the backend.
 * The backend handles:
 *  - Duplicate officerId check (MongoDB)
 *  - Duplicate email check (Firebase Admin)
 *  - Firebase user creation
 *  - Email verification dispatch
 *  - MongoDB officer record creation (status: pending)
 */
export async function registerOfficer(
  officerId: string,
  email:     string,
  password:  string
): Promise<RegisterResult> {
  try {
    await api.post("/api/auth/register", {
      officerId: officerId.trim().toUpperCase(),
      email:     email.trim().toLowerCase(),
      password,
    });

    return { success: true };
  } catch (err) {
    const { code, message } = normaliseAxiosError(err);
    return { success: false, code, message };
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Signs the officer in via Firebase client SDK (to obtain an ID token),
 * then exchanges the ID token with the backend for a signed JWT.
 */
export async function loginOfficer(
  officerId: string,
  email:     string,
  password:  string
): Promise<LoginResult> {
  try {
    // Step 1: Firebase client SDK verifies credentials
    const { user } = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);

    // Step 2: Exchange Firebase ID token for a BlowSafe JWT
    const idToken     = await user.getIdToken();
    const { data }    = await api.post(
      "/api/auth/login",
      { officerId: officerId.trim().toUpperCase() },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!data?.token) throw new Error("Backend did not return a token.");

    // Step 3: Persist session
    localStorage.setItem("jwt_token", data.token);
    localStorage.setItem("officer_id", data.officerId);
    localStorage.setItem("user_uid",   user.uid);

    return {
      success:   true,
      uid:       user.uid,
      role:      data.role,
      status:    data.status,
      officerId: data.officerId,
    };
  } catch (err: any) {
    await signOut(auth).catch(() => null);

    // Firebase client errors
    const firebaseMap: Record<string, string> = {
      "auth/invalid-credential": "Invalid email or password.",
      "auth/wrong-password":     "Invalid email or password.",
      "auth/user-not-found":     "No account found with this email.",
      "auth/too-many-requests":  "Too many attempts — please wait before trying again.",
      "auth/user-disabled":      "This account has been disabled.",
    };

    if (err?.code && firebaseMap[err.code]) {
      return {
        success: false,
        code:    err.code.replace("auth/", "").toUpperCase().replace(/-/g, "_"),
        message: firebaseMap[err.code],
      };
    }

    // Axios / backend errors
    if (err?.response || err?.request) {
      const { code, message } = normaliseAxiosError(err);
      return { success: false, code, message };
    }

    return {
      success: false,
      code:    "UNKNOWN",
      message: err?.message ?? "Login failed — please try again.",
    };
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutOfficer(): Promise<void> {
  await signOut(auth).catch(() => null);
  localStorage.removeItem("jwt_token");
  localStorage.removeItem("officer_id");
  localStorage.removeItem("user_uid");
}