// M5 acceptance check: terrain picking + readout.
//  * region classification at known places (reserve part, country, enclave, tripoint);
//  * a real click on the summit reads ≈ 1,750 m ± 25; a click in the Liberian lowland says "outside";
//  * the "nearest" button opens that hotspot; a double click flies the camera to the clicked point.
// Usage: npm run dev (other terminal), then node scripts/check-picking.mjs
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures.push(msg); };

const PLACES = [
  // name, lon, lat, expectation
  ['summit Richard-Molard', -8.4083, 7.6219, (d) => d.place.reserve !== null],
  ['Bossou village', -8.5055, 7.6508, (d) => !d.place.reserve && d.place.country === 'GIN'],
  ["N'Zo", -8.3142, 7.6794, (d) => !d.place.reserve && d.place.country === 'GIN'],
  ['Gbakoré', -8.4059, 7.7241, (d) => !d.place.reserve && d.place.country === 'GIN'],
  ['Yekepa (Liberia)', -8.5419, 7.5753, (d) => !d.place.reserve && d.place.country === 'LBR'],
  ['Liberian lowland', -8.55, 7.55, (d) => !d.place.reserve && d.place.country === 'LBR' && d.elevation < 600],
  ['Yéalé (Côte d\'Ivoire)', -8.4222, 7.5279, (d) => !d.place.reserve && d.place.country === 'CIV'],
  ['Ivorian lowland', -8.32, 7.50, (d) => !d.place.reserve && d.place.country === 'CIV'],
  ['Côte d\'Ivoire reserve part', -8.43, 7.58, (d) => d.place.reserve === 'CIV'],
  ['tripoint', -8.47222, 7.55556, (d) => d.place.nearTripoint],
  // Inside the OSM polygon (its area centroid, used by the hotspot, falls just outside: the polygon is concave).
  ['mining enclave (inside OSM polygon)', -8.3751, 7.6586, (d) => d.place.enclave],
];

for (const [name, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => check(false, `[${name}] pageerror ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) check(false, `[${name}] console: ${m.text()}`); });
  await page.goto(`${BASE}?skipintro=1&debug=1`);
  await page.waitForSelector('body[data-ready="1"]');

  if (name === 'desktop') {
    for (const [label, lon, lat, ok] of PLACES) {
      const d = await page.evaluate(([a, b]) => window.__nimba.describe(a, b), [lon, lat]);
      check(ok(d), `${label}: ${JSON.stringify(d.place)} · ${d.elevation.toFixed(0)} m · class ${d.landcover}`);
    }
  }

  const clickAt = async (lon, lat, double = false) => {
    await page.evaluate(([a, b]) => window.__nimba.view(a, b, 5000, 200, 60), [lon, lat]);
    await page.waitForTimeout(400);
    const p = await page.evaluate(([a, b]) => window.__nimba.project(a, b), [lon, lat]);
    // +3 px: just below the pin head's hit box, on the ground point itself.
    if (name === 'phone') { await page.touchscreen.tap(p.x, p.y + 3); if (double) { await page.waitForTimeout(80); await page.touchscreen.tap(p.x, p.y + 3); } }
    else if (double) await page.mouse.dblclick(p.x, p.y + 3); else await page.mouse.click(p.x, p.y + 3);
    await page.waitForTimeout(400);
  };

  await clickAt(-8.4083, 7.6219);
  const summit = await page.evaluate(() => document.querySelector('.readout:not([hidden])')?.textContent ?? '');
  const elev = Number((summit.match(/^([\d\s  ,]+)\s*m/) ?? [])[1]?.replace(/[^\d]/g, ''));
  check(Math.abs(elev - 1750) <= 25, `[${name}] summit readout ${elev} m ("${summit.slice(0, 80)}")`);
  check(/réserve \(/.test(summit), `[${name}] summit is inside the reserve`);

  // The card's ✕ closes it.
  await page.click('.readout-close');
  check(await page.evaluate(() => !document.querySelector('.readout:not([hidden])')), `[${name}] ✕ closes the readout`);

  await clickAt(-8.55, 7.55);
  const lbr = await page.evaluate(() => document.querySelector('.readout:not([hidden])')?.textContent ?? '');
  check(/Hors réserve/.test(lbr) && /Liberia/.test(lbr), `[${name}] Liberian lowland: "${lbr.slice(0, 90)}"`);

  // Nearest → opens that hotspot.
  await page.click('.readout-nearest');
  await page.waitForFunction(() => location.hash.startsWith('#/h/'), null, { timeout: 10000 }).catch(() => {});
  const hash = await page.evaluate(() => location.hash);
  check(hash === '#/h/yekepa-lamco', `[${name}] nearest button opened ${hash}`);
  check(await page.evaluate(() => !document.querySelector('.readout:not([hidden])')), `[${name}] readout dismissed after opening`);
  await page.keyboard.press('Escape');

  // Double click / double tap → camera target moves to the point.
  await page.evaluate(() => window.__nimba.view(-8.42, 7.62, 14000, 215, 45));
  await page.waitForTimeout(300);
  const p = await page.evaluate(() => window.__nimba.project(-8.45, 7.66));
  if (name === 'phone') { await page.touchscreen.tap(p.x, p.y + 3); await page.waitForTimeout(80); await page.touchscreen.tap(p.x, p.y + 3); }
  else await page.mouse.dblclick(p.x, p.y + 3);
  await page.waitForTimeout(800);
  const tgt = await page.evaluate(() => window.__nimba.target());
  const off = Math.hypot((tgt.lon + 8.45) * 110337, (tgt.lat - 7.66) * 110574);
  check(off < 400, `[${name}] double-click flew to the point (target ${off.toFixed(0)} m away)`);
  await ctx.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll picking checks passed');
process.exit(failures.length ? 1 : 0);
