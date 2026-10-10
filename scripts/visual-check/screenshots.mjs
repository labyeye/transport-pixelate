import { chromium } from "playwright-core"; // npm i playwright-core (uses your installed Chrome)
const BASE = process.argv[2] ?? "http://localhost:5176";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`PAGEERROR ${page.url()} :: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|tile\.openstreetmap|net::ERR/.test(m.text())) problems.push(`CONSOLE ${page.url()} :: ${m.text().slice(0, 200)}`); });
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP${r.status()} ${r.url()}`); });

await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.screenshot({ path: `${process.argv[3]}/00-login.png` });
await page.fill('input[type="email"]', "asha@greenfield.test");
await page.fill('input[type="password"]', "password123");
await page.click('button:has-text("Sign in")');
await page.waitForURL(BASE + "/", { timeout: 15000 });
await page.waitForLoadState("networkidle");

const pages = [["/", "01-dashboard"], ["/vehicles", "02-vehicles"], ["/drivers", "03-drivers"], ["/documents", "04-documents"], ["/routes", "05-routes"], ["/trips", "06-trips"],
  ["/tracking", "07-tracking"], ["/passengers", "08-passengers"], ["/maintenance", "09-maintenance"], ["/fuel-expenses", "10-fuel"], ["/requests", "11-requests"],
  ["/billing", "12-billing"], ["/reports", "13-reports"], ["/notifications", "14-notifications"], ["/settings", "15-settings"]];
for (const [path, name] of pages) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${process.argv[3]}/${name}.png`, fullPage: false });
}
// open a few interactive states
await page.goto(BASE + "/trips", { waitUntil: "networkidle" });
await page.click('button:has-text("TRP-00001")').catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: `${process.argv[3]}/16-trip-detail.png` });
await page.goto(BASE + "/vehicles", { waitUntil: "networkidle" });
await page.click('button:has-text("Add vehicle")').catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${process.argv[3]}/17-vehicle-form.png` });
// responsive check at phone width
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: `${process.argv[3]}/18-mobile-dashboard.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log(JSON.stringify({ horizontalOverflowAt390: overflow, problems }, null, 1));
await browser.close();
