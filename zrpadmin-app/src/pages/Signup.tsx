import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerOfficer } from "../auth/authService";
import "../designs/Signup.css";

// Client-side validation (same as backend for instant feedback)
const validateOfficerId = (id: string) => /^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(id);
const validateEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/.test(e);
const validatePassword = (pw: string) =>
  pw.length >= 8 && /[A-Z]/.test(pw) && /[!@#$%^&*]/.test(pw);

export default function Signup() {
  const navigate = useNavigate();
  
  const [officerId, setOfficerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ message: string; type: "success" | "error" | "warning" } | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!validateOfficerId(officerId)) e.officerId = "Invalid Officer ID (e.g. A123456B)";
    if (!validateEmail(email)) e.email = "Invalid email address";
    if (!validatePassword(password)) e.password = "Min 8 chars, 1 uppercase, 1 special character";
    if (password !== confirm) e.confirm = "Passwords do not match";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setErrors({});
    
    if (!validate()) return;

    if (!navigator.onLine) {
      setBanner({ message: "No internet connection. Please check your network and try again.", type: "error" });
      return;
    }

    setLoading(true);
    
    // Debug: log what we're sending
    console.log("📤 Sending registration:", { 
      officerId: officerId.toUpperCase().trim(), 
      email: email.toLowerCase().trim(),
      password: "***" 
    });
    
    const result = await registerOfficer(officerId, email, password);
    
    // Debug: log what we received
    console.log("📥 Registration response:", result);
    
    setLoading(false);

    if (result.success) {
      // ✅ Success: Show nice banner with clear next steps
      setBanner({
        message: "✅ Account created!\n\n1. Check your email (including spam folder) for the verification link.\n2. Click the link to verify your email.\n3. Your account is pending admin approval (24-48 hours).\n\nYou'll receive an email once your account is activated.",
        type: "success"
      });
      // Auto-redirect after 8 seconds if user doesn't click
      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 8000);
    } else {
      // ❌ Handle specific backend error codes/messages
      const error = result.error?.toLowerCase() || "";
      const code = result.code;
      const field = result.field;

      // 🔥 SPECIFIC: Officer ID already exists in MongoDB (THE CRITICAL CASE)
      if (
        code === "OFFICER_ID_ALREADY_EXISTS" || 
        error === "user account already in use, use your actual id officer" ||
        (field === "officerId" && error.includes("already"))
      ) {
        setBanner({
          message: "🚫 User account already in use, use your actual ID officer",
          type: "error"
        });
        // Focus the officerId field for correction
        const input = document.querySelector('input[placeholder="Officer ID (e.g. A123456B)"]') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        }
      }
      // 📧 Email already exists
      else if (code === "EMAIL_ALREADY_EXISTS" || error.includes("email already registered")) {
        const statusMsg = result.status 
          ? (result.status === "approved" || result.status === "active"
              ? "Email already registered and approved. Please sign in."
              : `Email already registered. Status: ${result.status.toUpperCase()}`)
          : "Email already registered. Please sign in.";
        setBanner({
          message: `⚠️ ${statusMsg}`,
          type: "warning"
        });
      }
      // 🔐 VPN/Proxy blocked by middleware
      else if (code === "COMMERCIAL_VPN_BLOCKED" || error.includes("vpn") || error.includes("proxy")) {
        setBanner({
          message: "🔐 VPN/Proxy detected\n\nCommercial VPN and proxy connections are not permitted for security reasons.\n\nPlease disconnect your VPN and try again. If you believe this is an error, contact support.",
          type: "warning"
        });
      }
      // 🔐 Firebase-specific errors
      else if (code === "FIREBASE_EMAIL_EXISTS" || error.includes("email already registered in firebase")) {
        setBanner({
          message: "⚠️ Email already registered in Firebase. Please sign in or use a different email.",
          type: "warning"
        });
      }
      // Field-specific validation errors from backend
      else if (field === "email" && error.includes("invalid")) {
        setErrors({ email: "Invalid email address. Please check the format." });
      }
      else if (field === "password" && (error.includes("weak") || error.includes("password"))) {
        setErrors({ password: "Password is too weak. Use 8+ chars, 1 uppercase, 1 special character." });
      }
      // 🌐 Network/Server errors
      else if (error.includes("network") || error.includes("timeout") || error.includes("failed to fetch") || error.includes("internal")) {
        setBanner({
          message: "🌐 Connection error\n\nCould not reach the server. Please check your internet and try again.",
          type: "error"
        });
      }
      // ❌ Generic fallback
      else {
        setBanner({ 
          message: `❌ ${result.error || "Registration failed. Please try again."}`, 
          type: "error" 
        });
      }
    }
  };

  // Helper: clear banner when user edits a field
  const clearBannerOnEdit = () => { if (banner) setBanner(null); };

  return (
    <div className="signup-container">
      {/* Banner for success/error messages */}
      {banner && (
        <div className={`banner banner-${banner.type}`}>
          <p className="banner-text">{banner.message}</p>
          {(banner.type === "success" || banner.message.toLowerCase().includes("sign in")) && (
            <button className="banner-btn" onClick={() => navigate("/login", { replace: true })}>
              → Go to Sign In
            </button>
          )}
          <button className="banner-close" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <h1 className="signup-title">ZRP Officer Registration</h1>

      <form onSubmit={handleRegister} className="signup-form">
        {/* Officer ID Field */}
        <div className="form-group">
          <input
            type="text"
            className={`input ${errors.officerId ? 'input-error' : ''}`}
            placeholder="Officer ID (e.g. A123456B)"
            value={officerId}
            onChange={(e) => { 
              setOfficerId(e.target.value); 
              if (errors.officerId) setErrors(p => ({ ...p, officerId: "" })); 
              clearBannerOnEdit(); 
            }}
            disabled={loading || banner?.type === "success"}
            autoCapitalize="characters"
            autoComplete="off"
            aria-describedby={errors.officerId ? "officerId-error" : undefined}
          />
          {errors.officerId && <p className="error-text" id="officerId-error">{errors.officerId}</p>}
        </div>

        {/* Email Field */}
        <div className="form-group">
          <input
            type="email"
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="Email"
            value={email}
            onChange={(e) => { 
              setEmail(e.target.value); 
              if (errors.email) setErrors(p => ({ ...p, email: "" })); 
              clearBannerOnEdit(); 
            }}
            disabled={loading || banner?.type === "success"}
            autoCapitalize="none"
            autoComplete="email"
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && <p className="error-text" id="email-error">{errors.email}</p>}
        </div>

        {/* Password Field */}
        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.password ? 'input-error' : ''}`}
            placeholder="Password"
            value={password}
            onChange={(e) => { 
              setPassword(e.target.value); 
              if (errors.password) setErrors(p => ({ ...p, password: "" })); 
              clearBannerOnEdit(); 
            }}
            disabled={loading || banner?.type === "success"}
            autoComplete="new-password"
            aria-describedby={errors.password ? "password-error" : undefined}
          />
          {errors.password && <p className="error-text" id="password-error">{errors.password}</p>}
        </div>

        {/* Confirm Password Field */}
        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.confirm ? 'input-error' : ''}`}
            placeholder="Confirm Password"
            value={confirm}
            onChange={(e) => { 
              setConfirm(e.target.value); 
              if (errors.confirm) setErrors(p => ({ ...p, confirm: "" })); 
              clearBannerOnEdit(); 
            }}
            disabled={loading || banner?.type === "success"}
            autoComplete="new-password"
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
          />
          {errors.confirm && <p className="error-text" id="confirm-error">{errors.confirm}</p>}
        </div>

        {/* Submit Button */}
        <button 
          type="submit" 
          className={`btn ${loading ? 'btn-loading' : ''}`}
          disabled={loading || banner?.type === "success"}
          aria-busy={loading}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : "Register"}
        </button>
      </form>

      {/* Disclaimer */}
      <p className="disclaimer">
        ⚠️ Unauthorized use is a criminal offence. Only ZRP officers may register.
      </p>
    </div>
  );
}