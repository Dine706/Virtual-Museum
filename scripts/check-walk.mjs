// Walk mode check: enter first-person view at several places, wait for the forest to grow, screenshot,
// click (inspect) the centre, record console errors. Usage: npm run dev, then node scripts/check-walk.mjs [tier]
// Screens go to docs/screens/walk-*.png.
import fs from 'node:fs';
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const tier = process.argv[2] || 'mid';
const only = process.argv[3] || '';
const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
fs.mkdirSync('docs/screens', { recursive: true });

// name, lon, lat, yaw (rad, 0 = north), pitch, time
const PLACES = [
  ['cloud-forest', -8.4000, 7.6700, 4.0, 0.1, 'morning'],
  ['summit', -8.4075, 7.6226, 3.14, -0.05, 'morning'],
  ['lowland-forest', -8.4400, 7.6750, 3.14, 0.1, 'noon'],
  ['bossou', -8.5042, 7.6482, 4.71, 0.04, 'morning'],
  ['stream', -8.3990, 7.6800, 0.5, -0.12, 'mist'],
];

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`console ${m.type()}: ${m.text()}`); });
await page.goto(`${BASE}?skipintro=1&debug=1&tier=${tier}`);
await page.waitForSelector('body[data-ready="1"]');

for (const [name, lon, lat, yaw, pitch, time] of PLACES) {
  if (only && name !== only) continue;
  const t0 = Date.now();
  const ok = await page.evaluate(async ([lo, la]) => {
    const n = window.__nimba;
    const w = n.walkDebug();
    if (w) { /* already walking: teleport */ return 'teleport'; }
    return (await n.walk(lo, la)) ? 'walk' : 'fail';
  }, [lon, lat]);
  if (ok === 'teleport') {
    await page.evaluate(([lo, la]) => {
      const KX = 110336.9679982832, KZ = 110574;
      return window.__nimba.walkDebug().teleport((lo + 8.42) * KX, -(la - 7.62) * KZ);
    }, [lon, lat]);
  }
  await page.evaluate(([y, p, tm]) => { const d = window.__nimba.walkDebug(); d.look(y, p); d.setTime(tm); }, [yaw, pitch, time]);
  // let streaming finish
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => { const d = window.__nimba.walkDebug(); return { pos: d.pos, stats: d.stats, habitat: d.habitat }; });
  await page.screenshot({ path: `docs/screens/walk-${name}.png` });
  console.log(name, ok, `${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(info));
}
// Inspect the centre of the last view.
await page.evaluate(() => window.__nimba.walkDebug().inspect(innerWidth / 2, innerHeight / 2));
await page.waitForTimeout(1500);
const card = await page.evaluate(() => document.querySelector('.walk-card:not([hidden])')?.innerText ?? null);
console.log('card:', card?.slice(0, 300));
await page.screenshot({ path: `docs/screens/walk-card.png` });
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
await browser.close();

process.exitCode = errors.length ? 1 : 0;
