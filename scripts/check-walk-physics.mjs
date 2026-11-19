// Run with Node 24+ (native TypeScript stripping); no browser or software-renderer timings involved.
import assert from 'node:assert/strict';
import { advanceWalker } from '../src/walk/movement.ts';

const flat = { height: () => 0, collide: () => {}, min: -100, max: 100 };
const spawn = (y = 0) => ({ x: 0, y, z: 0, vy: 0, grounded: true });
const checks = [];
function check(name, run) { run(); checks.push(name); console.log('PASS', name); }

check('walk distance agrees at 30 and 120 Hz', () => {
  const walk = (hz) => {
    const p = spawn();
    for (let i = 0; i < hz * 5; i++) advanceWalker(p, 1.7 / hz, 0, 1 / hz, false, flat);
    return p;
  };
  assert.ok(Math.abs(walk(30).x - 8.5) < 1e-6);
  assert.ok(Math.abs(walk(120).x - walk(30).x) < 1e-6);
});
check('jump rises, becomes airborne and returns to ground', () => {
  const p = spawn(); let peak = 0;
  for (let i = 0; i < 120; i++) { advanceWalker(p, 0, 0, 1 / 60, i === 0, flat); peak = Math.max(peak, p.y); }
  assert.ok(peak > 0.65 && peak < 0.9); assert.equal(p.y, 0); assert.equal(p.grounded, true);
});
check('cannot jump again in mid-air', () => {
  const a = spawn(), b = spawn();
  for (let i = 0; i < 24; i++) {
    advanceWalker(a, 0, 0, 1 / 60, i === 0, flat);
    advanceWalker(b, 0, 0, 1 / 60, true, flat);
  }
  assert.equal(a.y, b.y);
});
check('steep ascents are blocked; gentle slopes are walkable', () => {
  const steep = spawn(); advanceWalker(steep, 1, 0, 0.1, false, { ...flat, height: (x) => x * 1.5 });
  assert.equal(steep.x, 0);
  const gentle = spawn(); advanceWalker(gentle, 1, 0, 0.1, false, { ...flat, height: (x) => x * 0.4 });
  assert.ok(gentle.x > 0.9); assert.ok(gentle.y >= 0.39);
});
check('capsule collision runs at substeps and prevents tunnelling', () => {
  const p = spawn(); let calls = 0;
  advanceWalker(p, 4, 0, 0.1, false, { ...flat, collide(q) { calls++; if (q.x > 0.5) q.x = 0.5; } });
  assert.ok(calls > 20); assert.equal(p.x, 0.5);
});
check('world boundaries clamp movement', () => {
  const p = spawn(); advanceWalker(p, 2, -2, 0.1, false, { ...flat, min: -1, max: 1 });
  assert.equal(p.x, 1); assert.equal(p.z, -1);
});
check('walking off an edge falls rather than snapping down', () => {
  const p = spawn(3);
  advanceWalker(p, 1, 0, 0.1, false, { ...flat, height: (x) => x < 0.5 ? 3 : 0 });
  assert.equal(p.grounded, false); assert.ok(p.y > 2.8);
});
check('descending walkable ground stays grounded and can immediately jump', () => {
  const p = spawn(); const slope = { ...flat, height: (x) => -0.4 * x };
  for (let i = 0; i < 10; i++) advanceWalker(p, 1.7 / 120, 0, 1 / 120, false, slope);
  assert.equal(p.grounded, true);
  assert.equal(advanceWalker(p, 0, 0, 1 / 60, true, slope), true);
  assert.ok(p.vy > 0);
});
console.log(`${checks.length} physics checks passed`);
