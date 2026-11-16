// M8 acceptance check: performance budgets (CLAUDE.md §8) against the production build.
//   npm run build && node scripts/check-perf.mjs
// Serves dist/ with gzip (like Vercel, which uses brotli – slightly smaller), then measures:
//  * bytes transferred until the title card (first meaningful render): mobile ≤ 3 MB, desktop ≤ 5 MB, JS ≤ 250 KB gz;
//  * that the panel chunk, credits and photos are NOT in that first load (code-split / lazy) and AVIF thumbs are used;
//  * time to the title card on throttled networks (400 kbps "3G" and Slow 4G) – network only: this container
//    renders WebGL on the CPU (SwiftShader), so CPU throttling would measure the emulator, not the app;
//  * the FPS watchdog steps down on a slow GPU (SwiftShader is one) and persists the result;
//  * render-on-demand: no frames when idle (high tier: cloud drift stops 20 s after the last input).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const DIST = path.resolve('dist');
const PORT = 4174;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.geojson', '.svg']);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let f = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) f = path.join(f, 'index.html');
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(f);
  let body = fs.readFileSync(f);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (COMPRESS.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) { body = zlib.gzipSync(body, { level: 9 }); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}).listen(PORT);
const BASE = `http://localhost:${PORT}/`;

const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures.push(msg); };
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

/** Load a page, return bytes (encoded) per resource until the title card is ready. */
async function firstLoad(opts, query, throttle) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...throttle });
  // Bytes = the response's Content-Length (our server sets it to the exact, gzipped body size).
  const urls = new Map();
  const sizes = new Map();
  cdp.on('Network.responseReceived', (e) => {
    urls.set(e.requestId, e.response.url);
    const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    sizes.set(e.requestId, Number(h['content-length'] ?? 0));
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${BASE}${query}`);
  await page.waitForSelector('body[data-ready="1"]');
  const ms = Date.now() - t0;
  await page.waitForTimeout(500);
  const res = [];
  for (const [id, url] of urls) res.push({ url: url.replace(BASE, ''), bytes: sizes.get(id) ?? 0 });
  return { ctx, page, ms, res, errors, total: res.reduce((a, r) => a + r.bytes, 0) };
}

// 1. Budgets: bytes to the title card.
for (const [name, opts, query, budget] of [
  ['mobile (mid tier)', PHONE, '?watchdog=0', 3 * 1024 * 1024],
  ['desktop (high tier)', DESKTOP, '?watchdog=0&tier=high', 5 * 1024 * 1024],
]) {
  const r = await firstLoad(opts, query);
  const js = r.res.filter((x) => x.url.endsWith('.js')).reduce((a, x) => a + x.bytes, 0);
  const fonts = r.res.filter((x) => x.url.endsWith('.woff2'));
  console.log(`\n${name}: ${r.res.length} requests, ${kb(r.total)} total`);
  for (const x of [...r.res].sort((a, b) => b.bytes - a.bytes).slice(0, 8)) console.log(`     ${kb(x.bytes).padStart(8)}  ${x.url}`);
  check(r.total <= budget, `${name}: ${kb(r.total)} to the title card (budget ${kb(budget)})`);
  check(js <= 250 * 1024, `${name}: JS ${kb(js)} gz (budget 250 KB)`);
  check(fonts.length <= 2 && fonts.reduce((a, f) => a + f.bytes, 0) <= 90 * 1024, `${name}: ${fonts.length} font files, ${kb(fonts.reduce((a, f) => a + f.bytes, 0))} (budget 2 files ≈ 80 KB)`);
  check(!r.res.some((x) => /panel-|viewer-|credits\.json|photos\//.test(x.url)), `${name}: panel, viewer, credits and photos not in the first load`);
  check(r.errors.length === 0, `${name}: no console errors (${r.errors.join(' | ')})`);
  // Opening a hotspot fetches the panel chunk and AVIF thumbnails.
  await r.page.evaluate(() => { location.hash = '#/h/viviparous-toad'; });
  await r.page.waitForSelector('#panel.open .photo-btn img');
  await r.page.waitForTimeout(1500);
  const imgs = await r.page.$$eval('#panel .photo-btn img', (l) => l.map((i) => i.currentSrc));
  check(imgs.length > 0 && imgs.every((u) => u.endsWith('.avif')), `${name}: panel thumbs served as AVIF (${imgs.map((u) => u.split('/').pop()).join(', ')})`);
  await r.ctx.close();
}

// 2. Throttled network (no CPU throttling, see header).
for (const [name, cond] of [
  ['"3G" 400 kbps, 400 ms RTT', { latency: 400, downloadThroughput: 400_000 / 8, uploadThroughput: 400_000 / 8 }],
  ['Slow 4G 1.6 Mbps, 150 ms RTT', { latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 }],
]) {
  const r = await firstLoad({ ...PHONE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }, '?watchdog=0', cond);
  console.log(`\nmobile on ${name}: title card after ${(r.ms / 1000).toFixed(1)} s (${kb(r.total)})`);
  check(r.ms <= 60000, `mobile on ${name}: interactive in ${(r.ms / 1000).toFixed(1)} s (brief: ≤ 60 s on 3G)`);
  await r.ctx.close();
}

// 3. FPS watchdog on a slow GPU (SwiftShader): steps down and persists.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}?debug=1&watchdog=1`);
  await page.waitForSelector('body[data-ready="1"]');
  const start = await page.evaluate(() => window.__nimba.quality());
  // The title card drifts (continuous frames) → the watchdog measures and steps down.
  await page.waitForFunction(() => window.__nimba.quality().tier === 'low' || (window.__nimba.quality().watchdog ?? []).some((h) => !h.stepped), null, { timeout: 120000 }).catch(() => {});
  const q = await page.evaluate(() => window.__nimba.quality());
  console.log(`\nwatchdog: started ${start.tier} (${start.segments}², DPR ${start.dpr}) → ${q.tier} (${q.segments}², DPR ${q.dpr}); history ${JSON.stringify(q.watchdog)}`);
  check(q.watchdog && q.watchdog.length > 0 && (q.tier === 'low' || q.watchdog.some((h) => !h.stepped)), 'watchdog measured and stepped down to a tier that holds 28 fps, or to low');
  check(q.tier === 'low' ? q.segments === 160 && q.dpr === 1 : true, `low tier applied at runtime: ${q.segments}² mesh, DPR ${q.dpr}`);
  // Persisted for the next visit.
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  const again = await page.evaluate(() => window.__nimba.quality());
  check(again.tier === q.tier, `next visit starts at the saved tier (${again.tier})`);
  await ctx.close();
}

// 4. Render-on-demand on the high tier: cloud drift stops 20 s after the last input.
{
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}?debug=1&skipintro=1&tier=high&watchdog=0`);
  await page.waitForSelector('body[data-ready="1"]');
  const frames = () => page.evaluate(() => window.__nimba.frames());
  const a = await frames();
  await page.waitForTimeout(3000);
  const b = await frames();
  check(b > a, `high tier drifts clouds while recently used (${b - a} frames in 3 s)`);
  await page.waitForTimeout(21000);
  const c = await frames();
  await page.waitForTimeout(3000);
  const d = await frames();
  check(d === c, `idle after 20 s without input: ${d - c} frames in 3 s (expected 0)`);
  await page.mouse.move(300, 200);
  await page.mouse.down(); await page.mouse.move(340, 200, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  check((await frames()) > d, 'renders again on interaction');
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll performance checks passed');
process.exit(failures.length ? 1 : 0);
