import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, api, loadBaseUrl, restoreSession, setSignedOutHandler, signIn, signOut } from '../lib/api';
import { secure, store } from '../lib/storage';
import { resetForTests as clearQueue } from '../lib/queue';
import * as tracking from '../lib/tracking';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineRestore, setOfflineRestore] = useState(false);

  const clearLocal = useCallback(async () => {
    await store.remove('cachedUser');
    await store.remove('cachedTrips');
    await store.remove('cachedMe');
    await store.remove('pingBuffer');
    await clearQueue();
    setUser(null);
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => { tracking.stop().catch(() => {}); clearLocal(); });
    (async () => {
      await loadBaseUrl();
      try {
        const u = await restoreSession();
        if (u) { await store.set('cachedUser', u); setUser(u); }
      } catch (e) {
        // Offline at launch: stay signed in using the last known profile so a driver can still work.
        if (e instanceof ApiError && e.network) {
          const cached = await store.get('cachedUser');
          const tokens = await secure.getTokens();
          if (cached && tokens) { setUser(cached); setOfflineRestore(true); }
        }
      }
      setLoading(false);
    })();
  }, [clearLocal]);

  const login = useCallback(async (email, password) => {
    const u = await signIn(email.trim(), password);
    await store.set('cachedUser', u);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await tracking.stop().catch(() => {});
    await signOut();
    await clearLocal();
  }, [clearLocal]);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    await store.set('cachedUser', res.data);
    setUser(res.data);
  }, []);

  const can = useCallback(p => !!user?.permissions?.includes(p), [user]);

  return <Ctx.Provider value={{ user, loading, offlineRestore, login, logout, refreshUser, can }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
