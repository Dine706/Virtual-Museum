// M6 acceptance check: overlays & modes.
//  * country label anchors classify inside the right country;
//  * each mode reaches its target look (terrain grade + border opacity) within 300 ms of the click;
//  * the three modes render visibly different images (mean pixel difference).
// (Reserve/enclave lines, legend and Danger List chip were removed for the prototype – BUILD_NOTES.)
// Usage: npm run dev (other terminal), then node scripts/check-overlays.mjs
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures.push(msg); };

// Small viewport + low tier: software GL frames are slow here, and the timing check measures wall-clock time.
const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => check(false, `pageerror ${e.message}`));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) check(false, `console: ${m.text()}`); });
await page.goto(`${BASE}?skipintro=1&debug=1&tier=low`);
await page.waitForSelector('body[data-ready="1"]');
await page.waitForFunction(() => window.__nimba.modeState().overlays !== null);

for (const [label, lon, lat, test] of [
  ['GUINÉE label', -8.47, 7.705, (d) => d.place.country === 'GIN' && !d.place.nearBorder],
  ['LIBERIA label', -8.535, 7.555, (d) => d.place.country === 'LBR' && !d.place.nearBorder],
  ["CÔTE D'IVOIRE label", -8.34, 7.53, (d) => d.place.country === 'CIV' && !d.place.nearBorder],
]) {
  const d = await page.evaluate(([a, b]) => window.__nimba.describe(a, b), [lon, lat]);
  check(test(d), `${label} anchor: ${JSON.stringify(d.place)}`);
}

const TARGET = {
  nature: { habitat: 0.75, borders: 0, labels: 0 },
  culture: { habitat: 0, borders: 0.3, labels: 6 },
  conservation: { habitat: 0, borders: 0.4, labels: 3 },
};
const images = {};
await page.evaluate(() => window.__nimba.view(-8.41, 7.64, 16000, 215, 45));
for (const mode of ['conservation', 'culture', 'nature']) {
  const idx = { nature: 0, culture: 1, conservation: 2 }[mode];
  const ms = await page.evaluate(async ([i, tgt]) => {
    const t0 = performance.now();
    document.querySelectorAll('.modes button')[i].click();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      const s = window.__nimba.modeState();
      if (Math.abs(s.habitat - tgt.habitat) < 0.01 && Math.abs(s.overlays.borders - tgt.borders) < 0.01) return performance.now() - t0;
      if (performance.now() - t0 > 3000) return -1;
    }
  }, [idx, TARGET[mode]]);
  check(ms >= 0 && ms <= 300, `${mode}: target look reached in ${ms.toFixed(0)} ms`);
  const s = await page.evaluate(() => window.__nimba.modeState());
  check(s.labels.length === TARGET[mode].labels, `${mode}: ${s.labels.length} terrain labels (${s.labels.join(', ')})`);
  check(!(await page.$('.legend')) && !(await page.$('.credit')), `${mode}: no legend, no credit line`);
  await page.waitForTimeout(400);
  images[mode] = (await page.screenshot()).toString('base64');
}

// Mean absolute pixel difference between modes, computed in the page (decode the PNGs with createImageBitmap).
const diffs = await page.evaluate(async (imgs) => {
  const px = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    c.drawImage(bmp, 0, 0);
    return c.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const d = {};
  const P = { nature: await px(imgs.nature), culture: await px(imgs.culture), conservation: await px(imgs.conservation) };
  for (const [a, b] of [['nature', 'culture'], ['culture', 'conservation'], ['nature', 'conservation']]) {
    let s = 0;
    for (let i = 0; i < P[a].length; i += 4) s += Math.abs(P[a][i] - P[b][i]) + Math.abs(P[a][i + 1] - P[b][i + 1]) + Math.abs(P[a][i + 2] - P[b][i + 2]);
    d[`${a}/${b}`] = s / (P[a].length / 4) / 3;
  }
  return d;
}, images);
for (const [k, v] of Object.entries(diffs)) check(v > 4, `${k}: mean pixel difference ${v.toFixed(1)} / 255`);

await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll overlay checks passed');
process.exit(failures.length ? 1 : 0);
