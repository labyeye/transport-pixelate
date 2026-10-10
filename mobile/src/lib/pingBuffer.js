// Location fixes waiting to be uploaded. Newest data wins when the phone has been offline for a long time:
// the buffer is capped and the oldest fixes are dropped first. Fixes are uploaded oldest-first in batches.
import { PING_BUFFER_MAX } from '../config';
import { store } from './storage';

const KEY = 'pingBuffer';
let buf = null;

async function load() {
  if (!buf) buf = await store.get(KEY, []);
}

export function trim(list, max = PING_BUFFER_MAX) {
  return list.length > max ? list.slice(list.length - max) : list;
}

export async function add(ping) {
  await load();
  buf = trim([...buf, ping]);
  await store.set(KEY, buf);
  return buf.length;
}

export async function size() {
  await load();
  return buf.length;
}

export async function takeBatch(n = 100) {
  await load();
  return buf.slice(0, n);
}

export async function drop(count) {
  await load();
  buf = buf.slice(count);
  await store.set(KEY, buf);
}

export async function clear() {
  buf = [];
  await store.set(KEY, buf);
}

export const toPing = pos => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  timestamp: new Date(pos.timestamp ?? Date.now()).toISOString(),
  ...(Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? { speedKmh: Math.round(pos.coords.speed * 3.6 * 10) / 10 } : {}),
  ...(Number.isFinite(pos.coords.heading) && pos.coords.heading >= 0 ? { heading: pos.coords.heading } : {}),
  ...(Number.isFinite(pos.coords.accuracy) ? { accuracyM: pos.coords.accuracy } : {}),
});
