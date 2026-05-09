import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { loginOfficer } from "../auth/authService"; // ← Same API call
import { useOfficer } from "../context/OfficerContext"; // ← Same context
import "../designs/Login.css"; // ← CSS for styling and animations

// ===== Same Validation Logic (Copy-Paste from RN) =====
const validateOfficerId = (id: string) => /^[A-Z]{1}\d{6}[A-Z]{1}$|^\d{9}$/i.test(id);
const validateEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/.test(e);

export default function Login() {
  const navigate = useNavigate(); // ← Web navigation
  const { setOfficer } = useOfficer();
  
  const [officerId, setOfficerId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // ===== Banner System (CSS Animations instead of RN Animated) =====
  const [banner, setBanner] = useState<{ message: string; type: "error" | "warning" | "success" } | null>(null);
  const bannerTimeout = useRef<NodeJS.Timeout | null>(null);

  const showBanner = (message: string, type: "error" | "warning" | "success" = "error", duration = 3500) => {
    if (bannerTimeout.current) clearTimeout(bannerTimeout.current);
    setBanner({ message, type });
    
    bannerTimeout.current = setTimeout(() => {
      setBanner(null);
    }, duration);
  };

  // Auto-show success message from navigation state (like RN route.params)
  useEffect(() => {
    const state = history.state;
    if (state?.message) {
      showBanner(state.message, "success", 4000);
      // Clear after showing
      window.history.replaceState({}, document.title);
    }
    return () => {
      if (bannerTimeout.current) clearTimeout(bannerTimeout.current);
    };
  }, []);

  // ===== Same Validation Function =====
  const validate = () => {
    const e: Record<string, string> = {};
    if (!validateOfficerId(officerId)) e.officerId = "Invalid Officer ID";
    if (!validateEmail(email)) e.email = "Invalid email";
    if (!password) e.password = "Password required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ===== Same Login Handler (Identical API Flow) =====
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    // ← Same API endpoint call
    const result = await loginOfficer(
      officerId, 
      email.trim().toLowerCase(), 
      password
    );
    
    setLoading(false);

    if (result.success) {
      if (result.status === "rejected") {
        showBanner("Account banned. Contact admin.", "warning");
        return;
      }

      // ← Same context update
      await setOfficer({ 
        uid: result.uid, 
        officerId: result.officerId, 
        role: result.role as any, 
        status: result.status as any 
      });
      
      // ← Web navigation (replaces navigation.replace)
      navigate("/dashboard", { replace: true });
    } else {
      // Same error handling logic
      const msg = result.error.toLowerCase().includes("network") || 
                  result.error.toLowerCase().includes("connection")
        ? "Poor internet. Couldn't login."
        : result.error;
      showBanner(msg, "error");
    }
  };

  return (
    <div className="login-container">
      {/* Animated Banner */}
      {banner && (
        <div className={`banner banner-${banner.type} banner-enter`}>
          <p className="banner-text">{banner.message}</p>
        </div>
      )}

      <h1 className="login-title">Official Sign In</h1>

      <form onSubmit={handleLogin} className="login-form">
        {/* Officer ID */}
        <div className="form-group">
          <input
            type="text"
            className={`input ${errors.officerId ? 'input-error' : ''}`}
            placeholder="Officer ID"
            value={officerId}
            onChange={(e) => {
              setOfficerId(e.target.value);
              if (errors.officerId) setErrors(prev => ({ ...prev, officerId: "" }));
            }}
            disabled={loading}
            autoCapitalize="characters"
            pattern="[A-Za-z0-9]+"
          />
          {errors.officerId && <p className="error-text">{errors.officerId}</p>}
        </div>

        {/* Email */}
        <div className="form-group">
          <input
            type="email"
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="Email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors(prev => ({ ...prev, email: "" }));
            }}
            disabled={loading}
            autoCapitalize="none"
          />
          {errors.email && <p className="error-text">{errors.email}</p>}
        </div>

        {/* Password */}
        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.password ? 'input-error' : ''}`}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors(prev => ({ ...prev, password: "" }));
            }}
            disabled={loading}
          />
          {errors.password && <p className="error-text">{errors.password}</p>}
        </div>

        {/* Submit Button */}
        <button 
          type="submit" 
          className={`btn ${loading ? 'btn-loading' : ''}`}
          disabled={loading}
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            "Sign In"
          )}
        </button>
      </form>

      {/* Forgot Password */}
      <button 
        type="button"
        className="forgot-btn"
        onClick={() => navigate("/forgot-password", { 
          state: { officerId, email } // Pass data like RN route.params
        })}
        disabled={loading}
      >
        Forgot Password?
      </button>
    </div>
  );
}