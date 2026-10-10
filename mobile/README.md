# Nest Transport — mobile (React Native, JavaScript)

Role-based app for **drivers and attendants** (trips, route, boarding, reports, emergency, location sharing) plus a compact **management** view (today's numbers, trips, requests to review).

## Run
```bash
cd mobile
npm install
npx react-native-asset            # links the DM Sans fonts (once)
cd ios && bundle exec pod install && cd ..   # iOS only
npm run android     # or: npm run ios
npm test            # logic + screen smoke tests
```
API address: Android emulator reaches your computer at `10.0.2.2:5100` (default). On a real phone use *Server settings* on the login screen to enter `http://<your-computer-ip>:5100/api/v1` (or your deployed HTTPS URL; Android blocks plain HTTP in release builds).

## How it behaves
| Situation | What happens |
|---|---|
| Sign in | Tokens are kept in the OS keychain/keystore; trips and passenger lists are cached on the phone and wiped on sign-out. |
| Confirm ready / Start trip / Finish trip | **Need a connection** so the server can check vehicle and driver availability and the time window (start opens 60 min before departure). Repeats are harmless. |
| Stop reached, boarding, drop-off, missing, delay, breakdown, incident | Saved locally when offline and sent **in order** when the connection returns; each carries an idempotency key so nothing is recorded twice. Rejected updates are listed on the More tab. |
| Emergency | Sent immediately; if offline it is saved **and the screen says it was NOT sent**, with a one-tap call to dispatch. |
| Location | Shared only between Start and Finish. The app shows whether sharing is on, whether background access was granted, the last fix time and how many positions are waiting to upload. |
| App restarted mid-trip | Sharing resumes automatically if the trip is still running. |

## Honest limitations
- **Not run on a device or emulator in this repository's CI**: logic and screens are covered by Jest, and the JavaScript bundles with Metro, but the native Android/iOS builds, permission prompts and background location have **not** been exercised on real hardware. Do that before relying on it.
- Background tracking relies on a foreground service (Android) / background location mode (iOS). Manufacturer battery savers can still suspend apps; the app reports gaps rather than hiding them.
- Push notifications are not implemented (in-app and server-side notifications only).
- The parent/passenger experience is **not built** (it needs a parent role and guardian-to-passenger linking on the server).
- Fonts require `npx react-native-asset`; without it the app falls back to system fonts.
