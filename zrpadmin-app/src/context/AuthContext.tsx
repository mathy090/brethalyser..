/**
 * src/context/AuthContext.tsx
 *
 * Auth state management:
 * - Access token stored in memory (React state), NOT localStorage
 * - Refresh token handled by httpOnly cookie (backend sets/reads)
 * - Safe logout: clear memory token + call backend to clear cookie
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

interface User {
  uid: string;
  email: string;
  officerId: string;
  role: "admin" | "officer" | "superadmin";
  status: "approved" | "pending" | "rejected" | "banned";
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User, accessToken: string) => void;
  logout: () => Promise<void>;
  refreshUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // ── Login: store user + access token in memory only ───────────────────────
  const login = useCallback((userData: User, token: string) => {
    setUser(userData);
    setAccessToken(token);
    // ✅ Access token is in React state only — not in localStorage
    // ✅ Refresh token is in httpOnly cookie — set by backend, unreadable by JS
  }, []);

  // ── Logout: clear memory + call backend to clear cookie ───────────────────
  const logout = useCallback(async () => {
    try {
      // Call backend to clear httpOnly refresh token cookie
      await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include", // ✅ Send cookie so backend can clear it
      });
    } catch (err) {
      console.warn("Logout API call failed, clearing local state anyway", err);
    } finally {
      // Clear in-memory state regardless of API result
      setUser(null);
      setAccessToken(null);
    }
  }, []);

  // ── Update user metadata (e.g., after profile edit) ───────────────────────
  const refreshUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  // ── Check if authenticated ────────────────────────────────────────────────
  const isAuthenticated = !!user && !!accessToken;

  // ── Optional: Check for expired session on mount ──────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("expired") === "1") {
      // Session expired banner handled by Login component
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}