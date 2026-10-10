import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Loads `path` (with optional params), exposes loading / refreshing / error and a refresh(),
 * and re-fetches on an interval. Network errors are reported as a friendly message, never thrown.
 */
export function useApi(path, params, { interval = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const key = JSON.stringify(params ?? {});

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await api.get(path, params);
      if (!alive.current) return;
      setData(res.data);
      setMeta({ ...(res.meta ?? {}), ...Object.fromEntries(Object.entries(res).filter(([k]) => !['data', 'meta', 'success'].includes(k))) });
      setError(null);
    } catch (e) {
      if (alive.current) setError(e.status === 0 ? "Can't reach the server. Pull down to retry." : e.message);
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!interval) return undefined;
    const t = setInterval(load, interval);
    return () => clearInterval(t);
  }, [interval, load]);

  const refresh = useCallback(async () => { setRefreshing(true); await load(); }, [load]);
  return { data, meta, error, loading, refreshing, refresh, reload: load };
}
