// Location sharing for an active trip. The person always sees whether it is on, and sharing only runs
// between "Start trip" and "Finish trip" (the server also refuses locations outside that window).
//
// IMPORTANT: continuous background tracking depends on the operating system, battery settings and the
// permission the user grants. This module reports what is actually happening instead of promising it.
import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import BackgroundService from 'react-native-background-actions';
import { PING_INTERVAL_MS } from '../config';
import { api } from './api';
import { add, clear, drop, size, takeBatch, toPing } from './pingBuffer';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let state = { status: 'off', lastFixAt: null, lastUploadAt: null, buffered: 0, background: null, error: null };
let listeners = new Set();
let watchId = null;
let running = false;

const set = patch => { state = { ...state, ...patch }; listeners.forEach(l => l(state)); };
export const getState = () => state;
export const subscribe = fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); };

async function ensurePermission() {
  if (Platform.OS === 'android') {
    const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
      title: 'Share your location during trips',
      message: 'Nest Transport shares your location with dispatch only while a trip is running.',
      buttonPositive: 'Allow',
    });
    if (fine !== PermissionsAndroid.RESULTS.GRANTED) return { granted: false };
    // Background access is a separate, optional grant on Android 10+.
    let background = true;
    if (Platform.Version >= 29) {
      const bg = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      background = bg === PermissionsAndroid.RESULTS.GRANTED;
    }
    return { granted: true, background };
  }
  // iOS: the system prompt is triggered by the first watch; "always" is requested via configuration.
  Geolocation.setRNConfiguration({ skipPermissionRequests: false, authorizationLevel: 'always', locationProvider: 'auto' });
  return { granted: true, background: null };
}

export async function uploadNow() {
  let sent = 0;
  for (;;) {
    const batch = await takeBatch(100);
    if (!batch.length) break;
    try {
      await api.post('/tracking/mobile/ping', { pings: batch });
      await drop(batch.length);
      sent += batch.length;
      set({ lastUploadAt: new Date().toISOString(), buffered: await size(), error: null });
    } catch (e) {
      if (e.status === 0 || e.status >= 500) { set({ buffered: await size() }); break; } // keep and retry later
      if (e.status === 403) {
        // Server says there is no active trip for this person: stop sharing and discard stale fixes.
        await clear();
        await stop();
        set({ error: 'Location sharing stopped: there is no active trip.' });
        break;
      }
      await drop(batch.length); // malformed batch: don't loop on it forever
      set({ error: e.message });
    }
  }
  return sent;
}

async function loop() {
  while (BackgroundService.isRunning() && running) {
    await uploadNow();
    await sleep(PING_INTERVAL_MS);
  }
}

export async function start({ tripNumber }) {
  if (running) return state;
  set({ status: 'requesting', error: null });
  let perm;
  try { perm = await ensurePermission(); } catch (e) { set({ status: 'error', error: e.message }); return state; }
  if (!perm.granted) { set({ status: 'denied', error: 'Location permission was not granted.' }); return state; }
  running = true;
  watchId = Geolocation.watchPosition(
    async pos => {
      await add(toPing(pos));
      set({ lastFixAt: new Date().toISOString(), buffered: await size() });
    },
    err => set({ error: `Location unavailable: ${err.message}` }),
    { enableHighAccuracy: true, distanceFilter: 25, interval: 10000, fastestInterval: 5000, useSignificantChanges: false },
  );
  try {
    // Android keeps the process alive with a visible foreground-service notification.
    await BackgroundService.start(async () => { await loop(); }, {
      taskName: 'NestTransportTracking',
      taskTitle: `Trip ${tripNumber}`,
      taskDesc: 'Sharing your location with dispatch',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#024BAB',
      parameters: {},
    });
  } catch (e) {
    set({ error: `Background service did not start: ${e.message}. Location is shared only while the app is open.` });
  }
  set({ status: 'on', background: perm.background });
  return state;
}

export async function stop() {
  running = false;
  if (watchId != null) { Geolocation.clearWatch(watchId); watchId = null; }
  try { await BackgroundService.stop(); } catch { /* not running */ }
  await uploadNow().catch(() => {});
  set({ status: 'off', background: null });
}
