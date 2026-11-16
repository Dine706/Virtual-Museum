// Usage: npm run dev (in another terminal), then: node scripts/screens.mjs [hotspot-id]
// Needs: npm i -D playwright && npx playwright install chromium
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const hotspot = process.argv[2] || 'richard-molard';
fs.mkdirSync('docs/screens', { recursive: true });
const sizes = [
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['tablet', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, opts] of sizes) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log(`[${name}] ${m.type()}: ${m.text()}`); });
  await page.goto(BASE + '?debug=1&skipintro=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);                       // let the terrain build (software GL is slow)
  await page.screenshot({ path: `docs/screens/${name}-home.png` });
  await page.goto(BASE + `?debug=1&skipintro=1#/h/${hotspot}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `docs/screens/${name}-${hotspot}.png` });
  await ctx.close();
}
await browser.close(); console.log('screens saved in docs/screens/');
