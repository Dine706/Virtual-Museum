// Walk-mode entry flow on a phone: tap the terrain → readout → "Marcher ici" → walk view (joystick,
// card on tap) → "Carte" returns to the orbit view. Usage: npm run dev, then node scripts/check-walk-flow.mjs
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...pw.devices['iPhone 13'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
const errors = [];
const fail = (m) => { errors.push(m); console.log('FAIL', m); };
page.on('pageerror', (e) => fail(`pageerror ${e.message}`));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) fail(`console ${m.type()}: ${m.text()}`); });

await page.goto(`${BASE}?skipintro=1&debug=1&tier=low`);
await page.waitForSelector('body[data-ready="1"]');
// Look at the cloud-forest slope and tap it.
await page.evaluate(() => window.__nimba.view(-8.40, 7.67, 4000, 200, 50));
await page.waitForTimeout(800);
const pt = await page.evaluate(() => window.__nimba.project(-8.40, 7.67));
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForSelector('.readout-walk', { state: 'visible' });
await page.screenshot({ path: 'docs/screens/walk-flow-1-readout.png' });
await page.tap('.readout-walk');
await page.waitForFunction(() => document.body.classList.contains('walking') && document.querySelector('.walk-veil.off'));
await page.waitForTimeout(5000);
const stickVisible = await page.evaluate(() => !document.querySelector('.walk-stick').hidden);
if (!stickVisible) fail('joystick hidden on a touch device');
// Hash deep link is set while walking.
await page.waitForFunction(() => /^#\/walk\//.test(location.hash), null, { timeout: 10000 }).catch(() => fail('no #/walk/ deep link'));
await page.screenshot({ path: 'docs/screens/walk-flow-2-walk.png' });
// Tap the centre → info card (bottom sheet on phone).
await page.touchscreen.tap(195, 500);
await page.waitForSelector('.walk-card:not([hidden])', { timeout: 15000 }).catch(() => fail('no card after tap'));
await page.screenshot({ path: 'docs/screens/walk-flow-3-card.png' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
if (overflow) fail('horizontal overflow in walk mode');
// Back to the map.
await page.tap('.walk-card-close').catch(() => {});
await page.tap('.walk-exit');
await page.waitForFunction(() => !document.body.classList.contains('walking') && !document.querySelector('.walk-ui'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screens/walk-flow-4-back.png' });
const hash = await page.evaluate(() => location.hash);
if (hash) fail(`hash not cleared on exit: ${hash}`);
console.log(errors.length ? `${errors.length} problem(s)` : 'walk flow OK');
await browser.close();
process.exit(errors.length ? 1 : 0);
