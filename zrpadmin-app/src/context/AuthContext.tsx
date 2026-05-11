import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthUser {
  token: string;
  officerId: string;
  uid: string;
  role: string;
  status: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = 'blowsafe_session';

function loadFromStorage(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser & { expiresAt: number };
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(loadFromStorage);

  const login = (incoming: AuthUser) => {
    const withExpiry = { ...incoming, expiresAt: Date.now() + 5 * 60 * 1000 };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(withExpiry));
    setUser(incoming);
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  // Auto-expire check every 30s
  useEffect(() => {
    const id = setInterval(() => {
      const stored = loadFromStorage();
      if (!stored && user) {
        setUser(null);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};