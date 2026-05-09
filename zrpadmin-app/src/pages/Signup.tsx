import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { registerOfficer } from "../auth/authService";
import "../designs/Signup.css";

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
    if (!validate()) return;

    if (!navigator.onLine) {
      alert("No Connection\nCheck your internet and try again.");
      return;
    }

    setLoading(true);
    
    const result = await registerOfficer(officerId, email, password);
    
    setLoading(false);

    if (result.success) {
      const confirmed = window.confirm(
        "✅ Registration Successful!\n\nA verification email has been sent to " + email + ".\n\nPlease verify your email before signing in."
      );
      if (confirmed) {
        navigate("/login", { replace: true });
      }
    } else {
      alert(`❌ Registration Failed\n\n${result.error}`);
    }
  };

  return (
    <div className="signup-container">
      <h1 className="signup-title">ZRP Officer Registration</h1>

      <form onSubmit={handleRegister} className="signup-form">
        <div className="form-group">
          <input
            type="text"
            className={`input ${errors.officerId ? 'input-error' : ''}`}
            placeholder="Officer ID (e.g. A123456B)"
            value={officerId}
            onChange={(e) => {
              setOfficerId(e.target.value);
              if (errors.officerId) setErrors(prev => ({ ...prev, officerId: "" }));
            }}
            disabled={loading}
            autoCapitalize="characters"
          />
          {errors.officerId && <p className="error-text">{errors.officerId}</p>}
        </div>

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

        <div className="form-group">
          <input
            type="password"
            className={`input ${errors.confirm ? 'input-error' : ''}`}
            placeholder="Confirm Password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors(prev => ({ ...prev, confirm: "" }));
            }}
            disabled={loading}
          />
          {errors.confirm && <p className="error-text">{errors.confirm}</p>}
        </div>

        <button 
          type="submit" 
          className={`btn ${loading ? 'btn-loading' : ''}`}
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : "Register"}
        </button>
      </form>

      <p className="disclaimer">
        ⚠️ Unauthorized use is a criminal offence. Only ZRP officers may register.
      </p>
    </div>
  );
}