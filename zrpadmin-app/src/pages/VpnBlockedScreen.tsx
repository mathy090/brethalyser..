/**
 * zrpadmin-app/src/pages/VpnBlockedScreen.tsx
 *
 * Shown when the backend returns a VPN/proxy block (403 COMMERCIAL_VPN_BLOCKED).
 * User must disconnect VPN and try again.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function VpnBlockedScreen() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleRetry = () => {
    setChecking(true);
    // Brief delay to feel like a check, then send back to login
    setTimeout(() => {
      setChecking(false);
      navigate("/login", { replace: true });
    }, 1500);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#111",
          borderRadius: 14,
          border: "1px solid #2a0a0a",
          padding: "40px 28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          boxShadow: "0 8px 40px rgba(255,76,76,0.08)",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(255,76,76,0.1)",
            border: "1px solid rgba(255,76,76,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
          }}
        >
          🚫
        </div>

        {/* Title */}
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "#fff",
            textAlign: "center",
            letterSpacing: "-0.3px",
          }}
        >
          VPN Detected
        </h1>

        {/* Body */}
        <p
          style={{
            margin: 0,
            color: "#888",
            fontSize: 14,
            lineHeight: 1.7,
            textAlign: "center",
            maxWidth: 360,
          }}
        >
          It looks like you are connected to a <strong style={{ color: "#FF4C4C" }}>VPN or proxy</strong>.
          {" "}For security reasons, this system does not allow access through VPN or
          proxy connections.
        </p>

        {/* Step list */}
        <div
          style={{
            width: "100%",
            background: "#1a1a1a",
            borderRadius: 10,
            padding: "16px 20px",
            border: "1px solid #2a2a2a",
          }}
        >
          <p
            style={{
              margin: "0 0 12px",
              color: "#666",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            To continue:
          </p>
          {[
            "Disconnect from your VPN or proxy",
            "Ensure you are on a direct network connection",
            "Press 'Try Again' below",
          ].map((step, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: i < 2 ? 10 : 0,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(29,185,84,0.15)",
                  border: "1px solid rgba(29,185,84,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "#1DB954",
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: "#ccc", fontSize: 13, lineHeight: 1.5 }}>
                {step}
              </span>
            </div>
          ))}
        </div>

        {/* Warning */}
        <div
          style={{
            width: "100%",
            background: "rgba(255,76,76,0.06)",
            borderLeft: "3px solid #FF4C4C",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "#FF4C4C",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            ⚠️ All access attempts are logged. Attempting to bypass this
            security measure may result in your account being suspended.
          </p>
        </div>

        {/* Retry button */}
        <button
          onClick={handleRetry}
          disabled={checking}
          style={{
            width: "100%",
            padding: "14px",
            background: checking ? "#155c30" : "#1DB954",
            color: "#000",
            border: "none",
            borderRadius: 30,
            fontSize: 15,
            fontWeight: 700,
            cursor: checking ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "background 200ms",
          }}
        >
          {checking ? (
            <>
              <span
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(0,0,0,0.3)",
                  borderTop: "2px solid #000",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                }}
              />
              Checking Connection…
            </>
          ) : (
            "Try Again"
          )}
        </button>
      </div>

      <p
        style={{
          marginTop: 24,
          color: "#333",
          fontSize: 11,
          textAlign: "center",
          lineHeight: 1.7,
          maxWidth: 400,
        }}
      >
        If you believe this is a mistake, contact your system administrator with
        your network details.
      </p>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}