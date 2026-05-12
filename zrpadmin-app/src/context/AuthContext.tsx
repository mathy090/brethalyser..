/**
 * src/context/AuthContext.tsx
 *
 * Auth state management for HTTP-only JWT flow:
 * • Access token: stored in React state + api.ts module (MEMORY ONLY)
 * • Refresh token: stored in httpOnly cookie (backend-managed, JS cannot read)
 * • User metadata: stored in React state (non-sensitive)
 *
 * Security principles:
 * ✅ No tokens in localStorage/sessionStorage (XSS-resistant)
 * ✅ Auto-refresh handled by api.ts interceptor (transparent to components)
 * ✅ Graceful session expiration handling
 * ✅ TypeScript-safe with proper typing
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface User {
  uid: string;
  email: string;
  officerId: string;
  role: "admin" | "officer" | "superadmin";
  status: "approved" | "pending" | "rejected" | "banned";
}

export interface AuthContextType {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login: (user: User, accessToken: string) => void;
  logout: () => Promise<void>;
  refreshUser: (updates: Partial<User>) => void;
  checkSession: () => Promise<boolean>;

  // Metadata
  lastActivityAt: number | null;
  updateLastActivity: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);

  // ── Login: store user + access token in MEMORY ONLY ───────────────────────
  const login = useCallback((userData: User, accessToken: string) => {
    // 1️⃣ Update user state
    setUser(userData);
    
    // 2️⃣ Store access token in api.ts module (memory only, not localStorage)
    // This is imported dynamically to avoid circular dependencies
    import("../lib/api").then(({ setAccessToken }) => {
      setAccessToken(accessToken);
    });
    
    // 3️⃣ Record login time for activity tracking
    setLastActivityAt(Date.now());
    
    // 4️⃣ Log for debugging (remove in production if desired)
    console.log("[Auth] ✅ Logged in:", {
      officerId: userData.officerId,
      role: userData.role,
      // Never log tokens
    });
  }, []);

  // ── Logout: clear memory + call backend to clear cookie ───────────────────
  const logout = useCallback(async () => {
    try {
      // 1️⃣ Get current access token for revocation (optional but recommended)
      const { getAccessToken } = await import("../lib/api");
      const currentToken = getAccessToken();

      // 2️⃣ Call backend to clear httpOnly refresh token cookie + revoke access token
      await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include", // ✅ Send httpOnly cookie so backend can clear it
        headers: {
          "Content-Type": "application/json",
          // ✅ Optional: send access token for immediate revocation
          ...(currentToken && { Authorization: `Bearer ${currentToken}` }),
        },
      });
    } catch (err) {
      console.warn("[Auth] ⚠️ Logout API call failed, clearing local state anyway", err);
    } finally {
      // 3️⃣ Clear in-memory state REGARDLESS of API result
      // This ensures the user is logged out locally even if backend is down
      setUser(null);
      
      // Clear access token from api.ts module
      import("../lib/api").then(({ setAccessToken }) => {
        setAccessToken(null);
      });
      
      setLastActivityAt(null);
      
      console.log("[Auth] 🔐 Logged out");
    }
  }, []);

  // ── Refresh user metadata (e.g., after profile update) ─────────────────────
  const refreshUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
  }, []);

  // ── Check if session is still valid (for app initialization) ───────────────
  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      // Try a lightweight authenticated request to verify tokens are still valid
      const { default: api } = await import("../lib/api");
      
      const response = await api.get("/api/auth/me", {
        // Don't trigger auto-refresh on this check — we just want to know status
        headers: { "X-Skip-Refresh": "true" },
      });
      
      if (response.data?.user) {
        // Session valid: update state
        setUser(response.data.user);
        setLastActivityAt(Date.now());
        return true;
      }
      
      // Session invalid
      return false;
    } catch (err) {
      // Any error means session is not valid
      console.log("[Auth] ❌ Session check failed:", err);
      return false;
    } finally {
      // Always mark loading as complete
      setIsLoading(false);
    }
  }, []);

  // ── Update last activity timestamp (for idle timeout logic) ────────────────
  const updateLastActivity = useCallback(() => {
    setLastActivityAt(Date.now());
  }, []);

  // ── Computed: is user authenticated? ───────────────────────────────────────
  const isAuthenticated = useMemo(() => {
    return !!user;
  }, [user]);

  // ── Initialize: check for existing session on mount ────────────────────────
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      if (!mounted) return;
      
      // Small delay to allow app to mount first
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      if (!mounted) return;
      
      // Check if we have a valid session
      const valid = await checkSession();
      
      if (!mounted) return;
      
      // If no valid session, ensure loading is false
      if (!valid) {
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [checkSession]);

  // ── Track user activity for idle timeout (optional enhancement) ───────────
  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    
    const handler = () => updateLastActivity();
    
    events.forEach((event) => {
      window.addEventListener(event, handler, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handler);
      });
    };
  }, [isAuthenticated, updateLastActivity]);

  // ── Context value ──────────────────────────────────────────────────────────
  const value = useMemo<AuthContextType>(
    () => ({
      // State
      user,
      isAuthenticated,
      isLoading,
      
      // Actions
      login,
      logout,
      refreshUser,
      checkSession,
      
      // Metadata
      lastActivityAt,
      updateLastActivity,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
      refreshUser,
      checkSession,
      lastActivityAt,
      updateLastActivity,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useAuth() {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error(
      "useAuth must be used within an AuthProvider. " +
      "Wrap your app with <AuthProvider> in main.tsx."
    );
  }
  
  return context;
}

// ─── Optional: Helper for protected route components ─────────────────────────
export function useRequireAuth(redirectTo = "/login") {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate(redirectTo, { replace: true, state: { from: window.location.pathname } });
    }
  }, [isAuthenticated, isLoading, navigate, redirectTo]);

  return { isAuthenticated, isLoading };
}