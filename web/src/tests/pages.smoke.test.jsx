// Mounts every routed page with a mocked API and fails on any runtime error (undefined component,
// bad import, crash on empty data). `vite build` cannot catch these.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-leaflet", () => {
  const Stub = ({ children }) => <div data-testid="map">{children}</div>;
  const Null = () => null;
  return { MapContainer: Stub, TileLayer: Null, CircleMarker: Stub, Polyline: Null, Tooltip: Null, useMap: () => ({ setView() {}, fitBounds() {}, getZoom: () => 4 }), useMapEvents: () => null };
});
vi.mock("socket.io-client", () => ({ io: () => ({ on() {}, close() {} }) }));

const ALL = ["vehicles", "drivers", "routes", "trips", "tracking", "maintenance", "expenses", "reports", "documents"].flatMap((x) => [`${x}:read`, `${x}:write`]);
const PERMS = [...ALL, "trips:dispatch", "trips:operate", "passengers:read", "passengers:write", "tracking:write", "expenses:approve", "documents:verify", "settings:write"];
const USER = { id: "u1", name: "Test Owner", email: "o@x.com", role: "owner", organization: "o1", permissions: PERMS };
const page = { page: 1, limit: 15, total: 0, pages: 1 };
const DASH = {
  vehicles: { total: 3, available: 1, assigned: 1, onTrip: 1, maintenance: 0, outOfService: 0 },
  drivers: { total: 2, onDuty: 1, onLeave: 0 },
  trips: { today: 2, scheduled: 1, inProgress: 1, delayed: 0, completed: 0, cancelled: 0 },
  maintenance: { open: 1, inWorkshop: 0, dueThisWeek: 0 },
  costs: { fuel: 1000, expenses: 200, maintenance: 0, pendingExpenses: 1 },
  expiries: [],
};

function route(url) {
  const u = new URL(url, "http://x");
  const p = u.pathname.replace(/^\/api\/v1/, "");
  if (p === "/auth/refresh") return { data: { accessToken: "a", refreshToken: "r" } };
  if (p === "/auth/me") return { data: USER };
  if (p === "/dashboard") return { data: DASH };
  if (p === "/documents/summary") return { data: { expired: 0, expiringSoon: 0, valid: 0, awaitingVerification: 0, soonDays: 30 } };
  if (p === "/documents/settings/reminders") return { data: { days: [30, 15, 7] } };
  if (p === "/maintenance/due") return { data: { scheduled: [], services: [] } };
  if (p === "/tracking/vehicles") return { data: [], sourceConfigured: false };
  if (p === "/tracking/devices") return { data: [], providers: ["generic"] };
  if (p === "/notifications/unread-count") return { data: { count: 2 } };
  if (p === "/notifications/preferences") return { data: { mutedChannels: [], email: "o@x.com", phone: "" } };
  if (p === "/notifications/settings") return { data: { events: [{ event: "trip_started", label: "Trip started", severity: "info", enabled: true, channels: ["in_app"], roles: ["owner"] }], channels: [{ key: "email", label: "Email", configured: false, implemented: true, enabled: false }], roles: ["owner"] } };
  if (p === "/notifications/templates" || p === "/trip-schedules" || p === "/notifications/deliveries") return { data: [], meta: page };
  return { data: [], meta: page };
}

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage()); // Node 25's built-in localStorage shadows jsdom's
  localStorage.setItem("nt_refresh", "r");
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, status: 200, json: async () => ({ success: true, ...route(String(url)) }) })));
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-uuid-uuid" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ROUTES = [
  ["/", /Transport operations/], ["/vehicles", /Fleet/], ["/drivers", /Drivers & transport staff/], ["/routes", /Routes & stops/],
  ["/trips", /Trips & dispatch/], ["/tracking", /Live tracking/], ["/passengers", /Passengers/], ["/maintenance", /Maintenance/],
  ["/fuel-expenses", /Fuel & expenses/], ["/documents", /Documents & expiry/], ["/notifications", /What gets sent/],
];

describe("every page renders against mocked API data", () => {
  for (const [path, heading] of ROUTES) {
    it(path, async () => {
      const errors = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.map(String).join(" ")));
      window.history.pushState({}, "", path);
      const { default: App } = await import("../App.jsx");
      render(<App />);
      await waitFor(() => expect(screen.getAllByText(heading).length).toBeGreaterThan(0), { timeout: 8000 });
      // sidebar shows every module the user may access
      expect(screen.getAllByText("Live Tracking").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Notifications").length).toBeGreaterThan(0);
      spy.mockRestore();
      expect(errors.filter((e) => !/act\(|not wrapped|ReactDOMTestUtils|validateDOMNesting/.test(e))).toEqual([]);
    });
  }

  it("dashboard shows trip, maintenance and cost cards", async () => {
    window.history.pushState({}, "", "/");
    const { default: App } = await import("../App.jsx");
    render(<App />);
    for (const t of ["Trips today", "Open maintenance", "Fuel this month", "Pending expenses"]) await waitFor(() => expect(screen.getByText(t)).toBeTruthy());
  });
});
