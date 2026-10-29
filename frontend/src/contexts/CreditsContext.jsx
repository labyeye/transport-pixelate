import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { get } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

const Ctx = createContext({ credits: null, refresh: async () => {} });

// Only the people who manage the plan (owner / admin: settings:write) see or fetch the wallet.
export function CreditsProvider({ children }) {
  const { user, can } = useAuth();
  const [credits, setCredits] = useState(null);
  const enabled = !!user && can("settings:write");

  const refresh = useCallback(async () => {
    if (!enabled) return setCredits(null);
    try {
      setCredits((await get("/credits/balance")).data);
    } catch {
      // header just stays without the pill; nothing else depends on it
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return;
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return <Ctx.Provider value={{ credits, refresh }}>{children}</Ctx.Provider>;
}

export const useCredits = () => useContext(Ctx);

/** 3203 -> "3,203", 0.4 -> "0.4" */
export const fmtCredits = (n = 0) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
