# Transport fees & billing

Optional module (Settings → Organization → Modules → Transport fees). Everything else works with it off.

## Money
All amounts are **integers in minor units** (paise). The API never accepts or returns fractional amounts; the web app converts for display. Currency defaults to INR and is configurable per organization.

## Flow
1. **Fee plans** — route fee, pickup-stop fee (replaces the route fee for that stop), or flat fee; monthly / term / one-time.
2. **Passenger discounts & surcharges** — fixed or percentage, optional period window, applied automatically at generation.
3. **Generate invoices** for a period (preview first). Idempotent per passenger+period; each skipped passenger gets a reason. A plan edit never changes invoices already issued.
4. **Payments** — cash / UPI / card / bank / cheque (reference required where meaningful), partial payments supported, overpayment refused, retries with the same `clientRef` return the original, simultaneous payments cannot over-collect.
5. **Adjustments** — new attributed lines with a mandatory reason; cannot push an invoice below what has been paid. Void only when nothing net has been paid; voiding frees the period for regeneration.
6. **Refunds** — separate records, capped by the payment (also under concurrency); the original payment is never edited.
7. **Reconciliation** — mark payments matched to a bank/cash record (once).
8. **Reports** — fee collection and outstanding fees (in the Reports module), plus aging buckets under *Outstanding*.
Every financial change writes an audit-log entry.

## Razorpay (online payments)
Requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and for webhooks `RAZORPAY_WEBHOOK_SECRET`.
- The server creates the order for exactly the invoice balance and stores it.
- **The browser's success callback is never trusted.** `POST /billing/razorpay/verify` checks the HMAC signature (`order_id|payment_id`), then looks the payment up directly with Razorpay and requires `status=captured`, the same order and the same amount before recording anything. If Razorpay can't be reached or the payment isn't captured yet, nothing is recorded (HTTP 202) and the webhook completes it.
- `POST /billing/razorpay/webhook` authenticates the **raw request body** with the webhook secret and records `payment.captured` for orders we created, ignoring unknown orders and amount mismatches (audited).
- Payment ids are unique in the database, so verify + webhook + retries record a payment exactly once.

### Not verified
No live or sandbox Razorpay account has been used. Order creation, payment lookup and the webhook were tested with mocked HTTP and locally computed signatures. Test with Razorpay test-mode keys before enabling in production. Refunds are recorded in this system only; they are **not** sent to Razorpay (do those in the Razorpay dashboard).
