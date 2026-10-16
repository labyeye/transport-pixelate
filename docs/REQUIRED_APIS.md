# Nest Transport — Required APIs & Credentials

Date: 2026-10-15. Source: `api/.env.example`, `api/src` env reads, `IMPLEMENTATION_STATUS.md`, `NESTTRANSPORT_VS_FLEETX_AUDIT.md`.

## 1. Pehle se code mein hai — sirf credentials chahiye

| # | Service | Kyun chahiye | Env vars | Kahan se milega | Priority |
|---|---|---|---|---|---|
| 1 | **MongoDB** (Atlas) | Main database | `MONGO_URI` | cloud.mongodb.com | Must |
| 2 | **SMTP** (Brevo / SES / Gmail Workspace / Zoho) | Invitation, password reset, email notifications | `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Koi bhi SMTP provider | Must |
| 3 | **Razorpay** | Passenger fee payment (aur Phase 1 mein SaaS subscription) | `RAZORPAY_KEY_ID` `RAZORPAY_KEY_SECRET` `RAZORPAY_WEBHOOK_SECRET` | dashboard.razorpay.com → API Keys + Webhook (`/api/v1/billing/razorpay/webhook`, event `payment.captured`) | Must (billing ke liye) |
| 4 | **WhatsApp Cloud API — platform number** | Login OTP (AUTHENTICATION template) | `WHATSAPP_PLATFORM_ACCESS_TOKEN` `WHATSAPP_PLATFORM_PHONE_NUMBER_ID` `WHATSAPP_OTP_TEMPLATE_NAME` `WHATSAPP_OTP_TEMPLATE_LANG` `WHATSAPP_OTP_HAS_BUTTON` | developers.facebook.com → WhatsApp; template `user_otp` approve karwao | Must (OTP login) |
| 5 | **WhatsApp Cloud API — notifications** | Trip/delay/doc alerts | `WHATSAPP_PHONE_ID` `WHATSAPP_TOKEN` | Same Meta app | Optional |
| 6 | **Twilio SMS** | SMS alerts | `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM` | twilio.com (India mein DLT registration lagti hai) | Optional |
| 7 | **Map tiles** | Live map / route editor (abhi OSM public tiles) | — | Production load pe MapTiler / Mapbox / Stadia | Production |

Note: WhatsApp business-initiated messages ke liye **approved templates** chahiye — code mein abhi sirf OTP template hai, baaki templates build karne baaki hain.

## 2. Code mein nahi hai — naye APIs jo lene honge

| # | API | Feature | Recommended | Kab |
|---|---|---|---|---|
| 8 | **Routing / Directions / Matrix** | Road distance, stop ETA, route optimisation (abhi sab manual) | OpenRouteService (free tier) / Google Routes / Mapbox Directions / OSRM self-host | Phase 4 |
| 9 | **GPS tracker vendor API ya protocol docs** | Hardware GPS (abhi sirf generic JSON POST) | Tracker model decide karo: JSON/HTTP push chale to bas config; raw TCP/UDP (GT06, Teltonika, AIS-140) ke liye alag listener + protocol spec | Phase 2/5 |
| 10 | **Push notifications — FCM** (+ APNs via FCM) | Driver/parent push (abhi nahi) | Firebase Cloud Messaging, service-account JSON | Phase 3 |
| 11 | **Object storage (S3 / R2 / GCS)** | Documents abhi local disk (`UPLOAD_DIR`) | AWS S3 ya Cloudflare R2 (access key, secret, bucket, region) | Multi-instance deploy se pehle |
| 12 | **Geocoding / Places autocomplete** | Stop add karte waqt address → lat/lng | Google Places / Mapbox / Nominatim | Optional |
| 13 | **Challan / FASTag / Vahan** | Vehicle documents auto-fetch, challan, toll | Surepass / Signzy / Karza / IDfy (paid, KYC lagta hai) | Phase 4, optional |
| 14 | **Virus scan** | Upload scanning | ClamAV (self-host) ya VirusTotal API | Optional |
| 15 | **GST invoice / e-invoice** | Passenger fee invoices pe GST | ClearTax / Masters India (sirf agar threshold cross ho) | Optional |
| 16 | **Maps for parent/mobile app** | RN app maps | Google Maps SDK key (Android/iOS) ya OSM | Phase 3 |

## 3. Minimum set — pehle launch ke liye
1. MongoDB Atlas
2. SMTP
3. Razorpay (SaaS subscription ke liye Nest ka account; passenger fees ke liye tenant ke apne keys — alag rakhna)
4. WhatsApp platform number + `user_otp` template

Baaki sab (SMS, push, routing, S3, FASTag) feature-by-feature jab us phase pe aao tab.

## 4. Pehle decide karne wali cheezein
- **GPS hardware**: kaunsa tracker model? Yahi decide karta hai item 9.
- **Routing provider**: free (ORS/OSRM) vs paid (Google) — ETA accuracy vs cost.
- **Razorpay accounts**: Nest SaaS billing ka alag, tenant fee collection ka alag webhook.
- **Unverified**: SMTP, Twilio, WhatsApp, Razorpay — kabhi live services ke against test nahi hue (per `IMPLEMENTATION_STATUS.md`).
