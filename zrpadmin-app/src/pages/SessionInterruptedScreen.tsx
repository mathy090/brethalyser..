import React from "react";
import { useNavigate } from "react-router-dom";

export default function SessionInterruptedScreen() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🔌</div>
        <h1
          style={{
            margin: "0 0 16px",
            fontSize: 26,
            fontWeight: 700,
            color: "#FF4C4C",
          }}
        >
          Session Interrupted
        </h1>
        <p
          style={{
            margin: "0 0 32px",
            color: "#ccc",
            fontSize: 15,
            lineHeight: 1.65,
          }}
        >
          We sincerely apologize for hitting this error. Please relogin — you
          seem to be offline or your session has expired.
        </p>
        <button
          onClick={() => navigate("/login", { replace: true })}
          style={{
            padding: "14px 32px",
            background: "#1DB954",
            color: "#000",
            border: "none",
            borderRadius: 30,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            transition: "transform 100ms",
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          Return to Login
        </button>
      </div>
    </div>
  );
}