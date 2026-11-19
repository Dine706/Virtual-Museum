// Feet position and velocity in real metres; independent of rendering and input devices.
export interface Walker { x: number; y: number; z: number; vy: number; grounded: boolean }
export interface MotionWorld {
  height(x: number, z: number): number;
  collide(p: Walker): void;
  min: number;
  max: number;
}
const SLOPE = Math.tan(42 * Math.PI / 180);
const STEP = 0.45;
const RADIUS = 0.35;

export function advanceWalker(p: Walker, dx: number, dz: number, dt: number, jump: boolean, world: MotionWorld) {
  // Substeps keep sprinting and a slow frame from tunnelling through small obstacles.
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.18));
  const jumped = jump && p.grounded;
  if (jumped) { p.vy = 4.6; p.grounded = false; }
  for (let i = 0; i < n; i++) {
    const previousX = p.x, previousZ = p.z;
    const moveAxis = (axis: 'x' | 'z', delta: number) => {
      if (!delta) return;
      const x = axis === 'x' ? p.x + delta : p.x, z = axis === 'z' ? p.z + delta : p.z;
      const h = world.height(x, z);
      // Probe a capsule-sized footprint so generated micro-relief doesn't act like a staircase.
      const before = world.height(p.x, p.z);
      const ex = axis === 'x' ? Math.sign(delta) * RADIUS : 0;
      const ez = axis === 'z' ? Math.sign(delta) * RADIUS : 0;
      const grade = (world.height(x + ex, z + ez) - before) / (Math.abs(delta) + RADIUS);
      if (h > p.y + STEP || (p.grounded && grade > SLOPE)) return;
      p[axis] = Math.max(world.min, Math.min(world.max, p[axis] + delta));
    };
    moveAxis('x', dx / n); moveAxis('z', dz / n);
    world.collide(p);
    if (world.height(p.x, p.z) > p.y + STEP) { p.x = previousX; p.z = previousZ; }
    p.vy -= 14 * dt / n;
    p.y += p.vy * dt / n;
    const floor = world.height(p.x, p.z);
    // Stay attached to walkable descending ground; tiny steps must not repeatedly disable jumping.
    if (p.y <= floor || (p.grounded && p.vy <= 0 && p.y - floor <= STEP)) { p.y = floor; p.vy = 0; p.grounded = true; }
    else p.grounded = false;
  }
  return jumped;
}
