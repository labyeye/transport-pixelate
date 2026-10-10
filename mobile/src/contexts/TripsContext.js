import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { enqueue, makeId } from '../lib/queue';
import { store } from '../lib/storage';
import * as tracking from '../lib/tracking';
import { sortTrips } from '../lib/tripRules';
import { POLL_TRIPS_MS } from '../config';
import { useSync } from './SyncContext';

const Ctx = createContext(null);

export class OfflineError extends Error {
  constructor(message) { super(message); this.offline = true; }
}

export function TripsProvider({ children }) {
  const { online, sync } = useSync();
  const [me, setMe] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false); // showing cached data because we couldn't reach the server
  const [error, setError] = useState(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([api.get('/driver/me'), api.get('/driver/trips')]);
      setMe(m.data);
      const sorted = sortTrips(t.data);
      setTrips(sorted);
      setStale(false);
      setError(null);
      await store.set('cachedMe', m.data);
      await store.set('cachedTrips', sorted);
      // Resume location sharing if the app was restarted mid-trip.
      const live = sorted.find(x => ['in_progress', 'delayed'].includes(x.status) && x.myRole === 'driver');
      if (live && tracking.getState().status === 'off') tracking.start({ tripNumber: live.tripNumber });
      if (!live && tracking.getState().status === 'on') tracking.stop();
    } catch (e) {
      if (e.network || e.status === 0) {
        if (!loaded.current) {
          setMe(await store.get('cachedMe'));
          setTrips((await store.get('cachedTrips', [])) ?? []);
        }
        setStale(true);
      } else setError(e.message);
    } finally {
      loaded.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_TRIPS_MS); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (online) refresh(); }, [online, refresh]);

  // Trip-state changes need the server's say-so (vehicle availability, time window), so they are never queued.
  const act = useCallback(async (trip, what, body) => {
    if (!online) {
      const what_ = what === 'ready' ? 'Confirming ready' : what === 'start' ? 'Starting a trip' : 'Finishing a trip';
      throw new OfflineError(`${what_} needs a connection so dispatch and the server stay in step. Try again when you're back online.`);
    }
    const res = await api.post(`/driver/trips/${trip._id}/${what}`, body ?? {});
    if (what === 'start') await tracking.start({ tripNumber: trip.tripNumber });
    if (what === 'complete') await tracking.stop();
    await refresh();
    return res;
  }, [online, refresh]);

  // Trip events (stop reached, boarding, delays...) are queued when offline and replayed in order.
  const recordEvent = useCallback(async (trip, event) => {
    const clientId = makeId();
    const body = { ...event, clientId, source: 'mobile', at: new Date().toISOString() };
    const path = `/trips/${trip._id}/events`;
    if (online) {
      try { await api.post(path, body); return { queued: false }; } catch (e) { if (e.status !== 0) throw e; }
    }
    await enqueue({ id: clientId, method: 'POST', path, body, tripId: trip._id, label: event.type });
    return { queued: true };
  }, [online]);

  // Emergencies try to go out immediately; if that fails the person is told clearly it did NOT send.
  const emergency = useCallback(async (trip, notes, location) => {
    const clientId = makeId();
    try {
      await api.post(`/driver/trips/${trip._id}/emergency`, { notes: notes || undefined, location, clientId });
      return { sent: true };
    } catch (e) {
      if (e.status !== 0) throw e;
      await enqueue({ id: clientId, method: 'POST', path: `/driver/trips/${trip._id}/emergency`, body: { notes: notes || undefined, location, clientId }, tripId: trip._id, label: 'emergency' });
      return { sent: false };
    }
  }, []);

  return <Ctx.Provider value={{ me, trips, loading, stale, error, refresh, act, recordEvent, emergency, sync }}>{children}</Ctx.Provider>;
}
export const useTrips = () => useContext(Ctx);
