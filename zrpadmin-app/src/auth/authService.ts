/**
 * src/auth/authService.ts
 *
 * Authentication service for the ZRP Admin web application.
 *
 * Login flow:
 *  1. Firebase client SDK verifies email + password → ID token
 *  2. Exchange ID token + officerId with backend → BlowSafe JWT
 *  3. Persist token + officer metadata to localStorage
 *
 * Session management:
 *  - JWT lifetime is 5 minutes (configured on the backend).
 *  - All protected API calls should intercept 401/403 responses and
 *    redirect to /login with state { reason: "session_expired" }.
 *
 * Error surface:
 *  - Every failure returns { success: false, code, message }.
 *  - Error codes are normalised so the Login page can map them to
 *    user-facing copy without any string parsing.
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

// ─── Storage helpers ──────────────────────────────────────────────────────────

const STORAGE = {
  TOKEN:     "blowsafe_jwt",
  OFFICER:   "blowsafe_officer_id",
  UID:       "blowsafe_uid",
  ISSUED_AT: "blowsafe_token_issued_at",
} as const;

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE.TOKEN);
}

export function getStoredOfficerId(): string | null {
  return localStorage.getItem(STORAGE.OFFICER);
}

/** Returns true if the locally-stored token is past its 5-minute lifetime. */
export function isTokenExpiredLocally(): boolean {
  const issuedAt = localStorage.getItem(STORAGE.ISSUED_AT);
  if (!issuedAt) return true;
  const elapsed = Date.now() - parseInt(issuedAt, 10);
  // 5 minutes = 300 000 ms — check at 4:50 to give a buffer
  return elapsed > 290_000;
}

function persistSession(token: string, uid: string, officerId: string): void {
  localStorage.setItem(STORAGE.TOKEN,     token);
  localStorage.setItem(STORAGE.UID,       uid);
  localStorage.setItem(STORAGE.OFFICER,   officerId);
  localStorage.setItem(STORAGE.ISSUED_AT, String(Date.now()));
}

function clearSession(): void {
  Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
}

// ─── Result types ─────────────────────────────────────────────────────────────

export type LoginResult =
  | {
      success:   true;
      uid:       string;
      role:      string;
      status:    string;
      officerId: string;
    }
  | {
      success: false;
      code:    string;
      message: string;
    };

export type RegisterResult =
  | { success: true }
  | { success: false; code: string; message: string };

// ─── Error normaliser ─────────────────────────────────────────────────────────

/**
 * Converts any thrown error (Axios, Firebase, unknown) into a stable
 * { code, message } pair. The code is SCREAMING_SNAKE_CASE so the UI
 * can map it directly without fragile string matching.
 */
function normaliseError(err: unknown): { code: string; message: string } {
  // ── Firebase client SDK errors ───────────────────────────────────────────
  const firebaseErr = err as { code?: string; message?: string };
  if (typeof firebaseErr.code === "string" && firebaseErr.code.startsWith("auth/")) {
    const raw = firebaseErr.code; // e.g. "auth/wrong-password"
    const firebaseMap: Record<string, string> = {
      "auth/invalid-credential":       "INVALID_CREDENTIAL",
      "auth/wrong-password":           "INVALID_CREDENTIAL",
      "auth/user-not-found":           "USER_NOT_FOUND",
      "auth/too-many-requests":        "TOO_MANY_REQUESTS",
      "auth/user-disabled":            "USER_DISABLED",
      "auth/invalid-email":            "INVALID_EMAIL",
      "auth/email-already-in-use":     "EMAIL_TAKEN",
      "auth/weak-password":            "WEAK_PASSWORD",
      "auth/network-request-failed":   "NETWORK_ERROR",
    };
    const code    = firebaseMap[raw] ?? raw.replace("auth/", "").toUpperCase().replace(/-/g, "_");
    const message = firebaseErr.message ?? "Firebase authentication failed.";
    return { code, message };
  }

  // ── Axios / HTTP errors ──────────────────────────────────────────────────
  const axiosErr = err as AxiosError<{
    code?:    string;
    message?: string;
    error?:   string;
    success?: boolean;
  }>;

  if (axiosErr.isAxiosError || axiosErr.response || axiosErr.request) {
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const data   = axiosErr.response.data ?? {};

      // Prefer the backend's own `code` field
      let code = (data.code ?? "").toUpperCase();

      // Map HTTP status to a sensible default if the backend didn't supply one
      if (!code) {
        if (status === 401) code = "INVALID_TOKEN";
        else if (status === 403) code = "FORBIDDEN";
        else if (status === 429) code = "TOO_MANY_REQUESTS";
        else if (status >= 500) code = "SERVER_ERROR";
        else code = "SERVER_ERROR";
      }

      const message =
        data.message ??
        data.error ??
        `Server returned ${status}. Please try again.`;

      return { code, message };
    }

    if (axiosErr.request) {
      return {
        code:    "NETWORK_ERROR",
        message: "Unable to reach the server. Please check your internet connection.",
      };
    }
  }

  // ── Unknown ──────────────────────────────────────────────────────────────
  const msg = (err as Error)?.message ?? "An unexpected error occurred.";
  return { code: "UNKNOWN", message: msg };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginOfficer(
  officerId: string,
  email:     string,
  password:  string
): Promise<LoginResult> {
  let firebaseUid: string | null = null;

  try {
    // Step 1 — Firebase credential verification
    const credential = await signInWithEmailAndPassword(auth, email, password);
    firebaseUid      = credential.user.uid;
    const idToken    = await credential.user.getIdToken();

    // Step 2 — Backend JWT exchange
    const { data } = await api.post(
      "/api/auth/login",
      { officerId },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!data?.token) {
      throw new Error("Backend did not return an authentication token.");
    }

    // Step 3 — Persist session
    persistSession(data.token, firebaseUid, data.officerId ?? officerId);

    return {
      success:   true,
      uid:       firebaseUid,
      role:      data.role      ?? "officer",
      status:    data.status    ?? "approved",
      officerId: data.officerId ?? officerId,
    };
  } catch (err) {
    // Always sign out of Firebase so stale credentials don't linger
    await signOut(auth).catch(() => null);
    clearSession();

    const { code, message } = normaliseError(err);

    // Translate backend account-status codes
    // The backend returns { message: "Account banned" } or { message: "Account pending" }
    // We surface these via the code from our error catalogue
    if (
      code === "FORBIDDEN" ||
      message.toLowerCase().includes("pending")
    ) {
      return { success: false, code: "ACCOUNT_PENDING", message };
    }
    if (message.toLowerCase().includes("banned") || message.toLowerCase().includes("rejected")) {
      return { success: false, code: "ACCOUNT_REJECTED", message };
    }
    if (message.toLowerCase().includes("email") && message.toLowerCase().includes("verified")) {
      return { success: false, code: "EMAIL_NOT_VERIFIED", message };
    }

    return { success: false, code, message };
  }
}

// ─── Register (server-side flow — two-step) ───────────────────────────────────

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
    const { code, message } = normaliseError(err);
    return { success: false, code, message };
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutOfficer(): Promise<void> {
  await signOut(auth).catch(() => null);
  clearSession();
}

// ─── Session guard helper ─────────────────────────────────────────────────────

/**
 * Attach this as an Axios response interceptor on any protected API client.
 * When the server returns 401 (JWT expired / invalid), it clears the session
 * and redirects the user back to the sign-in page with a reason flag.
 *
 * Usage:
 *   protectedApi.interceptors.response.use(
 *     (res) => res,
 *     sessionExpiryInterceptor
 *   );
 */
export function sessionExpiryInterceptor(error: AxiosError): never {
  if (error.response?.status === 401) {
    clearSession();
    window.location.href = "/login";
    // Attach state via sessionStorage so the Login page can read it
    sessionStorage.setItem("redirect_reason", "session_expired");
  }
  return Promise.reject(error) as never;
}