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
import { useNavigate, Link } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  deleteUser,
} from "firebase/auth";
import axios, { type AxiosError } from "axios";

import { auth } from "../auth/firebaseConfig";
import "../designs/Signup.css"; // ✅ Import external CSS

// ─── API client ───────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldErrors {
  officerId?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*[!@#$%^&*]).{8,}$/;

function validateFields(
  officerId: string,
  email: string,
  password: string,
  confirm: string
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
    const data = ax.response.data ?? {};
    const code = data.code ?? "SERVER_ERROR";
    const message = data.message ?? data.error ?? "An unexpected server error occurred.";
    return { code, message };
  }
  if (ax.request) return { code: "NETWORK_ERROR", message: "Network error — check your connection." };
  return { code: "CLIENT_ERROR", message: (err as Error).message ?? "An unexpected error occurred." };
}

// Map backend / Firebase error codes → user-friendly messages
const ERROR_MAP: Record<string, { field?: keyof FieldErrors; message: string }> = {
  OFFICER_ID_TAKEN: { field: "officerId", message: "This Officer ID is already registered." },
  OFFICER_ID_IN_USE: { field: "officerId", message: "This Officer ID is already registered." },
  EMAIL_TAKEN: { field: "email", message: "An account with this email already exists. Sign in instead." },
  EMAIL_EXISTS: { field: "email", message: "An account with this email already exists. Sign in instead." },
  "auth/email-already-in-use": { field: "email", message: "This email is already registered with Firebase. Sign in instead." },
  "auth/invalid-email": { field: "email", message: "The email address is not valid." },
  "auth/weak-password": { field: "password", message: "Password is too weak. Use at least 6 characters." },
  RATE_LIMITED: { message: "Too many attempts. Please wait before trying again." },
  INTERNAL_ERROR: { message: "A server error occurred. Please try again in a few minutes." },
  NETWORK_ERROR: { message: "Network error — check your internet connection." },
};

function resolveError(code: string, fallback: string) {
  return ERROR_MAP[code] ?? { message: fallback };
}

// ─── Banner component ─────────────────────────────────────────────────────────

interface BannerProps {
  type: "error" | "warning" | "success";
  message: string;
  onClose: () => void;
}

function Banner({ type, message, onClose }: BannerProps) {
  return (
    <div
      role="alert"
      className={`signup-banner ${type}`}
    >
      {message}
      <button
        onClick={onClose}
        aria-label="Close"
        className="signup-banner-close"
      >✕</button>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────

interface SuccessCardProps {
  email: string;
  officerId: string;
  onGoLogin: () => void;
}

function SuccessCard({ email, officerId, onGoLogin }: SuccessCardProps) {
  return (
    <div className="success-card">
      <span className="success-icon">✉️</span>
      <h2 className="success-title">Check Your Email</h2>
      <p className="success-text">A verification link has been sent to</p>
      <p className="success-email">{email}</p>
      
      <div className="success-details">
        {([
          ["Officer ID", officerId],
          ["Status", "Pending administrator approval"],
          ["Next steps", "Verify your email, then wait 24–48 h for approval"],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="success-detail-row">
            <span className="success-detail-label">{label}</span>
            <span className="success-detail-value">{value}</span>
          </div>
        ))}
      </div>
      
      <div className="success-warning">
        <p className="success-warning-text">
          ⚠️ Don't see the email? Check your spam or junk folder.
        </p>
      </div>
      
      <button onClick={onGoLogin} className="success-btn">
        Go to Sign In
      </button>
    </div>
  );
}

// ─── Field component ──────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder: string;
  disabled?: boolean;
  autoComplete?: string;
  hint?: string;
}

function Field({ label, id, type = "text", value, onChange, error, placeholder, disabled, autoComplete, hint }: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="field-group">
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`field-input ${error ? "error" : ""}`}
      />
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && (
        <p role="alert" className="field-error">
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
    <div className="step-indicator">
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <React.Fragment key={label}>
            <div className="step-item">
              <div className={`step-bubble ${done ? "done" : active ? "active" : "pending"}`}>
                {done ? "✓" : idx}
              </div>
              <span className={`step-label ${active ? "active" : done ? "done" : "pending"}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-divider ${done ? "done" : "pending"}`} />
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ type: "error" | "warning" | "success"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [registered, setRegistered] = useState({ email: "", officerId: "" });

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

    const normId = officerId.trim().toUpperCase();
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
      firebaseUid = credential.user.uid;

      // Send verification email straight from Firebase (no Admin SDK needed)
      await sendEmailVerification(credential.user);
    } catch (err: any) {
      setLoading(false);
      setStep(null);

      // Map Firebase error codes
      const code = err?.code ?? "UNKNOWN";
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
      <div className="signup-root" style={{ justifyContent: "center" }}>
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
    <div className="signup-root">
      {/* Banner anchor */}
      <div ref={bannerRef}>
        {banner && <Banner type={banner.type} message={banner.message} onClose={() => setBanner(null)} />}
      </div>

      {/* Heading */}
      <div className="signup-header">
        <h1 className="signup-title">Officer Registration</h1>
        <p className="signup-subtitle">Zimbabwe Republic Police · Traffic Enforcement Division</p>
      </div>

      {/* Progress steps (visible while loading) */}
      {step !== null && (
        <div className="signup-steps">
          <StepIndicator step={step} />
        </div>
      )}

      {/* Form card */}
      <form onSubmit={handleSubmit} noValidate className="signup-form-card">
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

        <button type="submit" disabled={loading} className="signup-btn">
          {loading ? (
            <>
              <span className="spinner" />
              {step === 1 ? "Checking Officer ID…" : step === 2 ? "Creating Account…" : "Saving Record…"}
            </>
          ) : "Create Account"}
        </button>
      </form>

      <p className="signup-footer">
        Already have an account?{" "}
        <Link to="/login" className="signup-link">Sign In</Link>
      </p>

      <p className="signup-legal">
        ⚠️ Unauthorised access to this system is a criminal offence under the Computer
        Crime and Cyber Crime Act [Chapter 9:23] of Zimbabwe. Only ZRP officers may
        register. All registration attempts are logged.
      </p>
    </div>
  );
}