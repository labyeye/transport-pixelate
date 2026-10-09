import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, post, get, tokens } from "@/services/api";
const Ctx = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const accept = (d) => {
    tokens.setAccess(d.accessToken);
    tokens.setRefresh(d.refreshToken);
    setUser(d.user);
  };
  useEffect(() => {
    tokens.onExpired(() => {
      tokens.setAccess(null);
      tokens.setRefresh(null);
      setUser(null);
    });
    const rt = tokens.getRefresh();
    if (!rt) {
      setLoading(false);
      return;
    }
    // Restore the session from the refresh token.
    api("/auth/refresh", { method: "POST", body: { refreshToken: rt } })
      .then(async (r) => {
        tokens.setAccess(r.data.accessToken);
        tokens.setRefresh(r.data.refreshToken);
        setUser((await get("/auth/me")).data);
      })
      .catch(() => tokens.setRefresh(null))
      .finally(() => setLoading(false));
  }, []);
  const login = useCallback(
    async (email, password) =>
      accept((await post("/auth/login", { email, password })).data),
    [],
  );
  const register = useCallback(
    async (b) => accept((await post("/auth/register", b)).data),
    [],
  );
  const logout = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {
      /* already signed out */
    }
    tokens.setAccess(null);
    tokens.setRefresh(null);
    setUser(null);
  }, []);
  const can = useCallback((p) => !!user?.permissions.includes(p), [user]);
  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, can }}>
      {children}
    </Ctx.Provider>
  );
}
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within <AuthProvider>");
  return c;
}
