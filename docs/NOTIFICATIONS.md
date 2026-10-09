# Notifications

## Channels
| Channel | Implementation | Needs | Verified against the real provider? |
|---|---|---|---|
| In-app | built in (bell in the top bar, `/api/v1/notifications`) | nothing | Yes (tests) |
| Email | SMTP via nodemailer | `SMTP_HOST`, `SMTP_FROM` (+ auth vars) | **No** — tested with a stub transport only |
| SMS | Twilio REST API | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | **No** — request shape tested with a mocked `fetch` |
| WhatsApp | Meta Cloud API, plain text | `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN` | **No** — and business-initiated messages outside a 24h conversation need pre-approved templates, which are not implemented |
| Push | not implemented | device registration + service worker/FCM | No |

Use **Notifications → Events & channels → Test** after configuring a provider. The test sends a real message to your own account and shows the provider result.

## How it works
- `notify(event, …)` never throws. It runs after the business change is saved and is not awaited by the request, so a provider outage cannot undo or fail a trip, route or event.
- Recipients = users whose role is in the event's role list, plus explicit people (e.g. the assigned driver, using their login or the phone/email on their staff profile).
- External channels are off for an organization until (a) the server has credentials and (b) an admin enables the channel. Enabling an unconfigured channel is rejected.
- Each external message is stored in `DeliveryAttempt` (masked address in the API, no secrets). Failures retry after 1, 5 and 30 minutes, then become `failed`. Missing credentials give `skipped`.
- De-duplication: in-app is unique per user + key; external is unique per address + key. Scheduled jobs (trip starting soon, document expiry buckets, maintenance due) run every 5 minutes and are safe to repeat; renewing a document re-arms its reminders.
- Personal opt-outs per external channel; in-app cannot be muted.
- Templates are plain text with `{{variables}}`; values are stripped of control characters and never interpreted as HTML.

## Events
trip_assigned, trip_starting_soon, trip_started, trip_delayed, trip_cancelled, vehicle_breakdown, route_changed, document_expiring (vehicle documents + driver licences), maintenance_due, request_approved / request_rejected (wired when transport requests land), test.
