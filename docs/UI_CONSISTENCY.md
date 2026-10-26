# UI consistency: Nest Transport vs Nest Academy

Reference: `sports-pixelate/frontend` (Nest Academy web) and `sports-pixelate/NestSports` (Nest Academy mobile).
Last checked: 2026-10-10.

## How it was checked
1. **Programmatic** — parsed both stylesheets/configs and compared tokens; diffed copied components.
2. **Real browser** — drove Chrome through every Nest Transport page with seeded data (`scripts/visual-check/`), read the
   screenshots, and fixed what looked wrong. Nest Academy's login page was rendered and compared side by side.
3. **Not done**: a side-by-side of Nest Academy's *signed-in* pages (it needs its own database/backend running), pixel diffing,
   dark mode (neither product has one), and any device testing of the mobile app.

## Results
| Area | Result | Evidence |
|---|---|---|
| Colour tokens (`:root` CSS variables) | **Identical** — 39 of 39 | programmatic comparison |
| Tailwind theme (colours, radius, fonts, animations) | **Same** — DM Sans, `hsl(var(--…))` tokens | config comparison |
| Neo-brutalist utilities (`nb-card`, `nb-btn`, `nb-input`, `nb-badge`, `nb-tag-*`, `nb-shadow-*`) | **All present**; global skin rule for `border-2` elements copied | stylesheet comparison |
| Shared components (button, card, dialog, input, label, select, tabs, textarea, badge, toaster, stat card, action modal) | **Copied** from Nest Academy; 74–100% textual similarity (differences are TypeScript removal and formatting) | diff |
| App layout: sidebar (15.5 rem, collapsible, active-item style), header (4 rem), page padding, section grouping | **Same markup/classes** (copied and adapted) | screenshots |
| Dashboard stat cards, filter bars, tables (row density, header style), pagination | **Same classes** as Nest Academy's Students page patterns | screenshots + class comparison |
| Login / register / reset pages | **Rebuilt to Nest Academy's layout** after the first browser pass showed they did not match (split screen, translucent feature chips, "Welcome back", password eye toggle, right-aligned blue link) | side-by-side screenshots |
| Modals, confirmation dialogs, toasts, empty and loading states | Same visual language (black borders, hard shadows, blue header) | screenshots |
| Icons | `lucide-react`, same as Nest Academy | package |
| Responsive | No horizontal overflow at 390 px on the dashboard; stat labels wrap instead of truncating | browser check at 390 px (dashboard only) |
| Mobile app (React Native) | Same palette and DM Sans fonts as NestSports; neo-brutalist cards/buttons | code; **not seen on a device** |

## Deliberate differences
- **Brand**: "Nest Transport" wordmark and truck icon instead of Nest Academy's logo images.
- **No Nest Academy-only features**: trial banner, phone-OTP and passkey login, plan/subscription pages.
- **Header search box removed** (it was not connected to anything).
- **Navigation groups** are transport-specific.

## Defects the browser pass found and fixed
Sidebar links missing and crashing icons (earlier), duplicate "Files" column, "IN PROGRESS"/"Expired …" badges wrapping and
breaking their box, trip numbers wrapping mid-token, brand name invisible on the login hero, truncated stat labels on phones,
and a login page that did not follow Nest Academy's layout.

## Still to eyeball
Pages beyond the dashboard at phone width, the printed receipt, and every mobile screen on a real device.
