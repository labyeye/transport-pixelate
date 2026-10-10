# Deployment

## What you need
| Component | Notes |
|---|---|
| MongoDB 6+ | Use a managed cluster or a replica set; **take backups** (see below). |
| Node.js 22 | API (`api/`). |
| Static hosting / nginx | Serves `web/dist` and proxies `/api` and `/socket.io` to the API. |
| HTTPS | Terminate TLS in front (Caddy, Traefik, cloud load balancer). Required for the mobile app on Android release builds and for browser geolocation/secure cookies. |
| Persistent disk | `UPLOAD_DIR` holds uploaded documents; back it up with the database. |

## Configuration (`api/.env`)
| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI` | yes | Database connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | Different, random, ≥ 32 characters (`openssl rand -hex 32`). **The API refuses to start in production with weak, placeholder or identical values.** |
| `ALLOWED_ORIGINS` | production | Comma-separated web origins allowed by CORS/Socket.IO |
| `APP_URL` | recommended | Public web URL used in invitation/reset links |
| `NODE_ENV=production`, `PORT` | yes / optional | |
| `UPLOAD_DIR` | recommended | Absolute path on a persistent volume |
| `SMTP_*` | optional | Email (security mail and notifications) |
| `TWILIO_*`, `WHATSAPP_*` | optional | SMS / WhatsApp |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | optional | Online fee payment |

Secrets never go in the web build or the mobile app. Do not commit `.env`.

## Option A — Docker Compose (single host)
```bash
cp api/.env.example .env      # fill in secrets; set ALLOWED_ORIGINS and APP_URL to your public https URL
docker compose up -d --build  # web on :8080, API and MongoDB internal
curl http://localhost:8080/api/v1/health   # {"success":true,"db":"up",...}
```
**Status: the compose file passes `docker compose config`; the images have not been built or run in this repository's
environment (the Docker daemon was not running).** Build and smoke-test before relying on them.

## Option B — without containers
```bash
# API
cd api && npm ci --omit=dev
NODE_ENV=production node src/server.js     # run under systemd/pm2; one instance per database is fine
# Web
cd web && npm ci && npx vite build         # publish web/dist; use web/nginx.conf as the server block
```

## Local development
```bash
cd api && cp .env.example .env && npm install && npm run dev           # needs a MongoDB
# or, with no MongoDB installed:
cd api && npm install && npm run dev:memory                            # in-memory, data lost on exit
cd web && npm install && npm run dev                                   # http://localhost:5175
```
Tests: `cd api && npm test` (143, uses an in-memory MongoDB), `cd web && npm test`, `cd NestTransport && npx jest`.
Lint: `npm run lint` in each project.

## Operations
- **Health**: `GET /api/v1/health` → 200 `{db:"up"}` or 503 `{db:"down"}` (use for load balancer checks).
- **Backups**: `mongodump` (or your provider's snapshots) of the database **and** the uploads volume together; restore both
  from the same point in time. Test a restore.
- **Retention**: GPS history is purged hourly per organization (`gpsRetentionDays`, default 90, set under Settings). Audit logs
  are kept indefinitely; archive them to cold storage if volume becomes a concern.
- **Scaling**: the API is stateless apart from Socket.IO connections and in-process timers (notification jobs, GPS purge).
  Running several API instances works (jobs are idempotent), but Socket.IO then needs a shared adapter (not included).
- **Razorpay**: register `https://<host>/api/v1/billing/razorpay/webhook` for `payment.captured` with the same secret as
  `RAZORPAY_WEBHOOK_SECRET`.
- **Logs**: request logs go to stdout (`morgan`); passwords, tokens and keys are never logged.

## Production checklist
- [ ] Strong, distinct JWT secrets; `NODE_ENV=production`; `ALLOWED_ORIGINS` and `APP_URL` set to the https origin
- [ ] TLS in front; HSTS at the proxy
- [ ] MongoDB not exposed publicly; authentication enabled; backups scheduled and restore tested
- [ ] Uploads volume persistent and backed up
- [ ] SMTP configured (needed for emailed invitations/resets) or admins know to share links by hand
- [ ] Razorpay tested in **test mode** end to end before live keys
- [ ] Mobile app built against the https API URL; background-location behaviour tested on real devices
