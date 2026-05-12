/**
 * src/main.tsx
 *
 * Application entry point with intelligent splash screen:
 * • Shows "Setting you up, Officer" during auth init
 * • Detects offline status instantly → "Please connect to the internet"
 * • Falls back to "Please check your internet connection…" after 10s
 * • Smooth fade-out when app is ready
 * • ErrorBoundary for graceful failure handling
 */

import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// ─── Providers ──────────────────────────────────────────────────────────────
import { AuthProvider, useAuth } from "./context/AuthContext";
import { OfficerProvider } from "./context/OfficerContext";

// ─── Global Styles ──────────────────────────────────────────────────────────
import "./index.css";

// ─── Main App Component ─────────────────────────────────────────────────────
import App from "./App.tsx";

// ─── Officer Splash Screen Component ────────────────────────────────────────
interface OfficerSplashProps {
  isOnline: boolean;
  isSlowLoading: boolean;
}

function OfficerSplash({ isOnline, isSlowLoading }: OfficerSplashProps) {
  const getMessage = () => {
    if (!isOnline) return "Please connect to the internet";
    if (isSlowLoading) return "Please check your internet connection…";
    return "Verifying credentials and establishing secure channel…";
  };

  const hint = getMessage();
  const isWarning = !isOnline || isSlowLoading;

  return (
    <div className="officer-splash" role="status" aria-live="polite">
      <div className="officer-splash-content">
        {/* ZRP Badge */}
        <div className="officer-splash-badge" aria-hidden="true">
          <span className="officer-splash-badge-text">ZRP</span>
        </div>

        {/* Title & Subtitle */}
        <h1 className="officer-splash-title">Setting you up, Officer</h1>
        <p className="officer-splash-subtitle">Zimbabwe Republic Police · Traffic Enforcement</p>

        {/* Loading Spinner or Offline Icon */}
        {isOnline ? (
          <div className="officer-splash-spinner" aria-hidden="true" />
        ) : (
          <div className="officer-splash-icon-offline" aria-hidden="true">🌐</div>
        )}

        {/* Status Hint */}
        <p className={`officer-splash-hint ${isWarning ? "warning" : ""}`}>
          {isWarning ? "⚠️ " : ""}{hint}
        </p>
      </div>

      {/* Inline Styles */}
      <style>{`
        .officer-splash {
          position: fixed;
          inset: 0;
          background: #0a0a0a;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          font-family: 'DM Mono', 'Courier New', monospace;
          transition: opacity 0.4s ease-out, visibility 0.4s;
        }

        .officer-splash.fade-out {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        .officer-splash-content {
          text-align: center;
          padding: 2rem;
          max-width: 400px;
          animation: officerFadeIn 0.4s ease-out;
        }

        .officer-splash-badge {
          width: 72px;
          height: 72px;
          background: #1DB954;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          box-shadow: 0 6px 24px rgba(29, 185, 84, 0.5);
          border: 2px solid rgba(29, 185, 84, 0.3);
        }

        .officer-splash-badge-text {
          color: #000;
          font-weight: 900;
          font-size: 18px;
          letter-spacing: 3px;
        }

        .officer-splash-title {
          margin: 0 0 0.75rem;
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.3px;
          line-height: 1.3;
        }

        .officer-splash-subtitle {
          margin: 0 0 2rem;
          font-size: 13px;
          color: #555;
          letter-spacing: 0.5px;
        }

        .officer-splash-spinner {
          width: 52px;
          height: 52px;
          border: 3px solid rgba(29, 185, 84, 0.25);
          border-top-color: #1DB954;
          border-radius: 50%;
          margin: 0 auto 1.75rem;
          animation: officerSpin 1s linear infinite;
        }

        .officer-splash-icon-offline {
          font-size: 48px;
          margin: 0 auto 1.75rem;
          filter: grayscale(0.3);
          animation: officerPulse 2s ease-in-out infinite;
        }

        .officer-splash-hint {
          margin: 0;
          font-size: 11px;
          color: #3a3a3a;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          transition: color 0.2s;
        }

        .officer-splash-hint.warning {
          color: #FFA500;
          font-weight: 600;
        }

        @keyframes officerSpin {
          to { transform: rotate(360deg); }
        }

        @keyframes officerPulse {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }

        @keyframes officerFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Reduced motion preference */
        @media (prefers-reduced-motion: reduce) {
          .officer-splash-spinner,
          .officer-splash-icon-offline,
          .officer-splash-content {
            animation: none !important;
          }
          .officer-splash.fade-out {
            transition: none !important;
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

// ─── App Wrapper with Splash Control ────────────────────────────────────────
function AppWithSplash() {
  const { isLoading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSlowLoading, setIsSlowLoading] = useState(false);

  // Track network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 10-second slow loading fallback
  useEffect(() => {
    if (!isLoading) {
      setIsSlowLoading(false);
      return;
    }
    
    const timer = setTimeout(() => {
      setIsSlowLoading(true);
    }, 10_000);
    
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Hide splash when auth is ready
  useEffect(() => {
    if (!isLoading && showSplash) {
      const splashEl = document.querySelector(".officer-splash");
      if (splashEl) {
        splashEl.classList.add("fade-out");
        setTimeout(() => setShowSplash(false), 400); // Match CSS transition
      } else {
        setShowSplash(false);
      }
    }
  }, [isLoading, showSplash]);

  return (
    <>
      {showSplash && <OfficerSplash isOnline={isOnline} isSlowLoading={isSlowLoading} />}
      <App />
    </>
  );
}

// ─── Error Boundary ─────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[App Error]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <div className="error-fallback-badge" aria-hidden="true">⚠️</div>
          <h1 className="error-fallback-title">System Alert</h1>
          <p className="error-fallback-message">
            An unexpected error occurred. Please refresh the page or contact your commanding officer.
          </p>
          <button onClick={() => window.location.reload()} className="error-fallback-button">
            Reload Page
          </button>
          {import.meta.env.DEV && this.state.error && (
            <details className="error-fallback-details">
              <summary>Technical Details (Dev Only)</summary>
              <pre>{this.state.error.toString()}</pre>
            </details>
          )}
          <style>{`
            .error-fallback {
              min-height: 100vh; background: #0a0a0a; display: flex; flex-direction: column;
              align-items: center; justify-content: center; padding: 2rem; text-align: center;
              font-family: 'DM Mono', 'Courier New', monospace; color: #fff;
            }
            .error-fallback-badge { font-size: 48px; margin-bottom: 1rem; }
            .error-fallback-title { margin: 0 0 1rem; font-size: 22px; font-weight: 700; color: #FF4C4C; }
            .error-fallback-message { margin: 0 0 2rem; color: #888; font-size: 14px; line-height: 1.6; max-width: 400px; }
            .error-fallback-button {
              padding: 0.75rem 1.75rem; background: #1DB954; color: #000; border: none;
              border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; transition: opacity 0.15s;
            }
            .error-fallback-button:hover { opacity: 0.95; }
            .error-fallback-details {
              margin-top: 2rem; padding: 1rem; background: #111; border-radius: 8px;
              border: 1px solid #222; max-width: 500px; text-align: left; font-size: 11px; color: #666;
            }
            .error-fallback-details summary { cursor: pointer; color: #1DB954; margin-bottom: 0.5rem; }
            .error-fallback-details pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #ff6b6b; }
          `}</style>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Root Render ────────────────────────────────────────────────────────────
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find the root element. Check your HTML.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <OfficerProvider>
            <AppWithSplash />
          </OfficerProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);