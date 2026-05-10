/**
 * src/pages/Signup.tsx
 *
 * ZRP Officer registration page.
 * Delegates the entire registration flow to the backend — no Firebase
 * client SDK calls happen here. The backend owns:
 *   • duplicate ID / email checks
 *   • Firebase user creation
 *   • email verification dispatch
 *   • MongoDB record creation (status: pending)
 */

import React, { useState, useRef, useCallback } from "react";
import { useNavigate, Link }                     from "react-router-dom";
import { registerOfficer }                       from "../auth/authService";
import "../designs/Signup.css";

// ─── Validation ───────────────────────────────────────────────────────────────

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE   = /^(?=.*[A-Z])(?=.*[!@#$%^&*]).{8,}$/;

interface FieldErrors {
  officerId?: string;
  email?:     string;
  password?:  string;
  confirm?:   string;
}

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
    errs.password = "Minimum 8 characters, one uppercase letter, one special character.";

  if (!confirm)
    errs.confirm = "Please confirm your password.";
  else if (password !== confirm)
    errs.confirm = "Passwords do not match.";

  return errs;
}

// ─── Error code → user message map ───────────────────────────────────────────

const BACKEND_ERRORS: Record<string, { field?: keyof FieldErrors; message: string }> = {
  OFFICER_ID_TAKEN:    { field: "officerId", message: "This Officer ID is already registered. Please use your actual officer ID." },
  OFFICER_ID_EXISTS:   { field: "officerId", message: "This Officer ID is already registered. Please use your actual officer ID." },
  EMAIL_TAKEN:         { field: "email",     message: "An account with this email already exists. Sign in instead." },
  EMAIL_EXISTS:        { field: "email",     message: "An account with this email already exists. Sign in instead." },
  BAD_REQUEST:         {                     message: "Some fields are invalid — please review and try again." },
  RATE_LIMITED:        {                     message: "Too many registration attempts. Please wait a moment before trying again." },
  INTERNAL_ERROR:      {                     message: "A server error occurred. Please try again in a few minutes." },
  NETWORK_ERROR:       {                     message: "Network error — check your internet connection and try again." },
  MAILER_SEND_FAILED:  {                     message: "Account created but we could not send the verification email. Contact your administrator." },
};

function resolveBackendError(code: string, fallbackMessage: string): { field?: keyof FieldErrors; message: string } {
  return BACKEND_ERRORS[code] ?? { message: fallbackMessage };
}

// ─── Banner component ─────────────────────────────────────────────────────────

interface BannerProps {
  type:    "error" | "warning" | "success";
  message: string;
  onClose: () => void;
}

function Banner({ type, message, onClose }: BannerProps) {
  const colours: Record<BannerProps["type"], string> = {
    error:   "#FF4C4C",
    warning: "#FFA500",
    success: "#1DB954",
  };

  return (
    <div
      role="alert"
      style={{
        position:       "relative",
        width:          "100%",
        maxWidth:       480,
        padding:        "14px 44px 14px 18px",
        borderRadius:   10,
        marginBottom:   20,
        background:     colours[type],
        color:          type === "warning" ? "#000" : "#fff",
        fontSize:       14,
        fontWeight:     600,
        lineHeight:     1.5,
        whiteSpace:     "pre-line",
        boxShadow:      "0 4px 16px rgba(0,0,0,0.35)",
        animation:      "slideDown 280ms ease-out",
      }}
    >
      {message}
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position:   "absolute",
          top:        10,
          right:      12,
          background: "none",
          border:     "none",
          color:      "inherit",
          fontSize:   18,
          cursor:     "pointer",
          opacity:    0.75,
          lineHeight: 1,
          padding:    4,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Success state ────────────────────────────────────────────────────────────

interface SuccessCardProps {
  email:     string;
  officerId: string;
  onGoLogin: () => void;
}

function SuccessCard({ email, officerId, onGoLogin }: SuccessCardProps) {
  return (
    <div style={{
      width:          "100%",
      maxWidth:       480,
      background:     "#151515",
      borderRadius:   14,
      border:         "1px solid #1DB95440",
      padding:        "36px 32px",
      textAlign:      "center",
      animation:      "slideDown 350ms ease-out",
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
        background:   "#1a1a1a",
        borderRadius: 10,
        border:       "1px solid #222",
        padding:      "14px 18px",
        marginBottom: 24,
        textAlign:    "left",
      }}>
        {[
          ["Officer ID",  officerId],
          ["Status",      "Pending administrator approval"],
          ["Next steps",  "Verify your email, then wait 24–48 h for approval"],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
            <span style={{ color: "#555", fontSize: 12, minWidth: 80, paddingTop: 1 }}>{label}</span>
            <span style={{ color: "#ccc", fontSize: 13, lineHeight: 1.5 }}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{
        background:   "#1a1a1a",
        borderLeft:   "3px solid #FFA500",
        borderRadius: 8,
        padding:      "12px 16px",
        marginBottom: 28,
        textAlign:    "left",
      }}>
        <p style={{ margin: 0, color: "#FFA500", fontSize: 12, lineHeight: 1.6 }}>
          ⚠️ Don't see the email? Check your spam or junk folder.
        </p>
      </div>

      <button
        onClick={onGoLogin}
        style={{
          width:        "100%",
          padding:      "14px",
          background:   "#1DB954",
          color:        "#000",
          border:       "none",
          borderRadius: 30,
          fontSize:     16,
          fontWeight:   700,
          cursor:       "pointer",
          transition:   "opacity 200ms",
        }}
        onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.opacity = "0.88")}
        onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.opacity = "1")}
      >
        Go to Sign In
      </button>
    </div>
  );
}

// ─── Field component ──────────────────────────────────────────────────────────

interface FieldProps {
  label:       string;
  id:          string;
  type?:       string;
  value:       string;
  onChange:    (v: string) => void;
  error?:      string;
  placeholder: string;
  disabled?:   boolean;
  autoComplete?: string;
  hint?:       string;
}

function Field({ label, id, type = "text", value, onChange, error, placeholder, disabled, autoComplete, hint }: FieldProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error ? "#FF4C4C" : focused ? "#1DB954" : "#2a2a2a";
  const boxShadow   = error
    ? "0 0 0 3px rgba(255,76,76,0.15)"
    : focused
      ? "0 0 0 3px rgba(29,185,84,0.15)"
      : "none";

  return (
    <div style={{ marginBottom: 4 }}>
      <label
        htmlFor={id}
        style={{ display: "block", marginBottom: 6, color: "#888", fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}
      >
        {label}
      </label>
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
        style={{
          width:          "100%",
          background:     "#1a1a1a",
          color:          "#fff",
          border:         `1px solid ${borderColor}`,
          borderRadius:   8,
          padding:        "13px 14px",
          fontSize:       15,
          outline:        "none",
          boxSizing:      "border-box",
          transition:     "border-color 180ms, box-shadow 180ms",
          boxShadow,
          opacity:        disabled ? 0.5 : 1,
          cursor:         disabled ? "not-allowed" : "text",
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
          style={{ margin: "5px 0 0 2px", color: "#FF4C4C", fontSize: 12, lineHeight: 1.5, animation: "shake 280ms ease-in-out" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Signup() {
  const navigate = useNavigate();

  const [officerId, setOfficerId] = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner,      setBanner]      = useState<{ type: "error" | "warning" | "success"; message: string } | null>(null);
  const [loading,     setLoading]     = useState(false);
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
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (banner) setBanner(null);
  }, [banner]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);

    const normId    = officerId.trim().toUpperCase();
    const normEmail = email.trim().toLowerCase();

    // ── Client-side validation ─────────────────────────────────────────────
    const errs = validateFields(normId, normEmail, password, confirm);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showBanner("error", "Please correct the highlighted fields before continuing.");
      return;
    }
    setFieldErrors({});

    // ── Submit to backend ──────────────────────────────────────────────────
    setLoading(true);

    const result = await registerOfficer(normId, normEmail, password);

    setLoading(false);

    if (result.success) {
      setRegistered({ email: normEmail, officerId: normId });
      setSucceeded(true);
      return;
    }

    // ── Map backend error to field or banner ───────────────────────────────
    const resolved = resolveBackendError(result.code, result.message);

    if (resolved.field) {
      setFieldErrors({ [resolved.field]: resolved.message });
    }

    const bannerType: "error" | "warning" =
      result.code === "EMAIL_TAKEN" || result.code === "EMAIL_EXISTS"
        ? "warning"
        : "error";

    showBanner(bannerType, resolved.message);
  };

  // ── Success view ───────────────────────────────────────────────────────────
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

  // ── Registration form ──────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px 64px" }}>

      {/* Banner anchor */}
      <div ref={bannerRef} style={{ width: "100%", maxWidth: 480 }}>
        {banner && (
          <Banner
            type={banner.type}
            message={banner.message}
            onClose={() => setBanner(null)}
          />
        )}
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

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          width:        "100%",
          maxWidth:     480,
          background:   "#111",
          borderRadius: 14,
          border:       "1px solid #1e1e1e",
          padding:      "32px 28px",
          display:      "flex",
          flexDirection:"column",
          gap:          14,
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
        />

        <Field
          label="Password"
          id="password"
          type="password"
          value={password}
          onChange={(v) => { setPassword(v); clearFieldError("password"); }}
          error={fieldErrors.password}
          placeholder="Create a strong password"
          disabled={loading}
          autoComplete="new-password"
          hint="Min 8 characters · 1 uppercase letter · 1 special character"
        />

        <Field
          label="Confirm Password"
          id="confirm"
          type="password"
          value={confirm}
          onChange={(v) => { setConfirm(v); clearFieldError("confirm"); }}
          error={fieldErrors.confirm}
          placeholder="Repeat your password"
          disabled={loading}
          autoComplete="new-password"
        />

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop:    8,
            width:        "100%",
            padding:      "14px",
            background:   loading ? "#155c30" : "#1DB954",
            color:        "#000",
            border:       "none",
            borderRadius: 30,
            fontSize:     16,
            fontWeight:   700,
            cursor:       loading ? "not-allowed" : "pointer",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            gap:          10,
            transition:   "background 200ms",
          }}
        >
          {loading ? (
            <>
              <span
                style={{
                  width:       18,
                  height:      18,
                  border:      "2px solid rgba(0,0,0,0.3)",
                  borderTop:   "2px solid #000",
                  borderRadius:"50%",
                  animation:   "spin 0.7s linear infinite",
                  flexShrink:  0,
                }}
              />
              Creating Account…
            </>
          ) : (
            "Create Account"
          )}
        </button>
      </form>

      {/* Sign-in link */}
      <p style={{ marginTop: 24, color: "#555", fontSize: 14 }}>
        Already have an account?{" "}
        <Link to="/login" style={{ color: "#1DB954", fontWeight: 600 }}>
          Sign In
        </Link>
      </p>

      {/* Disclaimer */}
      <p style={{
        marginTop:  28,
        maxWidth:   440,
        color:      "#333",
        fontSize:   11,
        textAlign:  "center",
        lineHeight: 1.7,
      }}>
        ⚠️ Unauthorised access to this system is a criminal offence under the Computer
        Crime and Cyber Crime Act [Chapter 9:23] of Zimbabwe. Only ZRP officers may
        register. All registration attempts are logged.
      </p>

      {/* Keyframes injected inline for portability */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-14px); }
          to   { opacity: 1; transform: translateY(0);     }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0);   }
          25%       { transform: translateX(-4px); }
          75%       { transform: translateX(4px);  }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}