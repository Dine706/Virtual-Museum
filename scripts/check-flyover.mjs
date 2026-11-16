// M7 acceptance check: intro flyover.
//  * the planned path and every rendered frame keep ≥ 150 m (true) above the DEM;
//  * the flyover ends on the default orbit with controls, chrome and pins back;
//  * Esc / tap / "Skip" end it early on the default orbit; the title card's "Passer" skips it;
//  * prefers-reduced-motion: no flyover; a #/h/<id> deep link opens without title card.
// Usage: npm run dev (other terminal), then node scripts/check-flyover.mjs  (saves docs/screens/m7-flyover-*.png)
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures.push(msg); };
const HOME = { lon: -8.425, lat: 7.625 };
const distM = (a, b) => Math.hypot((a.lon - b.lon) * 110337, (a.lat - b.lat) * 110574);

async function open(opts = {}, url = `${BASE}?debug=1&tier=low`) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => check(false, `pageerror ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) check(false, `console: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('body[data-ready="1"]');
  return { ctx, page };
}

// 1. Full flyover.
{
  const { ctx, page } = await open();
  check(await page.isVisible('.title-card'), 'title card shown on arrival');
  await page.screenshot({ path: 'docs/screens/m7-flyover-0-title.png' });
  await page.click('.title-card .btn-primary');
  for (const [ms, name] of [[3000, '1'], [3500, '2'], [3500, '3']]) {
    await page.waitForTimeout(ms);
    await page.screenshot({ path: `docs/screens/m7-flyover-${name}.png` });
  }
  await page.waitForFunction(() => !document.body.classList.contains('flying'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const f = await page.evaluate(() => window.__nimbaFly());
  check(f.planMin >= 150, `planned path min clearance ${f.planMin.toFixed(0)} m (≥ 150)`);
  check(f.frames >= 10 && f.frameMin >= 150, `rendered frames: ${f.frames}, min clearance ${f.frameMin.toFixed(0)} m (≥ 150)`);
  const tgt = await page.evaluate(() => window.__nimba.target());
  check(distM(tgt, HOME) < 50, `ends on the default orbit target (${distM(tgt, HOME).toFixed(0)} m away)`);
  check(await page.evaluate(() => !document.querySelector('.flyover-ui') && getComputedStyle(document.querySelector('.modes')).opacity === '1'), 'subtitles gone, chrome back');
  await page.screenshot({ path: 'docs/screens/m7-flyover-4-end.png' });
  await ctx.close();
}

// 2. Skip with Esc, then with a tap.
for (const how of ['Escape', 'tap']) {
  const { ctx, page } = await open();
  await page.click('.title-card .btn-primary');
  await page.waitForTimeout(2500);
  if (how === 'Escape') await page.keyboard.press('Escape'); else await page.mouse.click(480, 200);
  await page.waitForTimeout(1800);
  const tgt = await page.evaluate(() => window.__nimba.target());
  const flying = await page.evaluate(() => document.body.classList.contains('flying') || !!document.querySelector('.flyover-ui'));
  check(!flying && distM(tgt, HOME) < 50, `skip with ${how}: back on the default orbit (${distM(tgt, HOME).toFixed(0)} m), intro UI gone`);
  await ctx.close();
}

// 3. "Passer" on the title card.
{
  const { ctx, page } = await open();
  await page.click('.title-card .btn-ghost');
  await page.waitForTimeout(1800);
  const tgt = await page.evaluate(() => window.__nimba.target());
  check(distM(tgt, HOME) < 50 && !(await page.$('.flyover-ui')), `title "Passer": default orbit without flyover (${distM(tgt, HOME).toFixed(0)} m)`);
  await ctx.close();
}

// 4. Reduced motion: Explorer goes straight to the orbit.
{
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  await page.click('.title-card .btn-primary');
  await page.waitForTimeout(600);
  const tgt = await page.evaluate(() => window.__nimba.target());
  check(distM(tgt, HOME) < 50 && !(await page.$('.flyover-ui')), `reduced motion: no flyover (${distM(tgt, HOME).toFixed(0)} m)`);
  await ctx.close();
}

// 5. Deep link: no title card, hotspot open.
{
  const { ctx, page } = await open({}, `${BASE}?debug=1&tier=low#/h/cavally`);
  // The panel is code-split: wait for its chunk (and the card's 0.7 s fade).
  await page.waitForSelector('#panel.open', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(!(await page.$('.title-card:not(.hidden)')) && !!(await page.$('#panel.open')), 'deep link #/h/cavally: title card gone (fading), panel open');
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll flyover checks passed');
process.exit(failures.length ? 1 : 0);
