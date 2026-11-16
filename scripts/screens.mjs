// Usage: npm run dev (in another terminal), then: node scripts/screens.mjs [hotspot-id] [--atmo=clear|golden|mist] [--prefix=name]
// Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`
// (falls back to a globally installed Playwright if the project has none).
// Saves docs/screens/<size>-title.png, <size>-home.png and <size>-<hotspot>.png at 390×844, 820×1180, 1440×900.
import fs from 'node:fs';
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const { chromium } = pw;

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const args = process.argv.slice(2);
const hotspot = args.find((a) => !a.startsWith('--')) || 'richard-molard';
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const atmo = opt('atmo');
const prefix = opt('prefix') ? `${opt('prefix')}-` : '';
const only = opt('only'); // phone|tablet|desktop
const extra = atmo ? `&atmo=${atmo}` : '';
fs.mkdirSync('docs/screens', { recursive: true });

const sizes = [
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['tablet', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
].filter(([n]) => !only || n === only);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let problems = 0;

async function shoot(page, url, file, name) {
  await page.goto(url, { waitUntil: 'load' });
  // The app sets <body data-ready="1"> once the terrain has rendered (software GL is slow).
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 }).catch(() => console.log(`[${name}] timed out waiting for ready`));
  await page.waitForTimeout(1800); // let tweens / fades settle
  await page.screenshot({ path: `docs/screens/${prefix}${file}` });
}

for (const [name, opts] of sizes) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|WebGL/i.test(m.text())) { problems++; console.log(`[${name}] ${m.type()}: ${m.text()}`); }
  });
  page.on('pageerror', (e) => { problems++; console.log(`[${name}] pageerror: ${e.message}`); });
  await shoot(page, `${BASE}?debug=1${extra}`, `${name}-title.png`, name);
  await shoot(page, `${BASE}?debug=1&skipintro=1${extra}`, `${name}-home.png`, name);
  await shoot(page, `${BASE}?debug=1&skipintro=1${extra}#/h/${hotspot}`, `${name}-${hotspot}.png`, name);
  await ctx.close();
}
await browser.close();
console.log(`screens saved in docs/screens/ (${problems} console problems)`);
