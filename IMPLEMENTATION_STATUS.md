# Nest Transport — Implementation Status

Last updated: 2026-10-09. Design reference: Nest Play (`sports-pixelate/frontend`). Stack: React+Vite+TS+Tailwind (same config/tokens as Nest Play), Express+TS+Mongoose API.

## Nest Play inspection findings (Phase 1)
- Web: Vite, React 18, TS, **Tailwind 3 + shadcn/Radix**, lucide-react, recharts, TanStack Query, React Router 6, DM Sans.
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
- Tests: 7 API tests passing (auth, lockout, logout invalidation, tenant isolation, assignment conflicts).

## Not started (pending)
Routes/stops, trips & dispatch, trip events, GPS ingestion + live tracking + Socket.IO, requests, maintenance, fuel/expenses, document uploads/storage, notifications (+ providers), billing/Razorpay, reports/CSV, settings/user management UI, password reset, OpenAPI docs, mobile app (driver/attendant/parent), deployment docs.

## Known limitations
- Web UI visuals have **not** been compared side-by-side with Nest Play in a browser yet; build and typecheck pass only.
- Refresh token is stored in localStorage (Nest Play convention); httpOnly cookie would be stronger.
- Forms use controlled state with server-side Zod validation; react-hook-form not yet used.
- Local dev has no MongoDB installed: use `npm run dev:memory` (in-memory, data lost on exit).
- Sidebar only lists built modules.

## Run
API: `cd api && cp .env.example .env && npm run dev` (or `npm run dev:memory`), tests: `npm test`. Web: `cd web && npm run dev` (port 5175, proxies /api to 5100).
