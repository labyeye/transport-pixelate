import { DEFAULT_API_URL } from '../config';
import { secure, store } from './storage';

export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
    // status 0 = the request never got an answer (offline, DNS, timeout)
    this.network = status === 0;
  }
}

let baseUrl = DEFAULT_API_URL;
let accessToken = null;
let onSignedOut = () => {};
let refreshing = null;

export const setSignedOutHandler = fn => { onSignedOut = fn; };
export const getBaseUrl = () => baseUrl;
export async function loadBaseUrl() {
  baseUrl = (await store.get('apiUrl', DEFAULT_API_URL)) || DEFAULT_API_URL;
  return baseUrl;
}
export async function setBaseUrl(url) {
  baseUrl = url.replace(/\/+$/, '');
  await store.set('apiUrl', baseUrl);
}
export const setAccessToken = t => { accessToken = t; };

async function rawFetch(path, { method = 'GET', body, auth = true, timeoutMs = 15000 } = {}, fetchImpl = fetch) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
  } catch {
    throw new ApiError(0, 'No connection');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function refreshTokens(fetchImpl) {
  const tokens = await secure.getTokens();
  if (!tokens?.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken }, auth: false }, fetchImpl);
      if (!res.ok) return false; // refresh token rejected: genuinely signed out
      const j = await res.json();
      accessToken = j.data.accessToken;
      await secure.setTokens({ refreshToken: j.data.refreshToken });
      return true;
    } catch (e) {
      // Offline during refresh is NOT a sign-out; surface it so callers treat it as a network error.
      if (e instanceof ApiError && e.network) throw e;
      return false;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** JSON request with a single transparent token refresh on 401. Throws ApiError (status 0 = offline). */
export async function request(path, opts = {}, fetchImpl) {
  let res = await rawFetch(path, opts, fetchImpl);
  if (res.status === 401 && opts.auth !== false && !path.startsWith('/auth/')) {
    const ok = await refreshTokens(fetchImpl);
    if (ok) res = await rawFetch(path, opts, fetchImpl);
    else {
      await secure.clearTokens();
      accessToken = null;
      onSignedOut();
    }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message ?? 'Request failed', json.errors);
  return json;
}

export const api = {
  get: (p, params) => request(params && Object.keys(params).length ? `${p}?${new URLSearchParams(params).toString()}` : p, { method: 'GET' }),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  put: (p, body, o) => request(p, { ...o, method: 'PUT', body }),
};

export async function restoreSession() {
  const tokens = await secure.getTokens();
  if (!tokens?.refreshToken) return null;
  const ok = await refreshTokens();
  if (!ok) return null;
  return (await api.get('/auth/me')).data;
}
export async function signIn(email, password) {
  const res = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
  accessToken = res.data.accessToken;
  await secure.setTokens({ refreshToken: res.data.refreshToken });
  return res.data.user;
}
export async function signOut() {
  try { await request('/auth/logout', { method: 'POST' }); } catch { /* signing out locally regardless */ }
  accessToken = null;
  await secure.clearTokens();
}
