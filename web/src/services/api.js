// Thin API client: attaches the access token and transparently refreshes it once on 401.
const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";
const RT_KEY = "nt_refresh";
let accessToken = null;
let onSessionExpired = () => {};
export const tokens = {
  setAccess: (t) => (accessToken = t),
  getAccess: () => accessToken,
  getRefresh: () => {
    try {
      return localStorage.getItem(RT_KEY);
    } catch {
      return null;
    }
  },
  setRefresh: (t) => {
    try {
      t ? localStorage.setItem(RT_KEY, t) : localStorage.removeItem(RT_KEY);
    } catch {
      /* storage unavailable */
    }
  },
  onExpired: (fn) => (onSessionExpired = fn),
};
export class ApiError extends Error {
  status;
  errors;
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
let refreshing = null;
async function refresh() {
  const rt = tokens.getRefresh();
  if (!rt) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      accessToken = j.data.accessToken;
      tokens.setRefresh(j.data.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
export async function api(path, opts = {}) {
  const qs = opts.query
    ? "?" +
      new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const run = () =>
    fetch(`${BASE}${path}${qs}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await run();
  if (res.status === 401 && !path.startsWith("/auth/") && (await refresh()))
    res = await run();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) onSessionExpired();
    throw new ApiError(
      res.status,
      json.message ?? "Request failed",
      json.errors,
    );
  }
  return json;
}
export const get = (p, query) => api(p, { query });
export const post = (p, body) => api(p, { method: "POST", body });
export const put = (p, body) => api(p, { method: "PUT", body });
export const patch = (p, body) => api(p, { method: "PATCH", body });
export const del = (p) => api(p, { method: "DELETE" });
