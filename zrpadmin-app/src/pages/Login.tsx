/**
 * src/pages/Login.tsx
 *
 * Sign-in page for the ZRP Admin web application.
 *
 * Handles:
 *  - Field-level validation
 *  - Firebase credential verification → backend JWT exchange
 *  - Network errors
 *  - VPN / proxy blocking (COMMERCIAL_VPN_BLOCKED from backend)
 *  - Pending account ("admins haven't allowed you yet")
 *  - Rejected / banned account
 *  - Session expiry (JWT_EXPIRED from a previous session)
 *  - Double-press prevention (button disabled while loading)
 *  - Redirect to /dashboard on success
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, Link, useLocation }                    from "react-router-dom";
import { loginOfficer }                                      from "../auth/authService";
import { useOfficer }                                        from "../context/OfficerContext";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FieldErrors {
  officerId?: string;
  email?:     string;
  password?:  string;
}

type BannerType = "error" | "warning" | "info" | "success";

interface BannerState {
  type:    BannerType;
  title?:  string;
  message: string;
}

// ─── Error catalogue ──────────────────────────────────────────────────────────

/**
 * Maps backend / Firebase error codes to user-facing copy.
 * field: which input to highlight, if any.
 * banner: what to show in the top banner.
 */
const ERROR_MAP: Record<
  string,
  { field?: keyof FieldErrors; bannerType: BannerType; title?: string; message: string }
> = {
  // Auth / credential errors
  INVALID_CREDENTIAL: {
    field:      "password",
    bannerType: "error",
    message:    "The Officer ID, email or password you entered is incorrect. Please check your details and try again.",
  },
  INVALID_CREDENTIALS: {
    field:      "password",
    bannerType: "error",
    message:    "The Officer ID, email or password you entered is incorrect. Please check your details and try again.",
  },
  OFFICER_ID_MISMATCH: {
    field:      "officerId",
    bannerType: "error",
    message:    "The Officer ID does not match the account registered to this email address.",
  },
  USER_NOT_FOUND: {
    field:      "email",
    bannerType: "error",
    message:    "No account was found for this email address. Please check your email or register.",
  },
  TOO_MANY_REQUESTS: {
    bannerType: "warning",
    title:      "Account Temporarily Locked",
    message:    "Too many failed attempts have been detected. Please wait a few minutes before trying again, or reset your password.",
  },
  USER_DISABLED: {
    bannerType: "error",
    title:      "Account Disabled",
    message:    "This Firebase account has been disabled. Please contact your system administrator.",
  },

  // Account status errors
  ACCOUNT_PENDING: {
    bannerType: "warning",
    title:      "Account Pending Approval",
    message:
      "We sincerely regret that our administrators have not yet granted you access to the system. " +
      "Your registration is being reviewed and you will be notified by email once approved. " +
      "If you believe this is an error, please contact your commanding officer or system administrator.",
  },
  ACCOUNT_REJECTED: {
    bannerType: "error",
    title:      "Account Access Denied",
    message:
      "Access to this account has been denied by an administrator. " +
      "If you believe this is in error, please contact your commanding officer immediately.",
  },

  // Session errors
  TOKEN_EXPIRED: {
    bannerType: "warning",
    title:      "Session Expired",
    message:    "We're sorry — your previous session has expired. Please sign in again to continue using the application.",
  },
  JWT_EXPIRED: {
    bannerType: "warning",
    title:      "Session Expired",
    message:    "We're sorry — your previous session has expired. Please sign in again to continue using the application.",
  },
  INVALID_TOKEN: {
    bannerType: "warning",
    title:      "Session Expired",
    message:    "We're sorry — your previous session has expired. Please sign in again to continue using the application.",
  },

  // VPN / proxy
  COMMERCIAL_VPN_BLOCKED: {
    bannerType: "error",
    title:      "Connection Blocked",
    message:
      "Your connection has been identified as originating from a VPN or proxy service. " +
      "For security reasons, access to the BlowSafe platform is restricted to direct connections only. " +
      "Please disable your VPN and try again.",
  },
  VPN_BLOCKED: {
    bannerType: "error",
    title:      "Connection Blocked",
    message:
      "Your connection has been identified as originating from a VPN or proxy service. " +
      "Please disable your VPN and try again.",
  },

  // Network
  NETWORK_ERROR: {
    bannerType: "error",
    title:      "Connection Error",
    message:    "Unable to reach the BlowSafe servers. Please check your internet connection and try again.",
  },

  // Email not verified
  EMAIL_NOT_VERIFIED: {
    bannerType: "warning",
    title:      "Email Not Verified",
    message:    "Your email address has not been verified yet. Please check your inbox for the verification link that was sent when you registered.",
  },

  // Fallback
  SERVER_ERROR: {
    bannerType: "error",
    title:      "Server Error",
    message:    "An unexpected server error occurred. Please try again in a few minutes. If the problem persists, contact your system administrator.",
  },
};

function resolveError(code: string, fallback: string) {
  return (
    ERROR_MAP[code] ?? {
      bannerType: "error" as BannerType,
      message:    fallback,
    }
  );
}

// ─── Validation ───────────────────────────────────────────────────────────────

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateFields(
  officerId: string,
  email:     string,
  password:  string
): FieldErrors {
  const errs: FieldErrors = {};
  if (!officerId.trim())
    errs.officerId = "Officer ID is required.";
  else if (!OFFICER_ID_RE.test(officerId.trim()))
    errs.officerId = "Invalid format — expected A123456B or 9 digits.";
  if (!email.trim())
    errs.email = "Email address is required.";
  else if (!EMAIL_RE.test(email.trim()))
    errs.email = "Enter a valid email address.";
  if (!password)
    errs.password = "Password is required.";
  return errs;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface BannerProps {
  banner:  BannerState;
  onClose: () => void;
}

function Banner({ banner, onClose }: BannerProps) {
  const palette: Record<BannerType, { bg: string; border: string; text: string; icon: string }> = {
    error:   { bg: "rgba(255,76,76,0.08)",   border: "#FF4C4C", text: "#FF4C4C",   icon: "✕" },
    warning: { bg: "rgba(255,165,0,0.08)",   border: "#FFA500", text: "#FFA500",   icon: "⚠" },
    info:    { bg: "rgba(59,139,235,0.08)",   border: "#3B8BEB", text: "#3B8BEB",   icon: "ℹ" },
    success: { bg: "rgba(29,185,84,0.08)",    border: "#1DB954", text: "#1DB954",   icon: "✓" },
  };
  const p = palette[banner.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        width: "100%", maxWidth: 480, marginBottom: 20,
        background: p.bg, border: `1px solid ${p.border}`,
        borderLeft: `4px solid ${p.border}`, borderRadius: 10,
        padding: "14px 44px 14px 18px", position: "relative",
        animation: "bannerIn 240ms ease-out",
      }}
    >
      {banner.title && (
        <p style={{ margin: "0 0 4px", color: p.text, fontSize: 13, fontWeight: 700, letterSpacing: "0.2px" }}>
          {banner.title}
        </p>
      )}
      <p style={{ margin: 0, color: "#ccc", fontSize: 13, lineHeight: 1.65 }}>
        {banner.message}
      </p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          position: "absolute", top: 10, right: 12, background: "none",
          border: "none", color: p.text, fontSize: 16, cursor: "pointer",
          opacity: 0.7, lineHeight: 1, padding: 4,
        }}
      >
        {p.icon}
      </button>
    </div>
  );
}

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
  onEnter?:     () => void;
}

function Field({
  label, id, type = "text", value, onChange, error,
  placeholder, disabled, autoComplete, hint, onEnter,
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? "#FF4C4C"
    : focused
    ? "#1DB954"
    : "#2a2a2a";
  const boxShadow = error
    ? "0 0 0 3px rgba(255,76,76,0.12)"
    : focused
    ? "0 0 0 3px rgba(29,185,84,0.12)"
    : "none";

  return (
    <div style={{ marginBottom: 4 }}>
      <label
        htmlFor={id}
        style={{
          display: "block", marginBottom: 6, color: "#888",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase",
        }}
      >
        {label}
      </label>
      <input
        id={id} type={type} value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        style={{
          width: "100%", background: "#1a1a1a",
          color: disabled ? "#555" : "#fff",
          border: `1px solid ${borderColor}`,
          borderRadius: 8, padding: "13px 14px", fontSize: 15,
          outline: "none", boxSizing: "border-box",
          transition: "border-color 180ms, box-shadow 180ms",
          boxShadow, opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "not-allowed" : "text",
          caretColor: "#1DB954",
        }}
      />
      {hint && !error && (
        <p style={{ margin: "5px 0 0 2px", color: "#555", fontSize: 11, lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {error && (
        <p
          role="alert"
          style={{
            margin: "5px 0 0 2px", color: "#FF4C4C",
            fontSize: 12, lineHeight: 1.5, animation: "shake 260ms ease-in-out",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Login() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { setOfficer } = useOfficer();

  const [officerId, setOfficerId] = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner,      setBanner]      = useState<BannerState | null>(null);
  const [loading,     setLoading]     = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);

  // Show session-expired banner if redirected here with a reason
  useEffect(() => {
    const state = location.state as { reason?: string } | null;
    if (state?.reason === "session_expired") {
      setBanner({
        type:    "warning",
        title:   "Session Expired",
        message:
          "We're sorry — your session has expired. Please sign in again to continue using the application.",
      });
      // Clear the state so a refresh doesn't re-show it
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const showBanner = useCallback((state: BannerState) => {
    setBanner(state);
    setTimeout(
      () => bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      40
    );
  }, []);

  const clearFieldError = useCallback(
    (field: keyof FieldErrors) => {
      setFieldErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  // ─── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (loading) return; // hard guard against double-press
    setBanner(null);

    const normId    = officerId.trim().toUpperCase();
    const normEmail = email.trim().toLowerCase();

    const errs = validateFields(normId, normEmail, password);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showBanner({
        type:    "error",
        message: "Please correct the highlighted fields before continuing.",
      });
      return;
    }
    setFieldErrors({});
    setLoading(true);

    const result = await loginOfficer(normId, normEmail, password);
    setLoading(false);

    if (!result.success) {
      const resolved = resolveError(result.code, result.message);
      if (resolved.field) {
        setFieldErrors({ [resolved.field]: resolved.message });
      }
      showBanner({
        type:    resolved.bannerType,
        title:   resolved.title,
        message: resolved.message,
      });
      return;
    }

    // Persist officer context and navigate
    await setOfficer({
      uid:      result.uid,
      officerId: result.officerId,
      role:     result.role as "admin" | "officer",
      status:   result.status as "active" | "rejected" | "pending",
    });

    navigate("/dashboard", { replace: true });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh", background: "#0a0a0a",
        display: "flex", flexDirection: "column",
        alignItems: "center", padding: "48px 16px 64px",
      }}
    >
      {/* ── Banner anchor ─────────────────────────────────────────────────── */}
      <div ref={bannerRef} style={{ width: "100%", maxWidth: 480 }}>
        {banner && (
          <Banner banner={banner} onClose={() => setBanner(null)} />
        )}
      </div>

      {/* ── Heading ───────────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 480, marginBottom: 32 }}>
        <h1
          style={{
            margin: "0 0 6px", fontSize: 26, fontWeight: 700,
            color: "#1DB954", letterSpacing: "-0.5px",
          }}
        >
          Officer Sign In
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: 14, lineHeight: 1.6 }}>
          Zimbabwe Republic Police · Traffic Enforcement Division
        </p>
      </div>

      {/* ── Form card ─────────────────────────────────────────────────────── */}
      <div
        style={{
          width: "100%", maxWidth: 480,
          background: "#111", borderRadius: 14,
          border: "1px solid #1e1e1e", padding: "32px 28px",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <Field
          label="Officer ID"
          id="officerId"
          value={officerId}
          onChange={(v) => { setOfficerId(v); clearFieldError("officerId"); }}
          error={fieldErrors.officerId}
          placeholder="e.g. A123456B"
          disabled={loading}
          autoComplete="username"
          hint="Format: A123456B or 9 numeric digits"
          onEnter={handleSubmit}
        />

        <Field
          label="Email Address"
          id="email"
          type="email"
          value={email}
          onChange={(v) => { setEmail(v); clearFieldError("email"); }}
          error={fieldErrors.email}
          placeholder="officer@zrp.gov.zw"
          disabled={loading}
          autoComplete="email"
          onEnter={handleSubmit}
        />

        <Field
          label="Password"
          id="password"
          type="password"
          value={password}
          onChange={(v) => { setPassword(v); clearFieldError("password"); }}
          error={fieldErrors.password}
          placeholder="Enter your password"
          disabled={loading}
          autoComplete="current-password"
          onEnter={handleSubmit}
        />

        {/* Forgot password */}
        <div style={{ textAlign: "right", marginTop: -6 }}>
          <Link
            to="/forgot-password"
            style={{
              color: "#555", fontSize: 12, textDecoration: "none",
              transition: "color 160ms",
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#1DB954"; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "#555"; }}
          >
            Forgot your password?
          </Link>
        </div>

        {/* Submit button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          aria-busy={loading}
          style={{
            marginTop: 8, width: "100%", padding: "14px",
            background: loading ? "#155c30" : "#1DB954",
            color: "#000", border: "none", borderRadius: 30,
            fontSize: 16, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center",
            justifyContent: "center", gap: 10,
            transition: "background 200ms, transform 100ms",
            transform: "scale(1)",
          }}
          onMouseDown={(e) => {
            if (!loading) (e.currentTarget.style.transform = "scale(0.98)");
          }}
          onMouseUp={(e) => {
            (e.currentTarget.style.transform = "scale(1)");
          }}
        >
          {loading ? (
            <>
              <span
                style={{
                  width: 18, height: 18,
                  border: "2px solid rgba(0,0,0,0.25)",
                  borderTop: "2px solid #000",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                  flexShrink: 0,
                }}
              />
              Signing In…
            </>
          ) : (
            "Sign In"
          )}
        </button>
      </div>

      {/* ── Footer links ──────────────────────────────────────────────────── */}
      <p style={{ marginTop: 24, color: "#555", fontSize: 14 }}>
        Don't have an account?{" "}
        <Link
          to="/signup"
          style={{ color: "#1DB954", fontWeight: 600, textDecoration: "none" }}
        >
          Register
        </Link>
      </p>

      {/* ── Legal notice ──────────────────────────────────────────────────── */}
      <p
        style={{
          marginTop: 28, maxWidth: 440, color: "#333",
          fontSize: 11, textAlign: "center", lineHeight: 1.7,
        }}
      >
        ⚠️ Unauthorised access to this system is a criminal offence under the Computer
        Crime and Cyber Crime Act [Chapter 9:23] of Zimbabwe. All access attempts are
        logged and monitored.
      </p>

      {/* ── Global keyframes ──────────────────────────────────────────────── */}
      <style>{`
        @keyframes bannerIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25%      { transform: translateX(-4px); }
          75%      { transform: translateX(4px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}