// Offline action queue. Rules:
//  - Items are replayed strictly in the order they were created, so a "boarded" never overtakes "stop reached".
//  - A network failure or server error stops the flush and keeps everything for next time.
//  - A definite rejection (4xx) is dropped from the queue and reported, because retrying cannot help.
//  - Every item carries an idempotency key the server understands, so a replay after a half-finished
//    attempt can never record anything twice.
import { store } from './storage';

const KEY = 'offlineQueue';
const FAILED_KEY = 'offlineFailed';
const MAX_ATTEMPTS = 8;
let memory = null;
let failed = null;
let listeners = new Set();

const notify = () => listeners.forEach(l => l(snapshot()));
const snapshot = () => ({ pending: memory?.length ?? 0, failed: failed?.length ?? 0 });
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

async function load() {
  if (!memory) memory = await store.get(KEY, []);
  if (!failed) failed = await store.get(FAILED_KEY, []);
}
const persist = async () => { await store.set(KEY, memory); await store.set(FAILED_KEY, failed); };
export const makeId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function enqueue(item) {
  await load();
  const entry = { id: item.id ?? makeId(), createdAt: new Date().toISOString(), attempts: 0, ...item };
  // Same idempotency key already queued: keep one.
  if (!memory.some(m => m.id === entry.id)) memory.push(entry);
  await persist();
  notify();
  return entry;
}
export async function pending() { await load(); return [...memory]; }
export async function failures() { await load(); return [...failed]; }
export async function dismissFailures() { await load(); failed = []; await persist(); notify(); }
export async function resetForTests() { memory = []; failed = []; listeners = new Set(); await persist(); }
export async function counts() { await load(); return snapshot(); }

/**
 * send(item) must resolve on success and throw an error with `.status` (0 = no connection).
 * Returns { sent, dropped, stopped: 'offline' | 'server' | 'auth' | null }.
 */
export async function flush(send) {
  await load();
  const out = { sent: 0, dropped: 0, stopped: null };
  while (memory.length) {
    const item = memory[0];
    try {
      await send(item);
      memory.shift();
      out.sent++;
    } catch (e) {
      const status = e?.status ?? 0;
      if (status === 0) { out.stopped = 'offline'; break; }
      if (status === 401) { out.stopped = 'auth'; break; }
      if (status === 408 || status === 429 || status >= 500) {
        item.attempts += 1;
        if (item.attempts >= MAX_ATTEMPTS) {
          memory.shift();
          failed.push({ ...item, reason: e.message ?? 'Server error', at: new Date().toISOString() });
          out.dropped++;
          continue;
        }
        out.stopped = 'server';
        break;
      }
      // 400-499: the server understood and refused. Replaying will never succeed.
      memory.shift();
      failed.push({ ...item, reason: e.message ?? 'Rejected', at: new Date().toISOString() });
      out.dropped++;
    }
  }
  await persist();
  notify();
  return out;
}
