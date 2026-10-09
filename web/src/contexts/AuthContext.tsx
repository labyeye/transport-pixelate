import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, post, get, tokens } from "@/services/api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organization: string;
  permissions: string[];
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { organizationName: string; category: string; name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const accept = (d: { user: AuthUser; accessToken: string; refreshToken: string }) => {
    tokens.setAccess(d.accessToken);
    tokens.setRefresh(d.refreshToken);
    setUser(d.user);
  };

  useEffect(() => {
    tokens.onExpired(() => { tokens.setAccess(null); tokens.setRefresh(null); setUser(null); });
    const rt = tokens.getRefresh();
    if (!rt) { setLoading(false); return; }
    // Restore the session from the refresh token.
    api<{ accessToken: string; refreshToken: string }>("/auth/refresh", { method: "POST", body: { refreshToken: rt } })
      .then(async (r) => {
        tokens.setAccess(r.data.accessToken);
        tokens.setRefresh(r.data.refreshToken);
        setUser((await get<AuthUser>("/auth/me")).data);
      })
      .catch(() => tokens.setRefresh(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => accept((await post("/auth/login", { email, password })).data), []);
  const register = useCallback(async (b: Parameters<AuthCtx["register"]>[0]) => accept((await post("/auth/register", b)).data), []);
  const logout = useCallback(async () => {
    try { await post("/auth/logout"); } catch { /* already signed out */ }
    tokens.setAccess(null); tokens.setRefresh(null); setUser(null);
  }, []);
  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);

  return <Ctx.Provider value={{ user, loading, login, register, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within <AuthProvider>");
  return c;
}
