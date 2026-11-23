// The visitor: eye-level camera, drag to look around, tap the floor to walk there, tap an exhibit to go to
// it, arrows/WASD/ZQSD to walk on a keyboard. Glides are 0.9–1.4 s ease-in-out (instant under reduced motion).
// The visitor never walks through walls, the plinth or the bench.
import * as THREE from 'three';
import { BENCH_BOX, DOOR, EYE, HX, HZ, PLINTH_BOX, type Box, type Pose } from './layout';

const R = 0.42; // body radius
const PITCH_MIN = -0.62, PITCH_MAX = 0.45;

function pushOut(x: number, z: number, b: Box, m: number): [number, number] {
  const x0 = b.min.x - m, x1 = b.max.x + m, z0 = b.min.z - m, z1 = b.max.z + m;
  if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return [x, z];
  const d = [x - x0, x1 - x, z - z0, z1 - z];
  const i = d.indexOf(Math.min(...d));
  return i === 0 ? [x0, z] : i === 1 ? [x1, z] : i === 2 ? [x, z0] : [x, z1];
}

/** Keep a floor point inside the gallery (the doorway is a dead end for now). */
export function clampFloor(x: number, z: number): [number, number] {
  x = THREE.MathUtils.clamp(x, -HX + R, HX - R);
  const inDoor = x > DOOR.x0 + R && x < DOOR.x1 - R;
  z = THREE.MathUtils.clamp(z, -HZ + R, inDoor ? HZ + 0.6 : HZ - R);
  [x, z] = pushOut(x, z, PLINTH_BOX, R);
  [x, z] = pushOut(x, z, BENCH_BOX, R);
  return [x, z];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface VisitorEvents {
  /** a tap (not a drag) at client coordinates */
  onTap: (x: number, y: number) => void;
  onMove: () => void;
  /** first user-driven look or walk (to dismiss the hint) */
  onInteract: () => void;
}

export class Visitor {
  pose: Pose;
  private anim: { from: Pose; to: Pose; t0: number; ms: number; done?: () => void } | null = null;
  private keys = new Set<string>();
  private drag: { x: number; y: number; id: number; moved: boolean; t: number } | null = null;
  private pinch: { d: number; fov: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  baseFov = 54;
  zoom = 1;

  constructor(readonly camera: THREE.PerspectiveCamera, private el: HTMLElement, start: Pose, private ev: VisitorEvents, private reducedMotion: boolean) {
    this.pose = { ...start };
    this.apply();
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get busy() { return !!this.anim || this.keys.size > 0; }

  /** Glide to a pose (shortest turn). */
  glideTo(to: Pose, ms = 1200, done?: () => void) {
    const [x, z] = clampFloor(to.x, to.z);
    const target = { ...to, x, z, yaw: this.pose.yaw + wrapAngle(to.yaw - this.pose.yaw) };
    if (this.reducedMotion || ms <= 0) {
      this.pose = target;
      this.anim = null;
      this.apply();
      done?.();
      return;
    }
    const dist = Math.hypot(x - this.pose.x, z - this.pose.z) + Math.abs(target.yaw - this.pose.yaw) * 1.5;
    this.anim = { from: { ...this.pose }, to: target, t0: performance.now(), ms: Math.min(1400, Math.max(ms * 0.6, ms * Math.min(1, dist / 6))), done };
    this.ev.onMove();
  }

  /** Walk to a floor point, keeping the gaze direction roughly towards it. */
  walkTo(x: number, z: number) {
    const [cx, cz] = clampFloor(x, z);
    const dx = cx - this.pose.x, dz = cz - this.pose.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const yaw = Math.atan2(-dx, -dz);
    this.glideTo({ x: cx, z: cz, yaw, pitch: Math.max(this.pose.pitch, -0.12) }, 600 + d * 120);
  }

  /** Advance animations and keyboard walking; returns true while something moves. */
  update(dt: number, now: number): boolean {
    let moving = false;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.ms);
      const k = ease(t);
      this.pose = {
        x: a.from.x + (a.to.x - a.from.x) * k,
        z: a.from.z + (a.to.z - a.from.z) * k,
        yaw: a.from.yaw + (a.to.yaw - a.from.yaw) * k,
        pitch: a.from.pitch + (a.to.pitch - a.from.pitch) * k,
      };
      if (t >= 1) { this.anim = null; a.done?.(); }
      moving = true;
    }
    if (this.keys.size) {
      const k = this.keys;
      const fwd = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
      const turn = (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0);
      const strafe = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      if (fwd || turn || strafe) {
        this.anim = null;
        this.pose.yaw += turn * dt * 1.6;
        const sp = 2.2 * dt;
        const fx = -Math.sin(this.pose.yaw), fz = -Math.cos(this.pose.yaw);
        const [x, z] = clampFloor(this.pose.x + (fx * fwd - fz * strafe) * sp, this.pose.z + (fz * fwd + fx * strafe) * sp);
        this.pose.x = x; this.pose.z = z;
        moving = true;
      }
    }
    if (moving) this.apply();
    return moving;
  }

  apply() {
    const c = this.camera;
    c.position.set(this.pose.x, EYE, this.pose.z);
    c.rotation.set(this.pose.pitch, this.pose.yaw, 0, 'YXZ');
    const portrait = c.aspect < 1;
    // Keep ≥ ~68° horizontal field of view in portrait (phones) so walls don't feel like a keyhole.
    const vfov = portrait ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(68) / 2) / c.aspect)) : this.baseFov;
    const fov = Math.min(100, vfov) / this.zoom;
    if (Math.abs(c.fov - fov) > 1e-3) { c.fov = fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- input
  private onDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.el.setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.zoom };
      this.drag = null;
      return;
    }
    if (!e.isPrimary) return;
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, t: performance.now() };
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom = THREE.MathUtils.clamp(this.pinch.fov * (d / this.pinch.d), 1, 2.2);
      this.apply();
      this.ev.onMove();
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) this.ev.onInteract();
    d.moved = true;
    this.anim = null;
    // Drag the scene: content follows the finger.
    const k = (THREE.MathUtils.degToRad(this.camera.fov) / this.el.clientHeight) * 1.05;
    this.pose.yaw += dx * k;
    this.pose.pitch = THREE.MathUtils.clamp(this.pose.pitch + dy * k, PITCH_MIN, PITCH_MAX);
    d.x = e.clientX; d.y = e.clientY;
    this.apply();
    this.ev.onMove();
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (!d.moved && e.type === 'pointerup' && performance.now() - d.t < 600) this.ev.onTap(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.anim = null;
    // Wheel walks forwards/backwards along the gaze.
    const step = THREE.MathUtils.clamp(-e.deltaY * 0.004, -0.6, 0.6);
    const [x, z] = clampFloor(this.pose.x - Math.sin(this.pose.yaw) * step, this.pose.z - Math.cos(this.pose.yaw) * step);
    this.pose.x = x; this.pose.z = z;
    this.apply();
    this.ev.onMove();
    this.ev.onInteract();
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('dialog, input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey)) return;
    const codes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
    if (!codes.includes(e.code)) return;
    // Arrow keys on a focused button keep their normal behaviour.
    if (t && t.tagName === 'BUTTON' && e.code.startsWith('Arrow')) return;
    e.preventDefault();
    if (!this.keys.has(e.code)) { this.keys.add(e.code); this.ev.onInteract(); this.ev.onMove(); }
  };
}
