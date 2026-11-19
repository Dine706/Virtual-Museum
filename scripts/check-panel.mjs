// M4 acceptance check: every hotspot opens with the right FR/EN text, photos + attribution, sources;
// nothing overflows horizontally at 320 px; prev/next, Esc and focus return work.
// Usage: npm run dev (other terminal), then node scripts/check-panel.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';

let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const content = JSON.parse(fs.readFileSync('public/data/content.json', 'utf8'));
const credits = JSON.parse(fs.readFileSync('public/photos/credits.json', 'utf8'));
const creditIds = new Set(credits.map((c) => c.file.split('/').pop().replace(/\.jpg$/, '')));
const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const fail = (m) => { failures.push(m); console.log('FAIL', m); };

for (const [name, opts] of [
  ['phone-320', { viewport: { width: 320, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 } }],
]) {
  const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => fail(`[${name}] pageerror ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) fail(`[${name}] console ${m.type()}: ${m.text()}`); });
  await page.goto(`${BASE}?skipintro=1&tier=low`);
  await page.waitForSelector('body[data-ready="1"]');

  for (const lang of ['fr', 'en']) {
    await page.evaluate((l) => { document.querySelector(`.pill-toggle button[lang="${l}"]`)?.click(); }, lang);
    for (const h of content.hotspots) {
      await page.evaluate((id) => { location.hash = `#/h/${id}`; }, h.id);
      await page.waitForFunction((t) => document.querySelector('#panel-title')?.textContent === t, h[`title_${lang}`], { timeout: 20000 })
        .catch(() => fail(`[${name}/${lang}] ${h.id}: title not shown`));
      const r = await page.evaluate(() => {
        const panel = document.querySelector('#panel');
        const pr = panel.getBoundingClientRect();
        const over = [];
        for (const el of panel.querySelectorAll('*')) {
          if (el.closest('.track') && !el.classList.contains('track')) continue; // slides are scrolled horizontally on purpose
          const b = el.getBoundingClientRect();
          if (b.width && b.right > pr.right + 1) over.push(el.className || el.tagName);
        }
        return {
          docOverflow: document.documentElement.scrollWidth > window.innerWidth,
          over: over.slice(0, 3),
          short: panel.querySelector('.short')?.textContent ?? '',
          long: panel.querySelector('.long')?.textContent ?? '',
          slides: panel.querySelectorAll('.slide').length,
          captions: [...panel.querySelectorAll('.slide figcaption a')].map((a) => a.textContent),
          placeholder: !!panel.querySelector('.placeholder'),
          facts: panel.querySelectorAll('.facts dl > div').length,
          links: [...panel.querySelectorAll('.sources a')].map((a) => ({ href: a.href, target: a.target, rel: a.rel })),
          open: panel.classList.contains('open'),
        };
      });
      const tag = `[${name}/${lang}] ${h.id}`;
      if (!r.open) fail(`${tag}: panel not open`);
      if (r.docOverflow) fail(`${tag}: page scrolls horizontally`);
      if (r.over.length) fail(`${tag}: overflows panel: ${r.over.join(', ')}`);
      if (r.short !== h[`short_${lang}`]) fail(`${tag}: short text mismatch`);
      if (r.long !== h[`long_${lang}`]) fail(`${tag}: long text mismatch`);
      const expectedPhotos = h.photos.filter((p) => creditIds.has(p)).length;
      if (r.slides !== expectedPhotos) fail(`${tag}: ${r.slides} slides, expected ${expectedPhotos}`);
      if (!expectedPhotos && !r.placeholder) fail(`${tag}: missing illustration placeholder`);
      if (r.captions.some((c) => !c.startsWith('© '))) fail(`${tag}: caption without attribution`);
      if (r.facts !== h.facts.length) fail(`${tag}: ${r.facts} facts, expected ${h.facts.length}`);
      if (r.links.length !== h.sources.length) fail(`${tag}: ${r.links.length} sources, expected ${h.sources.length}`);
      for (const l of r.links) if (l.target !== '_blank' || !l.rel.includes('noopener') || !/^https?:/.test(l.href)) fail(`${tag}: bad source link ${l.href}`);
    }
    console.log(`[${name}/${lang}] checked ${content.hotspots.length} hotspots`);
  }

  // Prev / next walk in order; language switch keeps the panel open; Esc closes and returns focus.
  await page.evaluate(() => { location.hash = '#/h/richard-molard'; });
  await page.waitForFunction(() => document.querySelector('#panel.open'));
  await page.click('.foot-next');
  await page.waitForFunction(() => location.hash === '#/h/grands-rochers').catch(() => fail(`[${name}] next did not go to #2`));
  await page.click('.foot-prev');
  await page.click('.foot-prev');
  await page.waitForFunction(() => location.hash === '#/h/danger-list').catch(() => fail(`[${name}] prev did not wrap to #23`));
  await page.evaluate(() => { document.querySelector('.pill-toggle button[lang="fr"]')?.click(); });
  if (!(await page.$('#panel.open'))) fail(`[${name}] language switch closed the panel`);
  await page.keyboard.press('Escape');
  await page.click('.tools .btn-icon:nth-child(2)'); // reset view: all pins back on screen
  await page.waitForTimeout(500);
  const pin = page.locator('.pin[data-id="richard-molard"] button');
  // Reset is an animated camera move; the summit can still be off-screen after 500 ms on software GL.
  await pin.waitFor({ state: 'visible' });
  await pin.focus();
  await page.waitForFunction(() => document.activeElement?.closest('.pin')?.dataset.id === 'richard-molard');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/h/richard-molard', null, { timeout: 15000 }).catch(() => fail(`[${name}] Enter on a pin did not open it`));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#panel.open')).catch(() => fail(`[${name}] Esc did not close`));
  const focusBack = await page.evaluate(() => document.activeElement?.closest('.pin')?.dataset.id);
  if (focusBack !== 'richard-molard') fail(`[${name}] focus not returned to the pin (got ${focusBack})`);
  await ctx.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll panel checks passed');
process.exit(failures.length ? 1 : 0);
