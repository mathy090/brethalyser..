/**
 * src/pages/Signup.tsx
 *
 * Registration flow (frontend side):
 *
 *  Phase 1 — Backend check
 *    POST /api/auth/register/check  →  validates Officer ID + email in MongoDB.
 *    Returns a checkToken on success.
 *
 *  Phase 2 — Firebase account creation (Web SDK, no Admin SDK)
 *    createUserWithEmailAndPassword  →  creates the Firebase account.
 *    sendEmailVerification           →  sends the link from Firebase directly.
 *
 *  Phase 3 — Backend record creation
 *    POST /api/auth/register/complete  →  saves the officer to MongoDB.
 *    Presents the checkToken + the new Firebase UID.
 */

import React, { useState, useRef, useCallback } from "react";
import { useNavigate, Link }                     from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  deleteUser,
} from "firebase/auth";
import axios, { type AxiosError }                from "axios";

import { auth } from "../auth/firebaseConfig";
import "../designs/Signup.css";

// ─── API client ───────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL:  import.meta.env.VITE_BACKEND_URL,
  timeout:  15_000,
  headers:  { "Content-Type": "application/json" },
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldErrors {
  officerId?: string;
  email?:     string;
  password?:  string;
  confirm?:   string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE   = /^(?=.*[A-Z])(?=.*[!@#$%^&*]).{8,}$/;

function validateFields(
  officerId: string,
  email:     string,
  password:  string,
  confirm:   string
): FieldErrors {
  const errs: FieldErrors = {};

  if (!officerId.trim())
    errs.officerId = "Officer ID is required.";
  else if (!OFFICER_ID_RE.test(officerId.trim()))
    errs.officerId = "Invalid format — expected A123456B or 9 digits.";

  if (!email.trim())
    errs.email = "Email is required.";
  else if (!EMAIL_RE.test(email.trim()))
    errs.email = "Enter a valid email address.";

  if (!password)
    errs.password = "Password is required.";
  else if (!PASSWORD_RE.test(password))
    errs.password = "Min 8 characters, one uppercase, one special character.";

  if (!confirm)
    errs.confirm = "Please confirm your password.";
  else if (password !== confirm)
    errs.confirm = "Passwords do not match.";

  return errs;
}

// ─── Error normaliser ─────────────────────────────────────────────────────────

function normaliseAxiosError(err: unknown): { code: string; message: string } {
  const ax = err as AxiosError<{ code?: string; message?: string; error?: string }>;
  if (ax.response) {
    const data    = ax.response.data ?? {};
    const code    = data.code    ?? "SERVER_ERROR";
    const message = data.message ?? data.error ?? "An unexpected server error occurred.";
    return { code, message };
  }
  if (ax.request) return { code: "NETWORK_ERROR", message: "Network error — check your connection." };
  return { code: "CLIENT_ERROR", message: (err as Error).message ?? "An unexpected error occurred." };
}

// Map backend / Firebase error codes → user-friendly messages
const ERROR_MAP: Record<string, { field?: keyof FieldErrors; message: string }> = {
  OFFICER_ID_TAKEN:             { field: "officerId", message: "This Officer ID is already registered." },
  OFFICER_ID_IN_USE:            { field: "officerId", message: "This Officer ID is already registered." },
  EMAIL_TAKEN:                  { field: "email",     message: "An account with this email already exists. Sign in instead." },
  EMAIL_EXISTS:                 { field: "email",     message: "An account with this email already exists. Sign in instead." },
  "auth/email-already-in-use":  { field: "email",     message: "This email is already registered with Firebase. Sign in instead." },
  "auth/invalid-email":         { field: "email",     message: "The email address is not valid." },
  "auth/weak-password":         { field: "password",  message: "Password is too weak. Use at least 6 characters." },
  RATE_LIMITED:                 {                     message: "Too many attempts. Please wait before trying again." },
  INTERNAL_ERROR:               {                     message: "A server error occurred. Please try again in a few minutes." },
  NETWORK_ERROR:                {                     message: "Network error — check your internet connection." },
};

function resolveError(code: string, fallback: string) {
  return ERROR_MAP[code] ?? { message: fallback };
}

// ─── Banner component ─────────────────────────────────────────────────────────

interface BannerProps {
  type:    "error" | "warning" | "success";
  message: string;
  onClose: () => void;
}

function Banner({ type, message, onClose }: BannerProps) {
  const bg = { error: "#FF4C4C", warning: "#FFA500", success: "#1DB954" }[type];
  return (
    <div
      role="alert"
      style={{
        position: "relative", width: "100%", maxWidth: 480,
        padding: "14px 44px 14px 18px", borderRadius: 10, marginBottom: 20,
        background: bg, color: type === "warning" ? "#000" : "#fff",
        fontSize: 14, fontWeight: 600, lineHeight: 1.5, whiteSpace: "pre-line",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)", animation: "slideDown 280ms ease-out",
      }}
    >
      {message}
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute", top: 10, right: 12, background: "none",
          border: "none", color: "inherit", fontSize: 18, cursor: "pointer",
          opacity: 0.75, lineHeight: 1, padding: 4,
        }}
      >✕</button>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────

interface SuccessCardProps {
  email:     string;
  officerId: string;
  onGoLogin: () => void;
}

function SuccessCard({ email, officerId, onGoLogin }: SuccessCardProps) {
  return (
    <div style={{
      width: "100%", maxWidth: 480, background: "#151515", borderRadius: 14,
      border: "1px solid #1DB95440", padding: "36px 32px", textAlign: "center",
      animation: "slideDown 350ms ease-out",
    }}>
      <div style={{ fontSize: 52, marginBottom: 20 }}>✉️</div>
      <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: "#fff" }}>
        Check Your Email
      </h2>
      <p style={{ margin: "0 0 6px", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
        A verification link has been sent to
      </p>
      <p style={{ margin: "0 0 24px", color: "#1DB954", fontWeight: 700, fontSize: 15 }}>
        {email}
      </p>
      <div style={{
        background: "#1a1a1a", borderRadius: 10, border: "1px solid #222",
        padding: "14px 18px", marginBottom: 24, textAlign: "left",
      }}>
        {([
          ["Officer ID",  officerId],
          ["Status",      "Pending administrator approval"],
          ["Next steps",  "Verify your email, then wait 24–48 h for approval"],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
            <span style={{ color: "#555", fontSize: 12, minWidth: 80, paddingTop: 1 }}>{label}</span>
            <span style={{ color: "#ccc", fontSize: 13, lineHeight: 1.5 }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{
        background: "#1a1a1a", borderLeft: "3px solid #FFA500", borderRadius: 8,
        padding: "12px 16px", marginBottom: 28, textAlign: "left",
      }}>
        <p style={{ margin: 0, color: "#FFA500", fontSize: 12, lineHeight: 1.6 }}>
          ⚠️ Don't see the email? Check your spam or junk folder.
        </p>
      </div>
      <button
        onClick={onGoLogin}
        style={{
          width: "100%", padding: "14px", background: "#1DB954", color: "#000",
          border: "none", borderRadius: 30, fontSize: 16, fontWeight: 700, cursor: "pointer",
        }}
      >
        Go to Sign In
      </button>
    </div>
  );
}

// ─── Field component ──────────────────────────────────────────────────────────

interface FieldProps {
  label:        string;
  id:           string;
  type?:        string;
  value:        string;
  onChange:     (v: string) => void;
  error?:       string;
  placeholder:  string;
  disabled?:    boolean;
  autoComplete?: string;
  hint?:        string;
}

function Field({ label, id, type = "text", value, onChange, error, placeholder, disabled, autoComplete, hint }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? "#FF4C4C" : focused ? "#1DB954" : "#2a2a2a";
  const boxShadow   = error
    ? "0 0 0 3px rgba(255,76,76,0.15)"
    : focused ? "0 0 0 3px rgba(29,185,84,0.15)" : "none";

  return (
    <div style={{ marginBottom: 4 }}>
      <label htmlFor={id} style={{ display: "block", marginBottom: 6, color: "#888", fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        disabled={disabled} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={()  => setFocused(false)}
        style={{
          width: "100%", background: "#1a1a1a", color: "#fff",
          border: `1px solid ${borderColor}`, borderRadius: 8, padding: "13px 14px",
          fontSize: 15, outline: "none", boxSizing: "border-box",
          transition: "border-color 180ms, box-shadow 180ms",
          boxShadow, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "text",
        }}
      />
      {hint && !error && (
        <p style={{ margin: "5px 0 0 2px", color: "#555", fontSize: 11, lineHeight: 1.5 }}>{hint}</p>
      )}
      {error && (
        <p role="alert" style={{ margin: "5px 0 0 2px", color: "#FF4C4C", fontSize: 12, lineHeight: 1.5, animation: "shake 280ms ease-in-out" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Progress indicator ───────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Checking ID", "Creating account", "Saving record"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, padding: "12px 16px", background: "#111", borderRadius: 10, border: "1px solid #1e1e1e" }}>
      {steps.map((label, i) => {
        const idx    = i + 1;
        const active = idx === step;
        const done   = idx < step;
        return (
          <React.Fragment key={label}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: done ? "#1DB954" : active ? "#1DB95440" : "#222",
                border: `2px solid ${done ? "#1DB954" : active ? "#1DB954" : "#333"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: done ? "#000" : active ? "#1DB954" : "#444", fontWeight: 700,
              }}>
                {done ? "✓" : idx}
              </div>
              <span style={{ fontSize: 11, color: active ? "#1DB954" : done ? "#888" : "#444", fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 20, height: 1, background: done ? "#1DB954" : "#333", flexShrink: 0 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Signup() {
  const navigate = useNavigate();

  const [officerId, setOfficerId] = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner,      setBanner]      = useState<{ type: "error" | "warning" | "success"; message: string } | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [step,        setStep]        = useState<1 | 2 | 3 | null>(null);
  const [succeeded,   setSucceeded]   = useState(false);
  const [registered,  setRegistered]  = useState({ email: "", officerId: "" });

  const bannerRef = useRef<HTMLDivElement>(null);

  const showBanner = useCallback((type: "error" | "warning" | "success", message: string) => {
    setBanner({ type, message });
    setTimeout(() => bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }, []);

  const clearFieldError = useCallback((field: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev }; delete next[field]; return next;
    });
    if (banner) setBanner(null);
  }, [banner]);

  // ─── Submit handler ─────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setStep(null);

    const normId    = officerId.trim().toUpperCase();
    const normEmail = email.trim().toLowerCase();

    // Client-side validation
    const errs = validateFields(normId, normEmail, password, confirm);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showBanner("error", "Please correct the highlighted fields before continuing.");
      return;
    }
    setFieldErrors({});
    setLoading(true);

    // ── Phase 1: Backend uniqueness check ────────────────────────────────────
    setStep(1);
    let checkToken: string;

    try {
      const { data } = await api.post<{ ok: boolean; checkToken: string }>(
        "/api/auth/register/check",
        { officerId: normId, email: normEmail }
      );
      checkToken = data.checkToken;
    } catch (err) {
      setLoading(false);
      setStep(null);
      const { code, message } = normaliseAxiosError(err);
      const resolved = resolveError(code, message);
      if (resolved.field) setFieldErrors({ [resolved.field]: resolved.message });
      const bannerType: "error" | "warning" =
        code === "EMAIL_TAKEN" || code === "EMAIL_EXISTS" ? "warning" : "error";
      showBanner(bannerType, resolved.message);
      return;
    }

    // ── Phase 2: Create Firebase account via Web SDK ──────────────────────────
    setStep(2);
    let firebaseUid: string;

    try {
      const credential = await createUserWithEmailAndPassword(auth, normEmail, password);
      firebaseUid      = credential.user.uid;

      // Send verification email straight from Firebase (no Admin SDK needed)
      await sendEmailVerification(credential.user);
    } catch (err: any) {
      setLoading(false);
      setStep(null);

      // Map Firebase error codes
      const code     = err?.code ?? "UNKNOWN";
      const resolved = resolveError(code, err?.message ?? "Failed to create Firebase account.");
      if (resolved.field) setFieldErrors({ [resolved.field]: resolved.message });
      showBanner("error", resolved.message);
      return;
    }

    // ── Phase 3: Save to MongoDB via backend ──────────────────────────────────
    setStep(3);

    try {
      await api.post("/api/auth/register/complete", { checkToken, firebaseUid });
    } catch (err) {
      // If the DB save fails, clean up the Firebase account so the user can retry.
      try {
        const currentUser = auth.currentUser;
        if (currentUser) await deleteUser(currentUser);
      } catch {
        // Ignore cleanup errors — user can contact support.
      }

      setLoading(false);
      setStep(null);
      const { code, message } = normaliseAxiosError(err);
      showBanner("error", resolveError(code, message).message);
      return;
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    setLoading(false);
    setStep(null);
    setRegistered({ email: normEmail, officerId: normId });
    setSucceeded(true);
  };

  // ─── Success view ────────────────────────────────────────────────────────────

  if (succeeded) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>
        <SuccessCard
          email={registered.email}
          officerId={registered.officerId}
          onGoLogin={() => navigate("/login")}
        />
      </div>
    );
  }

  // ─── Registration form ────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px 64px" }}>

      {/* Banner anchor */}
      <div ref={bannerRef} style={{ width: "100%", maxWidth: 480 }}>
        {banner && <Banner type={banner.type} message={banner.message} onClose={() => setBanner(null)} />}
      </div>

      {/* Heading */}
      <div style={{ width: "100%", maxWidth: 480, marginBottom: 32 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#1DB954", letterSpacing: "-0.5px" }}>
          Officer Registration
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: 14, lineHeight: 1.6 }}>
          Zimbabwe Republic Police · Traffic Enforcement Division
        </p>
      </div>

      {/* Progress steps (visible while loading) */}
      {step !== null && (
        <div style={{ width: "100%", maxWidth: 480, marginBottom: 16 }}>
          <StepIndicator step={step} />
        </div>
      )}

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          width: "100%", maxWidth: 480, background: "#111", borderRadius: 14,
          border: "1px solid #1e1e1e", padding: "32px 28px",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <Field
          label="Officer ID" id="officerId" value={officerId}
          onChange={(v) => { setOfficerId(v); clearFieldError("officerId"); }}
          error={fieldErrors.officerId} placeholder="e.g. A123456B"
          disabled={loading} autoComplete="username"
          hint="Format: A123456B or 9 numeric digits"
        />
        <Field
          label="Email Address" id="email" type="email" value={email}
          onChange={(v) => { setEmail(v); clearFieldError("email"); }}
          error={fieldErrors.email} placeholder="officer@zrp.gov.zw"
          disabled={loading} autoComplete="email"
        />
        <Field
          label="Password" id="password" type="password" value={password}
          onChange={(v) => { setPassword(v); clearFieldError("password"); }}
          error={fieldErrors.password} placeholder="Create a strong password"
          disabled={loading} autoComplete="new-password"
          hint="Min 8 chars · 1 uppercase · 1 special character"
        />
        <Field
          label="Confirm Password" id="confirm" type="password" value={confirm}
          onChange={(v) => { setConfirm(v); clearFieldError("confirm"); }}
          error={fieldErrors.confirm} placeholder="Repeat your password"
          disabled={loading} autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 8, width: "100%", padding: "14px",
            background: loading ? "#155c30" : "#1DB954", color: "#000",
            border: "none", borderRadius: 30, fontSize: 16, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            transition: "background 200ms",
          }}
        >
          {loading ? (
            <>
              <span style={{ width: 18, height: 18, border: "2px solid rgba(0,0,0,0.3)", borderTop: "2px solid #000", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
              {step === 1 ? "Checking Officer ID…" : step === 2 ? "Creating Account…" : "Saving Record…"}
            </>
          ) : "Create Account"}
        </button>
      </form>

      <p style={{ marginTop: 24, color: "#555", fontSize: 14 }}>
        Already have an account?{" "}
        <Link to="/login" style={{ color: "#1DB954", fontWeight: 600 }}>Sign In</Link>
      </p>

      <p style={{ marginTop: 28, maxWidth: 440, color: "#333", fontSize: 11, textAlign: "center", lineHeight: 1.7 }}>
        ⚠️ Unauthorised access to this system is a criminal offence under the Computer
        Crime and Cyber Crime Act [Chapter 9:23] of Zimbabwe. Only ZRP officers may
        register. All registration attempts are logged.
      </p>

      <style>{`
        @keyframes slideDown { from { opacity:0; transform:translateY(-14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shake { 0%,100% { transform:translateX(0); } 25% { transform:translateX(-4px); } 75% { transform:translateX(4px); } }
        @keyframes spin { to { transform:rotate(360deg); } }
      `}</style>
    </div>
  );
}