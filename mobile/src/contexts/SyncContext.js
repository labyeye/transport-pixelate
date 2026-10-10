import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { request } from '../lib/api';
import { counts, flush, subscribe } from '../lib/queue';
import { uploadNow } from '../lib/tracking';

const Ctx = createContext(null);

// Tracks connectivity and replays queued actions whenever the connection comes back.
export function SyncProvider({ children }) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState({ pending: 0, failed: 0 });
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      await flush(item => request(item.path, { method: item.method ?? 'POST', body: item.body }));
      await uploadNow().catch(() => {});
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    counts().then(setQueue);
    const off = subscribe(setQueue);
    const unsub = NetInfo.addEventListener(state => {
      const up = !!state.isConnected && state.isInternetReachable !== false;
      setOnline(up);
      if (up) sync();
    });
    return () => { off(); unsub(); };
  }, [sync]);

  return <Ctx.Provider value={{ online, queue, syncing, sync }}>{children}</Ctx.Provider>;
}
export const useSync = () => useContext(Ctx);
