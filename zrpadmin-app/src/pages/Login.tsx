/**
 * src/pages/Login.tsx
 *
 * Simple, secure login flow:
 * 1. Firebase Auth → get ID token
 * 2. POST /api/auth/login → get access token + user metadata
 * 3. Store access token in React state (memory), NOT localStorage
 * 4. Refresh token stored in httpOnly cookie (backend-managed)
 * 5. Navigate to dashboard
 *
 * ✅ No WebSockets
 * ✅ No localStorage for tokens
 * ✅ Auto-refresh handled by api.ts interceptor
 */

import React, { useState, useRef } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import axios, { type AxiosError } from "axios";
import { auth } from "../auth/firebaseConfig";
import { useAuth } from "../context/AuthContext";
import api, { setAccessToken } from "../lib/api"; // ✅ Updated import
import "../designs/Login.css";

// ─── Validation ─────────────────────────────────────────────────────────────
const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type BannerType = "error" | "warning" | "success";

const ERROR_MAP: Record<string, { type: BannerType; title: string; message: string }> = {
  INVALID_CREDENTIAL: { type: "error", title: "Invalid Credentials", message: "Officer ID, email or password is incorrect." },
  USER_NOT_FOUND: { type: "error", title: "Not Found", message: "No account found for this email address." },
  TOO_MANY_REQUESTS: { type: "warning", title: "Account Locked", message: "Too many attempts. Wait a few minutes." },
  ACCOUNT_PENDING: { type: "warning", title: "Pending Approval", message: "Your account is awaiting administrator approval." },
  ACCOUNT_REJECTED: { type: "error", title: "Access Denied", message: "Access has been denied. Contact your commanding officer." },
  EMAIL_NOT_VERIFIED: { type: "warning", title: "Verify Email", message: "Check your inbox for the verification link." },
  COMMERCIAL_VPN_BLOCKED: { type: "error", title: "VPN Detected", message: "Disable your VPN and try again." },
  NETWORK_ERROR: { type: "error", title: "Connection Error", message: "Cannot reach servers. Check your connection." },
  SERVER_ERROR: { type: "error", title: "Server Error", message: "Unexpected server error. Try again shortly." },
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: ctxLogin } = useAuth();

  const [officerId, setOfficerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ type: BannerType; title: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);

  // Session-expired banner from redirect
  React.useEffect(() => {
    const state = location.state as { expired?: boolean } | null;
    if (state?.expired) {
      setBanner({ type: "warning", title: "Session Expired", message: "Your session expired. Please sign in again." });
      window.history.replaceState({}, "");
    }
  }, []);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!OFFICER_ID_RE.test(officerId.trim())) e.officerId = "Invalid format — expected A123456B or 9 digits";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address";
    if (!password) e.password = "Password is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (loading) return;
    setBanner(null);
    if (!validate()) return;

    setLoading(true);

    try {
      // 1️⃣ Firebase: verify password → get ID token
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const firebaseIdToken = await cred.user.getIdToken();

      // 2️⃣ Backend: verify Firebase token + lookup officer → issue BlowSafe JWTs
      const { data } = await api.post(
        "/api/auth/login",
        { officerId: officerId.trim().toUpperCase() },
        { headers: { Authorization: `Bearer ${firebaseIdToken}` } }
      );

      if (!data?.accessToken) throw new Error("No access token returned from backend");

      // 3️⃣ Store access token in MEMORY ONLY (via api.ts module)
      setAccessToken(data.accessToken);

      // 4️⃣ Update auth context with user metadata
      ctxLogin(data.user, data.accessToken);

      // 5️⃣ Navigate to dashboard
      navigate("/dashboard", { replace: true });

    } catch (err: any) {
      // Cleanup on error
      await signOut(auth).catch(() => null);

      // Map error codes to user-friendly messages
      let code = "SERVER_ERROR";
      if (err?.code?.startsWith("auth/")) {
        const map: Record<string, string> = {
          "auth/invalid-credential": "INVALID_CREDENTIAL",
          "auth/wrong-password": "INVALID_CREDENTIAL",
          "auth/user-not-found": "USER_NOT_FOUND",
          "auth/too-many-requests": "TOO_MANY_REQUESTS",
          "auth/network-request-failed": "NETWORK_ERROR",
        };
        code = map[err.code] ?? "SERVER_ERROR";
      } else if ((err as AxiosError).isAxiosError) {
        const ae = err as AxiosError<{ code?: string }>;
        if (!ae.response) code = "NETWORK_ERROR";
        else {
          const bc = ae.response.data?.code ?? "";
          if (bc.includes("PENDING")) code = "ACCOUNT_PENDING";
          else if (bc.includes("REJECT") || bc.includes("BAN")) code = "ACCOUNT_REJECTED";
          else if (bc.includes("VPN")) code = "COMMERCIAL_VPN_BLOCKED";
          else if (bc.includes("EMAIL_NOT_VERIFIED")) code = "EMAIL_NOT_VERIFIED";
          else code = bc || "SERVER_ERROR";
        }
      }

      const resolved = ERROR_MAP[code] ?? ERROR_MAP.SERVER_ERROR;
      setBanner(resolved);
      setTimeout(() => bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 40);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-header">
          <div className="login-badge">ZRP</div>
          <div>
            <h1 className="login-title">Officer Sign In</h1>
            <p className="login-subtitle">Zimbabwe Republic Police · Traffic Enforcement</p>
          </div>
        </div>

        <div ref={bannerRef}>
          {banner && (
            <div className={`login-banner ${banner.type}`}>
              <div className="login-banner-content">
                <p className="login-banner-title">{banner.title}</p>
                <p className="login-banner-msg">{banner.message}</p>
              </div>
              <button className="login-banner-close" onClick={() => setBanner(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
        </div>

        <div className="login-fields">
          <Field 
            label="Officer ID" 
            id="officerId" 
            value={officerId}
            onChange={(v) => { setOfficerId(v); setErrors((e) => ({ ...e, officerId: "" })); }}
            error={errors.officerId} 
            placeholder="A123456B" 
            hint="Format: A123456B or 9 digits"
            autoComplete="username" 
            disabled={loading} 
            onEnter={handleSubmit} 
          />
          <Field 
            label="Email Address" 
            id="email" 
            type="email" 
            value={email}
            onChange={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: "" })); }}
            error={errors.email} 
            placeholder="officer@zrp.gov.zw"
            autoComplete="email" 
            disabled={loading} 
            onEnter={handleSubmit} 
          />
          <Field 
            label="Password" 
            id="password" 
            type="password" 
            value={password}
            onChange={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: "" })); }}
            error={errors.password} 
            placeholder="Enter your password"
            autoComplete="current-password" 
            disabled={loading} 
            onEnter={handleSubmit} 
          />
        </div>

        <button className="login-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? <><span className="spinner" /> Signing In…</> : "Sign In"}
        </button>

        <div className="login-footer">
          <span className="login-footer-text">No account? </span>
          <Link to="/signup" className="login-link">Register</Link>
        </div>

        <p className="login-legal">
          ⚠ Unauthorised access is a criminal offence under the Computer Crime and Cyber Crime Act [Chapter 9:23]. All access is logged.
        </p>
      </div>
    </div>
  );
}

// ─── Field sub-component ──────────────────────────────────────────────────────
interface FieldProps {
  label: string; id: string; type?: string; value: string;
  onChange: (v: string) => void; error?: string; placeholder: string;
  hint?: string; autoComplete?: string; disabled?: boolean; onEnter?: () => void;
}

function Field({ label, id, type = "text", value, onChange, error, placeholder, hint, autoComplete, disabled, onEnter }: FieldProps) {
  const [focused, setFocused] = useState(false);
  
  return (
    <div className="field-group">
      <label htmlFor={id} className="field-label">{label}</label>
      <input 
        id={id} 
        type={type} 
        value={value} 
        placeholder={placeholder}
        autoComplete={autoComplete} 
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} 
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        className={`field-input ${error ? "error" : ""}`}
      />
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}