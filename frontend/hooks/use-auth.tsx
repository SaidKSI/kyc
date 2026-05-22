"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type AuthUser,
  apiLogin,
  apiLogout,
  clearAuth,
  getStoredAuth,
  storeAuth,
} from "@/lib/auth";

interface AuthContext {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setUser(getStoredAuth());
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const auth = await apiLogin(email, password);
    storeAuth(auth);
    setUser(auth);
  }, []);

  const logout = useCallback(async () => {
    if (user) await apiLogout(user.access_token);
    clearAuth();
    setUser(null);
  }, [user]);

  return (
    <AuthCtx.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
