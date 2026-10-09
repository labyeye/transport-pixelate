# GPS integration

## Sources
| Source | Path | Authentication | Status |
|---|---|---|---|
| Registered device (generic JSON) | `POST /api/v1/tracking/ingest` | `Authorization: Device <publicId>:<apiKey>` | Implemented, tested against the API only (no physical tracker tested) |
| Driver phone | `POST /api/v1/tracking/mobile/ping` | Driver user JWT | Server side implemented and tested; mobile client arrives in Phase 14 |
| Vendor-specific hardware protocols | adapter in `api/src/modules/tracking/providers/` | per adapter | **None implemented.** Each protocol must be written and tested against the real device |

## Generic payload
Single fix or `{ "pings": [ ... ] }` (max 100, for buffered/offline batches):
```json
{ "lat": 19.076, "lng": 72.8777, "timestamp": "2030-01-15T01:30:00Z", "speedKmh": 32, "heading": 90, "accuracyM": 8 }
```
`timestamp` is the time the fix was taken (device clock). The server stores its own `receivedAt` separately.

## Rules enforced by the server
- Device key is a 256-bit secret; only its SHA-256 is stored. Shown once at creation, rotate to replace. Unknown device and wrong key return the same 401.
- Latitude/longitude range checked; `(0,0)` rejected; timestamps more than 2 min in the future or older than 24 h rejected (per ping; others in a batch still accepted).
- Duplicate (same device + fix time) ignored. A late-arriving older fix is stored in history but never moves the vehicle's latest position backwards.
- Phone locations accepted only while the user is the driver/attendant of an `in_progress`/`delayed` trip; they stop being accepted when the trip ends.
- Freshness: `live` (<=2 min), `stale` (<=15 min), `offline` (>15 min), `no_signal` (never). Computed from fix time, never from receipt time. The UI always shows the last-update timestamp and labels non-live positions as "last known".
- Latest position is a separate `VehiclePosition` document; history is in `LocationPing`. Retention per organization (`gpsRetentionDays`, default 90) is enforced by an hourly purge.

## Realtime
Socket.IO on the API server. The handshake requires a valid access token; sockets join only their own organization's room. Events: `vehicle:position` (tracking-capable roles only) and `trip:status`.

## Adding a provider
Create `providers/<name>.js` exporting `{ key, parse(body) }` returning normalized pings `{ lat, lng, recordedAt, speedKmh?, heading?, accuracyM? }`, register it in `providers/index.js`, and test it with captured traffic from the actual device. Protocols that are not HTTP (raw TCP/UDP such as GT06) need a separate listener process that calls the same `ingest()` service.

## Not verified
No real GPS hardware or third-party fleet API has been connected. Live tracking should be treated as unproven until a real source has been configured and observed end to end.
