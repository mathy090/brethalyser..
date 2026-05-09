import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerOfficer } from "../auth/authService";
import "../designs/Signup.css";

// Validation
const validateOfficerId = (id: string) =>
  /^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(id);

const validateEmail = (e: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

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

  const [banner, setBanner] = useState<{
    message: string;
    type: "success" | "error" | "warning";
  } | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};

    if (!validateOfficerId(officerId))
      e.officerId = "Invalid Officer ID (e.g. A123456B)";

    if (!validateEmail(email))
      e.email = "Invalid email address";

    if (!validatePassword(password))
      e.password = "Min 8 chars, 1 uppercase, 1 special character";

    if (password !== confirm)
      e.confirm = "Passwords do not match";

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setErrors({});

    if (!validate()) return;

    setLoading(true);

    const result = await registerOfficer(
      officerId,
      email,
      password
    );

    setLoading(false);

    // =========================
    // SUCCESS
    // =========================
    if (result.success) {
      setBanner({
        message:
          "✅ Account created!\n\nCheck your email for verification link.\nThen wait for admin approval (24–48h).",
        type: "success",
      });

      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 8000);

      return;
    }

    // =========================
    // ERROR HANDLING (FIXED)
    // =========================
    const code = result.code;
    const message = result.error;

    switch (code) {
      case "OFFICER_ID_EXISTS":
        setBanner({
          message:
            "🚫 Account already in use. Please use your correct officer ID.",
          type: "error",
        });

        setErrors({ officerId: message || "Officer ID already exists" });
        break;

      case "EMAIL_EXISTS":
        setBanner({
          message:
            "📧 Email already registered. Please sign in.",
          type: "warning",
        });

        setErrors({ email: "Email already registered" });
        break;

      case "WEAK_PASSWORD":
        setErrors({
          password:
            "Password is too weak (8+ chars, 1 uppercase, 1 special character)",
        });
        break;

      case "INVALID_EMAIL":
        setErrors({
          email: "Invalid email format",
        });
        break;

      case "COMMERCIAL_VPN_BLOCKED":
        setBanner({
          message:
            "🔐 VPN detected. Please disable VPN and try again.",
          type: "warning",
        });
        break;

      case "VALIDATION_ERROR":
        setBanner({
          message: message || "Validation error",
          type: "error",
        });
        break;

      case "INTERNAL_ERROR":
        setBanner({
          message:
            "🌐 Server error. Please try again later.",
          type: "error",
        });
        break;

      default:
        setBanner({
          message:
            message || "❌ Registration failed. Try again.",
          type: "error",
        });
    }
  };

  const clearBannerOnEdit = () => {
    if (banner) setBanner(null);
  };

  return (
    <div className="signup-container">

      {/* Banner */}
      {banner && (
        <div className={`banner banner-${banner.type}`}>
          <p className="banner-text">{banner.message}</p>

          {banner.type === "success" && (
            <button
              className="banner-btn"
              onClick={() => navigate("/login")}
            >
              → Go to Login
            </button>
          )}

          <button
            className="banner-close"
            onClick={() => setBanner(null)}
          >
            ✕
          </button>
        </div>
      )}

      <h1 className="signup-title">
        ZRP Officer Registration
      </h1>

      <form onSubmit={handleRegister} className="signup-form">

        {/* Officer ID */}
        <div className="form-group">
          <input
            className={`input ${errors.officerId ? "input-error" : ""}`}
            placeholder="Officer ID (e.g. A123456B)"
            value={officerId}
            onChange={(e) => {
              setOfficerId(e.target.value);
              clearBannerOnEdit();
            }}
          />
          {errors.officerId && (
            <p className="error-text">{errors.officerId}</p>
          )}
        </div>

        {/* Email */}
        <div className="form-group">
          <input
            className={`input ${errors.email ? "input-error" : ""}`}
            placeholder="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearBannerOnEdit();
            }}
          />
          {errors.email && (
            <p className="error-text">{errors.email}</p>
          )}
        </div>

        {/* Password */}
        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.password ? "input-error" : ""}`}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearBannerOnEdit();
            }}
          />
          {errors.password && (
            <p className="error-text">{errors.password}</p>
          )}
        </div>

        {/* Confirm */}
        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.confirm ? "input-error" : ""}`}
            placeholder="Confirm Password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clearBannerOnEdit();
            }}
          />
          {errors.confirm && (
            <p className="error-text">{errors.confirm}</p>
          )}
        </div>

        {/* Button */}
        <button
          type="submit"
          className={`btn ${loading ? "btn-loading" : ""}`}
          disabled={loading}
        >
          {loading ? "Creating..." : "Register"}
        </button>
      </form>

      <p className="disclaimer">
        ⚠️ Unauthorized access is prohibited.
      </p>
    </div>
  );
}