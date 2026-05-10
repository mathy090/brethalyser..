/**
 * src/components/SessionGuard.tsx
 *
 * Wraps protected routes. Every minute it checks whether the JWT stored in
 * localStorage is older than 5 minutes. If so it clears the session and
 * redirects to /login?expired=1 so the Login page can show the friendly
 * "Sorry, your session has expired" banner.
 *
 * Also re-checks on window focus (tab switch back) so the user sees the
 * message immediately rather than waiting for the next tick.
 *
 * Usage: wrap your protected <Route> elements with this component in App.tsx.
 *
 *   <Route element={<SessionGuard />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 */

import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../auth/firebaseConfig";

// JWT lifetime in milliseconds — must match the backend's 5-minute expiry
const JWT_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes

// How often we poll (every 30 seconds is fine — lightweight)
const POLL_INTERVAL_MS = 30_000;

function clearSession() {
  localStorage.removeItem("jwt_token");
  localStorage.removeItem("officer_id");
  localStorage.removeItem("user_uid");
  localStorage.removeItem("jwt_issued");
  localStorage.removeItem("officer");
  signOut(auth).catch(() => null);
}

function isSessionExpired(): boolean {
  const token   = localStorage.getItem("jwt_token");
  const issued  = localStorage.getItem("jwt_issued");

  // No token at all — treat as expired/unauthenticated
  if (!token || !issued) return true;

  const issuedAt = parseInt(issued, 10);
  if (isNaN(issuedAt)) return true;

  return Date.now() - issuedAt > JWT_LIFETIME_MS;
}

export default function SessionGuard() {
  const navigate    = useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function checkAndRedirect() {
    if (isSessionExpired()) {
      clearSession();
      navigate("/login?expired=1", { replace: true });
    }
  }

  useEffect(() => {
    // Immediate check on mount
    checkAndRedirect();

    // Periodic poll
    intervalRef.current = setInterval(checkAndRedirect, POLL_INTERVAL_MS);

    // Re-check when the user switches back to this tab
    window.addEventListener("focus", checkAndRedirect);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", checkAndRedirect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Outlet />;
}