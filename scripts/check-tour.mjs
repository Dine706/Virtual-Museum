// Guided tour: title card → "Visite guidée" → flyover (instant with reduced motion) → four places on foot
// (forest, Bossou, LAMCO pit lake, summit) → back to the map. Steps through with "Suivant" and screenshots
// each stop on a phone and on desktop. Usage: npm run dev, then node scripts/check-tour.mjs
// (BASE_URL=… for another server; SIZES=phone or desktop to run one).
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const fail = (m) => { errors.push(m); console.log('FAIL', m); };
const SIZES = (process.env.SIZES || 'phone,desktop').split(',');

for (const size of SIZES) {
  const ctx = await browser.newContext(size === 'phone'
    ? { ...pw.devices['iPhone 13'], deviceScaleFactor: 1, reducedMotion: 'reduce' }
    : { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => fail(`${size} pageerror ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) fail(`${size} console ${m.type()}: ${m.text()}`); });
  await page.goto(`${BASE}?debug=1&tier=low&fx=0&tourhold=1`); // stops wait for Next (slow software GL)
  await page.waitForSelector('body[data-ready="1"]');
  await page.waitForSelector('.title-card .tour-btn');
  await page.click('.title-card .tour-btn');
  const titles = [];
  for (let stop = 0; stop < 5; stop++) {
    // a stop is up when the card is shown and not loading
    await page.waitForFunction((n) => {
      const el = document.querySelector('.tour.on:not(.busy)');
      return el && (n < 6 ? el.querySelector('.tour-kicker').textContent.includes(`${n}/`) : !el.querySelector('.tour-kicker').textContent.includes('/'));
    }, stop + 2);
    if (stop < 4) await page.waitForFunction(() => document.querySelector('.walk-veil.off'));
    await page.waitForTimeout(stop < 4 ? 6000 : 1500);
    const info = await page.evaluate(() => ({
      kicker: document.querySelector('.tour-kicker').textContent,
      title: document.querySelector('.tour-title').textContent,
      text: document.querySelector('.tour-text').textContent,
      place: document.querySelector('.walk-place')?.innerText.replace(/\n/g, ' ') ?? '',
      walking: document.body.classList.contains('walking'),
    }));
    titles.push(info.title);
    console.log(size, stop + 2, '|', info.title, '|', info.place, '|', info.text.slice(0, 60));
    if (!info.text) fail(`${size} stop ${stop + 2}: empty caption`);
    if (stop < 4 && !info.walking) fail(`${size} stop ${stop + 2}: not in walk mode`);
    if (stop === 4 && info.walking) fail(`${size} end: still in walk mode`);
    if (stop === 1 && !/Bossou/.test(info.place)) fail(`${size} village stop not near Bossou (${info.place})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) fail(`${size} stop ${stop + 2}: horizontal overflow`);
    await page.screenshot({ path: `docs/screens/tour-${size}-${stop + 2}.png` });
    await page.click('.tour-next');
  }
  await page.waitForFunction(() => !document.querySelector('.tour'), null, { timeout: 5000 }).catch(() => fail(`${size}: tour card still there after the end`));
  if (new Set(titles).size !== 5) fail(`${size}: expected 5 distinct stops, got ${titles.join(' / ')}`);
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `${errors.length} problem(s)` : 'tour OK');
process.exit(errors.length ? 1 : 0);
