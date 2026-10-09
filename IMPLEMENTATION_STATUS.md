# Nest Transport — Implementation Status

Last updated: 2026-10-09. Design reference: Nest Play (`sports-pixelate/frontend`). Stack: React+Vite+Tailwind (JSX) (same config/tokens as Nest Play), Express+Mongoose API (plain JavaScript, ES modules).

## Nest Play inspection findings (Phase 1)
- Web: Vite, React 18, **Tailwind 3 + shadcn/Radix**, lucide-react, recharts, TanStack Query, React Router 6, DM Sans.
- Look: **neo-brutalist** — 2px black borders, hard offset shadows (`nb-card`, `nb-btn`, `nb-badge`), primary `#024BAB`, accent `#FA731C`, sidebar 15.5rem / header 4rem, uppercase 12px table headers on `#024BAB/5`.
- Backend: plain-JS Express + Mongoose + JWT. Mobile: React Native 0.86 (`NestSports/`), lucide-react-native, React Navigation, `@react-native-community/geolocation`.
- Reused verbatim: `tailwind.config.ts`, `index.css` (tokens + nb-* utilities), `button/card/dialog/input/select/tabs/badge/StatCard/Toaster`, `AppLayout/AppSidebar/AppHeader` (adapted: nav, auth, brand; Nest Play notifications and trial banner removed).
- Deliberately not copied: Nest Play logos/branding (Nest Transport has its own wordmark).

## Done
- API: auth (register-org, login w/ lockout, refresh, logout invalidation, change-password), RBAC permission map, tenant scoping on every query, audit log, Zod validation, pagination, rate limiting, helmet/CORS.
- Vehicles: CRUD, registration validation + per-org uniqueness, filters/search, status rules, driver assign/unassign with two-sided consistency and availability checks, archive safeguards.
- Drivers/staff: CRUD, licence rules, status rules, archive safeguards.
- Dashboard: real counts + 30-day document expiry list (vehicle docs + driver licences) + empty state.
- Web: login/register, dashboard, vehicles, drivers/staff (list, search, filters, pagination, forms, confirm dialogs, loading/empty/error states).
- Routes & stops (Phase 3): Route model with embedded ordered stops, server-derived sequence, coordinate/time validation, per-org unique code, activate (needs 2 active stops), duplicate, archive (inactive only), `version` bump on edit for future trip snapshots, vehicle/driver refs checked in-org and for availability. Web: routes list + editor with Leaflet map (click to add stops, reorder, remove). Distance/duration are manual (no routing provider configured); map lines are straight, not road geometry.
- Trips & dispatch (Phase 4): Trip model with per-org numbering (TRP-00001), immutable route snapshot (route edits never change existing trips), server-side state machine (draft/scheduled/assigned/ready/in_progress/delayed/completed/cancelled/aborted; terminal states cannot be restarted), overlap detection for vehicle/driver/attendant (back-to-back allowed), availability + licence-expiry checks, vehicle on_trip/driver on_duty set at dispatch and released on completion/abort, reasons required for delay/cancel/abort, mid-trip vehicle/driver replacement, embedded status history, reschedule via edit. Recurring schedules: days-of-week, bounded generation (62 days), idempotent per (schedule,date) via unique key, conflicting days created unassigned and reported. Times converted using the organization's IANA timezone. Web: trips table, week calendar, create/edit, action dialogs, replace, detail with history, schedules tab, dashboard trip cards.
- Trip events & manifest (Phase 5): append-only TripEvent log (event time vs server receipt time, actor, source, stop, coordinates, notes); corrections add a new event pointing at the original, which is never modified; Passenger + PassengerAssignment models (pickup/drop stops validated against the route); manifest with live boarded/dropped/missing state derived from effective events; duplicate boarding/drop-off blocked; events only while trip is live; future/pre-start timestamps rejected; `clientId` idempotency for offline replay; system events for create/assign/start/delay/complete/cancel/abort; drivers/attendants limited to trips they are assigned to (Driver.user link) and cannot correct events. Web: Passengers page, trip detail tabs (Overview / Manifest / Events) with board/drop/missing buttons, incident entry and correction flow.
- GPS & live tracking (Phase 6): GpsDevice (hashed per-device keys, shown once, rotatable), provider adapter registry (generic JSON only), device ingestion endpoint with per-ping validation, duplicate/out-of-order handling, separate LocationPing history and VehiclePosition latest-fix collections, hourly retention purge, driver-phone ingestion limited to the driver's own active trip, Socket.IO with token auth and per-org rooms, live board API with server-computed freshness and trip/next-stop info, history trail. Web: live map (freshness-coloured markers, locally re-aged so silent vehicles turn stale), vehicle detail panel with last-update time and "last known" warning, filters, connection indicator, "no GPS source" banner, device management with one-time key reveal. See docs/GPS_INTEGRATION.md.
- Tests: 38 API tests passing (auth, lockout, logout invalidation, tenant isolation, assignment conflicts, routes, trip lifecycle, overlaps, replacement, schedule generation).

## Phases
1 Foundation (done) · 2 Vehicles/drivers/dashboard (done) · 3 Routes & stops (done) · 4 Trips & dispatch (done) · 5 Trip events & manifest (done) · 6 GPS & live tracking (done, unverified with real hardware) · 7 Maintenance/fuel/expenses · 8 Documents & storage · 9 Notifications · 10 Transport requests · 11 Reports · 12 Settings/users/password reset · 13 Fees & billing · 14 Mobile app · 15 API docs, deploy docs, UI check

## Not started (pending)
requests, maintenance, fuel/expenses, document uploads/storage, notifications (+ providers), billing/Razorpay, reports/CSV, settings/user management UI, password reset, OpenAPI docs, mobile app (driver/attendant/parent), deployment docs.

## Known limitations
- GPS: no physical tracker or third-party fleet API has been connected; only the generic JSON adapter exists. Live tracking is unproven until a real source is observed end to end. ETA is not shown (no routing provider). Next stop is shown only if drivers record "stop reached" events.
- No UI/API yet to create login accounts for drivers/attendants or link them to a Driver profile (Phase 12); the link is `Driver.user` and is tested by direct DB setup.
- Passenger stop references use stop names; renaming a stop after assignments exist can orphan the stop match on the manifest.
- Trip start is not yet restricted by time-of-day or to the assigned driver; driver-only start comes with the mobile app (Phase 14). Trips keep an embedded status history in addition to the TripEvent log.
- Recurring generation is a manual, bounded action (no background auto-generation job).
- Web UI visuals have **not** been compared side-by-side with Nest Play in a browser yet; build and typecheck pass only.
- Refresh token is stored in localStorage (Nest Play convention); httpOnly cookie would be stronger.
- Forms use controlled state with server-side Zod validation; react-hook-form not yet used.
- Whole project is plain JavaScript (no TypeScript) by request; Nest Play web is TS, so copied components had types stripped.
- Local dev has no MongoDB installed: use `npm run dev:memory` (in-memory, data lost on exit).
- Sidebar only lists built modules.

## Run
API: `cd api && cp .env.example .env && npm run dev` (or `npm run dev:memory`), tests: `npm test`. Web: `cd web && npm run dev` (port 5175, proxies /api to 5100).
