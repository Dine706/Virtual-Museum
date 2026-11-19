// Exercise real High shaders/assets, then capture arrival, orbit, open ridge and forest views.
// This environment uses SwiftShader; frame times are diagnostics, never a hardware GPU benchmark.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.BASE_URL || 'http://localhost:5173/';
const out = process.env.RESULTS_DIR || '/workspace/artifacts/nimba-realism';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  const missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?debug=1&tier=high`);
  await page.waitForSelector('body[data-ready="1"]');
  await page.waitForSelector('.title-card.ready');
  await page.addStyleTag({ content: '.fps { display: none !important; }' });
  const orbit = await page.evaluate(() => window.__nimba.quality());
  assert.equal(orbit.landscape, 1);
  assert.equal(orbit.segments, 1008);
  results.push({ name: 'orbit', ...orbit });
  assert.ok(await page.locator('.title-landscape').evaluate((img) => img.complete && img.naturalWidth > 1500));
  await page.screenshot({ path: `${out}/arrival.png`, timeout: 180000 });
  console.log('PASS generated arrival image is loaded');
  await page.locator('.title-card .actions button').last().click({ force: true });
  await page.waitForSelector('.title-card', { state: 'detached' });
  await page.screenshot({ path: `${out}/massif.png`, timeout: 180000 });
  console.log('PASS High orbit renders');
  for (const view of [
    { name: 'ridge', lon: -8.3958, lat: 7.6397, yaw: 0.4, pitch: -0.04 },
    { name: 'forest', lon: -8.4, lat: 7.67, yaw: 4, pitch: 0.08 },
    { name: 'horizon', lon: -8.4083, lat: 7.6219, yaw: 4, pitch: -0.20 },
  ].filter((view) => !process.env.VIEW || view.name === process.env.VIEW)) {
    console.log('Entering', view.name);
    await page.setViewportSize({ width: 480, height: 300 });
    await page.evaluate(async ({ lon, lat }) => {
      await window.__nimba.walk(lon, lat);
      await window.__nimba.walkDebug().freezeFrame();
    }, view);
    console.log(view.name, 'spawned and first frame frozen');
    await page.waitForSelector('.walk-veil.off');
    await page.waitForFunction(() => window.__nimba.walkDebug().performance.scansPending === 0);
    console.log(view.name, 'all detailed assets loaded');
    assert.ok(await page.evaluate(() => window.__nimba.walkDebug().groundCover.instances > 200));
    await page.evaluate(({ yaw, pitch }) => window.__nimba.walkDebug().look(yaw, pitch), view);
    await page.setViewportSize({ width: 960, height: 600 });
    await page.evaluate(() => window.__nimba.walkDebug().freezeFrame());
    const report = await page.evaluate(() => {
      const d = window.__nimba.walkDebug();
      return { position: d.pos, landscape: d.landscape, trees: d.stats, cover: d.groundCover, quality: d.performance.quality, terrainError: d.performance.terrainError };
    });
    assert.equal(report.quality, 'high');
    assert.equal(report.terrainError, false);
    assert.ok(report.landscape.distantTrees > 100000, 'massif forest, not just a local tree ring');
    assert.ok(report.landscape.horizon >= 20000);
    if (view.name === 'forest') assert.ok(report.cover.middleInstances > 0, '3D plant LOD persists outside the scan radius');
    await page.screenshot({ path: `${out}/${view.name}.png`, timeout: 180000 });
    results.push({ name: view.name, ...report });
    console.log('PASS', view.name, JSON.stringify(report));
    await page.evaluate(() => document.querySelector('.walk-exit').click());
    await page.waitForSelector('body:not(.walking)');
  }
  assert.deepEqual(missing, [], missing.join('\n'));
  assert.deepEqual(errors, [], errors.join('\n'));
  results.push({ errors, missing, renderer: 'Chromium ANGLE / SwiftShader; not a real-GPU benchmark' });
  await ctx.close();
} finally {
  await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
