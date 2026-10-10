# Nest Transport — implementation status

Last updated 2026-10-10. Stack: **JavaScript** throughout — Express + Mongoose API, React + Vite + Tailwind web (Nest Play's
design system), React Native mobile app. Source of truth for design: Nest Play (`sports-pixelate`).

## Verification at a glance
| What | Result |
|---|---|
| API tests (Vitest, in-memory MongoDB) | **147 passing** — auth, tenant isolation, every module's rules and race conditions, API-surface security guard |
| Web tests (render every page against a mocked API) | **17 passing** |
| Mobile tests (offline queue, API client, trip rules, GPS buffer, screens) | **25 passing**; Metro production bundle builds |
| Lint (`no-undef`, hooks rules) | 0 errors in api, web, NestTransport (mobile) |
| Real-browser pass (Chrome, seeded data, all 15+ pages, 390 px) | Done; defects found were fixed (see `docs/UI_CONSISTENCY.md`) |
| **Not verified** | Docker images (daemon unavailable), mobile on a physical device or Android (iOS simulator only, Debug build, Keychain fallback path), any real GPS hardware, SMTP/Twilio/WhatsApp/Razorpay against live services |

## Features implemented
**Foundation** — organizations (tenants), JWT auth with refresh rotation, lockout, role/permission model enforced server-side on every route, audit log, validation (Zod), rate limiting, helmet/CORS, production secret-strength checks.

**Fleet** — vehicles (registration validation, status rules, driver assignment, archive safeguards), drivers/attendants/dispatchers, document expiry on dashboard.

**Routes & stops** — ordered stops with map editor (Leaflet), versioning (trips snapshot the plan), activate/duplicate/archive, manual distance/time.

**Trips & dispatch** — numbered trips, server-side state machine, vehicle/driver/attendant overlap and availability checks, replacements, recurring schedules with idempotent bounded generation, calendar and table views, full history.

**Trip events & passengers** — append-only event log with corrections that never edit history, passenger manifests with boarding/drop-off/missing rules, offline replay idempotency.

**Live tracking** — device ingestion (generic JSON adapter, hashed per-device keys), driver-phone ingestion limited to the active trip, validation/duplicate/out-of-order handling, Socket.IO with token auth and per-org rooms, server-computed freshness (never shows old data as live), history trail, retention purge.

**Maintenance, fuel, expenses** — maintenance lifecycle that takes vehicles out of service, fuel logs with server-checked totals and measured (never estimated) efficiency, expense approvals with separation of duties, cost roll-ups, optional module switch.

**Documents** — secure uploads (content-sniffed, size-capped, never publicly addressable), verification workflow, expiry status and reminder intervals, attachments on expenses/maintenance/requests.

**Notifications** — in-app (bell, realtime), email/SMS/WhatsApp adapters, configurable events/channels/roles/templates, delivery log with retry/backoff, opt-outs, scheduled reminder jobs, failures never affect operations.

**Transport requests** — nine typed requests with dry-run impact preview, validate → atomic claim → apply workflow, revert on failure, reviewer ≠ requester.

**Reports** — 14 reports (trips, utilization, driver duty, route performance, delays, cancellations, maintenance, fuel, expenses, document expiry, fee collection/outstanding) with CSV export that neutralises spreadsheet formulas, and "not enough data" instead of misleading percentages.

**Users & settings** — user management with role hierarchy, invitation and password-reset links, session revocation, organization settings and module switches, audit-log viewer.

**Fees & billing (optional)** — fee plans (route/stop/flat), passenger discounts/surcharges, idempotent invoice generation, partial payments, refunds, adjustments, reconciliation, aging, receipts, integer-paise money, Razorpay with server-side verification and signed webhook.

**Mobile app** — drivers/attendants: trips, route, arrival marking, boarding, delay/breakdown/incident reports, emergency + call dispatch, location sharing during a trip, offline queue; managers: overview and request review.

**Developer deliverables** — generated OpenAPI + API reference (`docs/openapi.json`, `docs/API.md`, 152 operations), deployment guide, GPS and notification and billing guides, UI consistency record, env examples, Dockerfiles/compose, visual-check scripts.

## Needs external credentials or hardware
| Capability | Needs |
|---|---|
| Email (invitations, resets, notifications) | SMTP server (`SMTP_*`) |
| SMS | Twilio account (`TWILIO_*`) |
| WhatsApp | Meta WhatsApp Business Cloud API (`WHATSAPP_*`) and, for business-initiated messages, approved templates (not implemented) |
| Online fee payment | Razorpay account + webhook (`RAZORPAY_*`) |
| Hardware GPS trackers | A tracker that can POST the generic JSON, or a protocol adapter written and tested for that model; raw TCP/UDP trackers need a separate listener |
| Phone location | Real devices with location permission; background behaviour depends on the OS and battery settings |
| Map tiles | OpenStreetMap public tiles (fine for evaluation; use a provider for production load) |
| Road distance/ETA | A routing provider — **none integrated**; distances are entered by hand and ETAs are not shown |

## Known limitations
**Not built**: parent/passenger mobile experience (and the `parentAccess` module is only a flag); push notifications;
WhatsApp approved-template sending; road-distance/ETA routing; PDF export (CSV only); GST/tax lines and financial-year invoice
numbering; automatic late fees/payment reminders; S3 (or other) file-storage adapter; multi-instance Socket.IO adapter;
virus scanning of uploads; proprietary GPS protocol adapters.

**Behavioural**: a person cannot review their own expense or request, so a one-person organization needs a second admin;
refunds are recorded locally and not sent to Razorpay; trip changes apply one document at a time (validate-then-claim-then-apply
with revert, no multi-document transactions); attachments are local-disk only; reports are computed live (no caching);
mobile start/finish require a connection by design; attendants cannot start or finish trips.

**Unverified**: everything listed under "Not verified" above — treat those as unproven until exercised.

## Phases (all complete)
1 Foundation · 2 Vehicles/drivers/dashboard · 3 Routes & stops · 4 Trips & dispatch · 5 Trip events & manifest · 6 GPS &
live tracking · 7 Maintenance/fuel/expenses · 8 Documents · 9 Notifications · 10 Transport requests · 11 Reports ·
12 Settings/users/password reset · 13 Fees & billing · 14 Mobile app · 15 API/deploy docs, security guard, UI verification.

## Docs
`docs/API.md` · `docs/openapi.json` · `docs/DEPLOYMENT.md` · `docs/GPS_INTEGRATION.md` · `docs/NOTIFICATIONS.md` ·
`docs/BILLING.md` · `docs/UI_CONSISTENCY.md` · `NestTransport/README.md` · `scripts/visual-check/README.md`
