# Nest Transport

Transport management for schools, institutions and fleets — part of the Nest product family, built on the Nest Play design system.

| Folder | What |
|---|---|
| `api/` | Express + Mongoose API (JavaScript, ES modules), Socket.IO |
| `web/` | React + Vite + Tailwind management dashboard |
| `NestTransport/` | React Native app for drivers, attendants and managers (own git repo, not tracked here) |
| `docs/` | API reference (generated), deployment, GPS, notifications, billing, UI consistency |
| `scripts/visual-check/` | Seed data + browser screenshots for visual review |

## Quick start (no MongoDB needed)
```bash
cd api && npm install && npm run dev:memory     # API on :5100, in-memory database
cd web && npm install && npm run dev            # http://localhost:5175
```
Create an organization on the sign-up screen. See `docs/DEPLOYMENT.md` for real deployment and `IMPLEMENTATION_STATUS.md`
for what is verified, what needs credentials or hardware, and the known limitations.
