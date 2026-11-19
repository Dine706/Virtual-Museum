// Fixed M1 viewpoints. Screenshot and timing evidence is explicitly software-rendered in this cloud.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const base = process.env.BASE_URL || 'http://localhost:5173/';
const out = process.env.RESULTS_DIR || '/tmp/nimba-m1-quality';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const reports = [];
try {
  for (const [name, tier, options] of [
    ['desktop', 'high', { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }],
    ['phone', 'low', { ...devices['iPhone 13'], deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(options);
    const page = await ctx.newPage(); page.setDefaultTimeout(300000);
    // Compile and warm assets at a smaller viewport on the software renderer, then capture full HD.
    if (name === 'desktop') await page.setViewportSize({ width: 640, height: 360 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${base}?skipintro=1&debug=1&tier=${tier}`);
    await page.waitForSelector('body[data-ready="1"]');
    await page.evaluate(() => window.__nimba.walk(-8.4, 7.67));
    await page.waitForSelector('.walk-veil.off');
    await page.waitForFunction(() => window.__nimba.walkDebug().performance.scansPending === 0);
    if (tier === 'high') {
      await page.waitForFunction(() => window.__nimba.walkDebug().animation?.instances > 0);
      const before = await page.evaluate(() => window.__nimba.walkDebug().animation.animationTime);
      await page.waitForFunction((time) => window.__nimba.walkDebug().animation.animationTime !== time, before);
      console.log('PASS Blender-exported animation advances in the browser');
    }
    await page.evaluate(() => window.__nimba.walkDebug().look(4, 0.1));
    if (name === 'desktop') await page.setViewportSize(options.viewport);
    console.log(name, 'scene and scans ready');
    await page.evaluate(() => window.__nimba.walkDebug().freezeFrame());
    await page.screenshot({ path: `${out}/${name}-z2.png`, timeout: 180000 });
    // Input actionability is tested separately at Low. This capture focuses on the High render,
    // which may take seconds per frame on SwiftShader, so do not wait for two additional paint frames.
    await page.evaluate(() => document.querySelector('.walk-options').click());
    await page.screenshot({ path: `${out}/${name}-settings.png`, timeout: 180000 });
    const evidence = await page.evaluate(() => {
      const d = window.__nimba.walkDebug();
      const gl = document.querySelector('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { position: d.pos, habitat: d.habitat, animation: d.animation, ...d.performance, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', jsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
    });
    reports.push({ name, tier, viewport: options.viewport, warmupViewport: name === 'desktop' ? { width: 640, height: 360 } : options.viewport,
      timingPurpose: 'Software-renderer diagnostics including warmup; not a hardware benchmark', ...evidence, errors });
    assert.equal(evidence.quality, tier);
    assert.equal(evidence.terrainError, false);
    assert.equal(errors.length, 0, errors.join(' | '));
    console.log('PASS', name, 'fixed Z2 screenshots and clean console');
    await ctx.close();
  }
} finally {
  await fs.writeFile(`${out}/results.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
