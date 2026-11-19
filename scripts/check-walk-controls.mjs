// M1: actual keyboard/joystick/gamepad input, settings, pause and map return.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const base = process.env.BASE_URL || 'http://localhost:5173/';
const out = process.env.RESULTS_DIR || '/tmp/nimba-m1';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const reports = [];
try {
  for (const name of ['desktop', 'phone']) {
    const context = await browser.newContext(name === 'phone' ? { ...devices['iPhone 13'], deviceScaleFactor: 1 } : { viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${base}?skipintro=1&debug=1&tier=low&fx=0`);
    await page.waitForSelector('body[data-ready="1"]');
    console.log(name, 'map ready');
    await page.evaluate(() => window.__nimba.walk(-8.4, 7.67));
    await page.waitForSelector('.walk-veil.off');
    console.log(name, 'spawned');
    const frames = (n) => page.evaluate((count) => new Promise((resolve) => {
      const step = () => { if (--count <= 0) resolve(); else requestAnimationFrame(step); }; requestAnimationFrame(step);
    }), n);
    await frames(4);
    const before = await page.evaluate(() => window.__nimba.walkDebug().motion.distance);
    if (name === 'phone') {
      const stick = await page.locator('.walk-stick').boundingBox();
      const touch = await context.newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 35 }] });
      await frames(10);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
      await page.click('.walk-jump');
    } else {
      // Use the keyboard, rather than teleporting, to prove the input-to-movement path.
      await page.keyboard.down('KeyW'); await frames(10); await page.keyboard.up('KeyW');
      await page.keyboard.press('Space');
    }
    await frames(1);
    const jump = await page.evaluate(() => window.__nimba.walkDebug().motion);
    console.log(name, 'jump', JSON.stringify(jump));
    // A single RPC snapshot can arrive after the jump on a busy software renderer. Retain actual
    // measured clearance and the jump count, so this asserts behavior rather than RPC timing.
    assert.ok(jump.jumps > 0 && jump.jumpPeak > 0.1, `${name}: jump input launches the player`);
    await frames(30);
    const after = await page.evaluate(() => window.__nimba.walkDebug().motion);
    console.log(name, 'landed');
    assert.ok(after.distance > before + 0.05, `${name}: player walks from input (${after.distance})`);
    assert.ok(after.grounded, `${name}: player lands`);
    if (name === 'desktop') {
      // Standard gamepad mapping, exercised through the same polling API as a physical device.
      await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', axes: [1, 0, 0.5, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) }] }));
      const yaw = await page.evaluate(() => window.__nimba.walkDebug().motion.yaw);
      await frames(5);
      assert.notEqual(await page.evaluate(() => window.__nimba.walkDebug().motion.yaw), yaw, 'gamepad look changes orientation');
      await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] }));
    }
    await page.click('.walk-options');
    console.log(name, 'settings opened');
    const paused = await page.evaluate(() => window.__nimba.walkDebug().pos);
    await page.keyboard.down('KeyW'); await frames(4); await page.keyboard.up('KeyW');
    assert.deepEqual(await page.evaluate(() => window.__nimba.walkDebug().pos), paused, `${name}: menu pauses movement`);
    await page.locator('#walk-fov').fill('95'); await page.locator('#walk-fov').dispatchEvent('input');
    await page.locator('#walk-sensitivity').fill('1.75'); await page.locator('#walk-sensitivity').dispatchEvent('input');
    await page.locator('#walk-bob').uncheck(); await page.locator('#walk-motion').check();
    await page.locator('#walk-quality').selectOption('high');
    await page.click('.walk-menu button[lang="en"]');
    await assert.equal(await page.locator('#walk-menu-title').textContent(), 'Your exploration');
    const settings = await page.evaluate(() => window.__nimba.walkDebug().motion.settings);
    assert.equal(settings.fov, 95); assert.equal(settings.sensitivity, 1.75);
    assert.equal(settings.headBob, false); assert.equal(settings.reducedMotion, true); assert.equal(settings.quality, 'high');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('nimba.walk.settings.v1'))), settings);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no overflow`);
    await page.screenshot({ path: `${out}/${name}-settings.png` });
    console.log(name, 'settings captured');
    await page.click('.walk-resume');
    await page.screenshot({ path: `${out}/${name}-z2.png` });
    const perf = await page.evaluate(() => ({ ...window.__nimba.walkDebug().performance, jsHeap: performance.memory?.usedJSHeapSize ?? null }));
    reports.push({ name, movementMetres: after.distance - before, ...perf, errors });
    await page.click('.walk-exit');
    await page.waitForFunction(() => !document.body.classList.contains('walking') && !document.querySelector('.walk-menu'));
    assert.equal(errors.length, 0, `${name}: console errors: ${errors.join(' | ')}`);
    console.log('PASS', name, 'movement, jump, landing, settings, language, pause, disposal and map return');
    await context.close();
  }
} finally {
  await fs.writeFile(`${out}/results.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
