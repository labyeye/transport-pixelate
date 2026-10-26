# Nest Transport vs FleetX — Audit & Phase Plan

Date: 2026-10-15
Scope: `nest-transport/api`, `nest-transport/web`, `nest-transport/NestTransport` (React Native). Reference flows: `sports-pixelate` (onboarding + subscription), `hrms` (tiers/feature gating), `NestDoc` (tenant registration).

> **Note:** Nest Transport side = code padh ke verified. FleetX side = public product knowledge + review sites (Capterra/G2/GetApp); fleetx.io ka live feature/pricing page check nahi hua, aur "FleetX" naam ke multiple products hain. Implement se pehle fleetx.io ki current feature list ek baar dekh lena. FleetX ka pricing public nahi hai (third-party estimate $20–60/vehicle/month software-only, GPS hardware extra).

---

## 1. Nest Transport — current state (verified)

Stack: Express + Mongoose + Socket.IO API, React/Vite web (17 pages), React Native app (drivers/attendants/managers). Tests: API 147, web 17, mobile 25 (per `IMPLEMENTATION_STATUS.md`; device/real GPS/SMTP/Razorpay live **unverified**).

### Data model (input fields)
| Entity | Key fields |
|---|---|
| Organization | name, category (school/employee/institution/contractor/other), currency, timezone, modules{fuelExpenses, passengerManifest, billing, parentAccess}, docReminderDays, gpsRetentionDays, status. **Koi plan / subscription / trial / limits field nahi.** |
| User | name, email, phone, phoneVerified, password, role (owner/admin/dispatcher/accountant/driver/attendant/viewer), TOTP, WhatsApp login OTP, lockout, tokenVersion, mutedChannels |
| Vehicle | registrationNumber, fleetNumber, category, make, model, year, capacity, fuelType, tankCapacity, odometer, ownership, status(6), branch, assignedDriver/Route, gpsDevice{provider,deviceId}, documents{insurance, registration, fitness, permit, pollution: number/issue/expiry/verified} |
| Driver/Staff | staffRole, name, phone, email, address, emergencyContact, licence{number,class,expiry}, joiningDate, employmentType, status(6), branch, assignedVehicle |
| Route | name, code, stops[{name, lat/lng, sequence, plannedArrival/Departure, dwell, pickup/dropoff}], distance, duration, operatingDays, start/end time, version |
| Trip | tripNumber, tripType, route snapshot, date, scheduledDeparture, expectedArrival, vehicle, driver, attendant, status(9), actual start/end/distance, delayReason, history |
| Passenger | name, kind (student/employee/other), identifier, grade, phone, guardian{name,phone} |
| Fuel / Maintenance / Expense | fuel: qty, price, total, odometer, fullTank, station; maint: type, priority, status, workshop, cost, parts, next service date/odometer; expense: category, amount, vendor, payment method, approval |
| Billing (passenger fees) | FeePlan, PassengerAssignment/Charge, Invoice, Payment, Refund, Razorpay |

### Web pages (16 + auth)
Dashboard, Vehicles, Drivers & Staff, Documents, Routes, Trips, Live Tracking, Passengers, Requests, Maintenance, Fuel & Expenses, Transport Fees (billing), Reports (14), Notifications, Settings, Auth (login/register/2FA/OTP), Forgot/Reset.

### Auth (already ported)
register, login, lockout, 2FA (TOTP), WhatsApp login OTP, phone verify, forgot/reset, refresh rotation, logout-all, profile. Roles + 29 permissions enforced server-side.

---

## 2. Feature gap vs FleetX

Legend: ✅ hai | 🟡 partial | ❌ nahi hai

### A. Tracking & telematics
| Feature | FleetX | Nest Transport |
|---|---|---|
| Live vehicle map | ✅ | ✅ (Leaflet + Socket.IO) |
| Route history / trail playback | ✅ | 🟡 trail hai, timeline playback UI check karna |
| GPS device integration (many OEM protocols) | ✅ | 🟡 generic JSON only, TCP/UDP + OEM adapters ❌ |
| Geofence (enter/exit alerts) | ✅ | ❌ |
| Overspeed / harsh brake / idling / ignition alerts | ✅ | ❌ (speedKmh store hota hai, rules nahi) |
| Driver behaviour score | ✅ | ❌ |
| Fuel level sensor / fuel-theft alerts | ✅ | ❌ (manual fuel log only) |
| Road ETA / routing / route optimisation | ✅ | ❌ (distance manual, ETA nahi) |
| Share live-trip link (customer/parent) | ✅ | ❌ |

### B. Trips & dispatch
| Feature | FleetX | Nest Transport |
|---|---|---|
| Trip planning, state machine, conflicts | ✅ | ✅ strong |
| Recurring schedules | ✅ | ✅ |
| Load / consignment / e-POD / LR (goods side) | ✅ | ❌ (passenger-only, intentional?) |
| Customer / client master + trip billing | ✅ | ❌ |
| Driver mobile app, offline queue | ✅ | ✅ |
| Driver app: digital checklist/inspection (DVIR) | ✅ | ❌ |
| Driver trip advance / settlement / allowance | ✅ | ❌ |
| Panic/SOS | ✅ | ✅ emergency |

### C. Compliance, maintenance, cost
| Feature | FleetX | Nest Transport |
|---|---|---|
| Document expiry + reminders | ✅ | ✅ |
| Challan / FASTag / toll tracking | ✅ | ❌ |
| Preventive maintenance by km/days | ✅ | 🟡 next-service fields hai, auto-schedule/alert check karna |
| Tyre management, spare-parts inventory | ✅ | ❌ |
| Vendor/workshop master | ✅ | ❌ (free-text workshop) |
| Fuel analytics, mileage | ✅ | ✅ measured efficiency |
| Expense approval | ✅ | ✅ |
| Cost per km / TCO | ✅ | 🟡 roll-ups hai, per-km report confirm karna |

### D. Reports, platform, integrations
| Feature | FleetX | Nest Transport |
|---|---|---|
| Reports | ✅ | ✅ 14 (CSV only, **PDF ❌**) |
| Scheduled email reports | ✅ | ❌ |
| Push notifications | ✅ | ❌ (in-app/email/SMS/WA only) |
| WhatsApp templates | — | 🟡 adapter hai, approved templates ❌ |
| Public API / webhooks / API keys | ✅ | 🟡 OpenAPI docs hai, API keys ❌ |
| Parent/passenger app | n/a (school niche) | ❌ (flag only) — **market differentiator, FleetX ke paas nahi** |
| Multi-branch | ✅ | 🟡 `branch` string only |
| Multi-language, white-label | ✅ | ❌ |

### E. Commercial / SaaS layer  ← biggest gap
| Feature | Other Nest products | Nest Transport |
|---|---|---|
| Plan / tier on tenant | ✅ Subscription model | ❌ |
| Free trial + expiry gate | ✅ | ❌ |
| Per-unit pricing + 18% GST | ✅ | ❌ |
| Razorpay checkout for SaaS | ✅ | ❌ (Razorpay sirf passenger fee ke liye) |
| Offer codes | ✅ | ❌ |
| Feature gating by tier | ✅ hrms `planFeatures` | ❌ (`modules` flags sirf toggles) |
| Usage limits (vehicles/users) | ✅ | ❌ |
| Renewal reminders / lifecycle job | ✅ | ❌ |
| Onboarding wizard | ✅ | ❌ (register = 1 form) |

---

## 3. Registration flow — reference vs Transport

**Sports/HRMS flow (copy karna hai):**
1. `POST /auth/register` — account only (name, email, strong password) → `/onboarding`
2. Onboarding **step 1 Company**: name, phone, address, GST number
3. **Step 2 Units**: count + WhatsApp toggle + offer code → live price with 18% GST
4. **Step 3 Payment**: Razorpay order → verify → `Subscription` created (`paymentStatus`, `isTrial`, `trialEndDate`, `renewalDate`, limits)
5. Login gate: no active/paid/non-expired subscription → 403 (owner exempt to reach billing)
6. Feature gate by tier (`getCompanyFeatures`), cron lifecycle (renewal reminders, `pending_renewal`)

**Transport abhi:** single `/register` (org name, category, name, email, password) → owner → dashboard. Koi company details, GST, plan, payment, trial nahi.

Note: Transport mein "tenant" = `Organization`, `req` pe `org` JWT claim hai — Subscription is se link karna hai, naya tenant concept nahi.

---

## 4. Pricing model (market-aligned) — proposal

FleetX/market: **per vehicle per month**, GPS hardware alag. Nest products: per-unit + GST + WhatsApp tier. Isliye:

| Tier | Rate (proposal, confirm karo) | Includes |
|---|---|---|
| Basic — Web + Mobile | ₹X / vehicle / month | trips, routes, drivers, docs, maintenance, fuel, reports, in-app notifications |
| Pro — + WhatsApp + Parent app | ₹Y / vehicle / month | + WhatsApp alerts, parent live-link, fee billing, geofence/overspeed alerts |
| Hardware GPS | pass-through / alag | device integration support |

- Unit = **active vehicles** (sports mein users hain; transport ke liye vehicle market standard hai). Passengers/drivers unlimited — aggressive vs FleetX.
- 18% GST on top, yearly = 12× (no discount) — sports/hrms jaisa; offer codes (flat_rate / percent_off / bonus_months) reuse.
- Trial: **14 din** (NestDoc) ya 2 mahine (sports) — decide karo; Transport ko hardware/ops setup time chahiye, isliye 30 din suggest.
- ⚠ ₹X/₹Y maine invent nahi kiye — aap final karo; FleetX ~$20–60 (₹1,700–5,000) /vehicle/month estimate hai, school-bus segment mein ₹100–300/vehicle ke aas-paas competitive rehta hai (verify karna).

---

## 5. Phase plan

**Status (2026-10-15):** Phase 1 done (API + web + mobile locked screen; mobile not run, no node_modules here). Phase 2 partly done: geofence (circle) + overspeed alerts + Alerts page; idle/ignition, route-deviation and driver score still open. Rates are placeholders (env `PRICE_*_PAISE`).

### Phase 1 — SaaS foundation (registration + subscription) — ✅ done
- `Subscription` model (`organization`, tier, vehicleLimit, monthly/yearly price, gst, billingCycle, isTrial, trialEndDate, renewalDate, status, paymentStatus, razorpay ids, offerCode, bonusMonths) — sports `Subscription.js` se port
- `pricing.js` + inline `assert` self-check (sports jaisa), `planFeatures.js` (tiers)
- `OfferCode` model + validate endpoint
- Register: account-only → auto **trial subscription** create
- Onboarding wizard (web): Company (phone, address, GST) → Fleet size + tier + offer → Payment/Start trial
- `/billing/subscription` (get, createOrder, verify, cancel) — **naam alag** `saas-billing`, taaki passenger-fee `/billing` se na takraye
- Login/protect gate: expired trial / unpaid → 403, owner exempt
- Vehicle create pe `vehicleLimit` enforce; `requireFeature(tier)` middleware (WhatsApp, parent app)
- Lifecycle cron: trial-ending (-7,-3,-1), renewal, `pending_renewal`
- Web: Subscription page in Settings, trial banner; Mobile: expired-state screen
- Tests: pricing, gate, limit, trial expiry, tenant isolation

### Phase 2 — Alerts & telematics rules — 🟡 geofence + overspeed done
- Geofence model + enter/exit events; overspeed (org-level limit), idle, ignition, route-deviation
- Alert model + notification catalog entries; Alerts page; live-map alert badges
- Driver behaviour score (from alerts) + report

### Phase 3 — Parent/passenger experience (differentiator, Pro tier)
- `parent` role + guardian↔passenger link, invite via WhatsApp/OTP (existing OTP service)
- Parent app/web: live bus, ETA, boarding/drop notifications
- Push notifications (FCM) + WhatsApp approved templates

### Phase 4 — Ops depth
- Routing provider (ETA, road distance), stop ETA
- Preventive-maintenance scheduler (km/days) with alerts
- Vendor/workshop master, tyre & spare-parts inventory, challan/FASTag log
- Driver checklist/inspection in mobile, trip advance/allowance
- Branch as real entity

### Phase 5 — Platform & reporting
- PDF reports, scheduled email reports
- API keys + webhooks, OEM GPS protocol adapters (TCP listener)
- S3 file storage, multi-instance Socket.IO adapter, GST invoice numbering for passenger fees
- Multi-language, white-label

---

## 6. Risks / caveats
- Native Android/iOS build, background GPS, real hardware, SMTP/Twilio/WhatsApp/Razorpay live — **still unverified** (per IMPLEMENTATION_STATUS).
- User.email globally unique — multi-org same-email nahi chalega (same as other Nest apps; intentional?).
- Passenger-fee Razorpay aur SaaS Razorpay account/webhook alag rakhna (tenant ke apne keys vs Nest ke keys).
- Existing orgs ke liye migration: grandfather as trial/active subscription, warna login lock ho jayega.
