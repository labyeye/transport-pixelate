# Visual check

Seeds a realistic demo organization through the real API, then drives Chrome through every page, saving screenshots and
reporting console errors, 5xx responses and horizontal overflow at phone width.

```bash
cd backend && npm run dev:memory            # API on :5100 with an in-memory database
cd frontend && npx vite --port 5176          # web app
node scripts/visual-check/seed.mjs      # creates asha@greenfield.test / password123
mkdir -p /tmp/shots && npm i --prefix /tmp/pw playwright-core
NODE_PATH=/tmp/pw/node_modules node scripts/visual-check/screenshots.mjs http://localhost:5176 /tmp/shots
```
Set the Chrome path in `screenshots.mjs` if it is not the macOS default. Compare the images against Nest Play side by side;
`docs/UI_CONSISTENCY.md` records what was compared and what differs.
