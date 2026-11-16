// Intro flyover (CLAUDE.md §6.9): NE high → low pass over Pierre Richaud / Grands Rochers → Richard-Molard
// summit → pull back to the default orbit. Centripetal Catmull-Rom splines for the camera and its look-at
// point, arc-length parametrised (even speed) with a cubic ease-in-out over 12 s. Every frame the camera is
// clamped to ≥ 150 m (true) above the DEM.
import * as THREE from 'three';
import { lonLatToXZ } from '../data/geo';
import { easeInOutCubic } from './camera';
import type { Heightfield } from './heightfield';

export const FLYOVER_MS = 12000;
export const MIN_CLEARANCE_M = 150;

/** Waypoints: lon, lat, height above the terrain (scene metres) – CLAUDE.md §6.9. */
export const FLY_START = { lon: -8.30, lat: 7.74, above: 6000 };
const WAYPOINTS = [
  { lon: -8.37, lat: 7.67, above: 2200 }, // low pass over Pierre Richaud / Grands Rochers
  { lon: -8.4083, lat: 7.6219, above: 1800 }, // Richard-Molard summit
];
/** Look-at points: along the ridge to the SW, then the summit, then on down the ridge towards the tripoint. */
const LOOKS = [
  { lon: -8.40, lat: 7.64 },
  { lon: -8.4083, lat: 7.6219 },
  { lon: -8.4722, lat: 7.5556 },
];

export function groundPoint(hf: Heightfield, exag: number, lon: number, lat: number, above = 0): THREE.Vector3 {
  const [x, z] = lonLatToXZ(lon, lat);
  return new THREE.Vector3(x, hf.heightAt(x, z) * exag + above, z);
}

export function clampAboveTerrain(p: THREE.Vector3, hf: Heightfield, exag: number) {
  const min = (hf.heightAt(p.x, p.z) + MIN_CLEARANCE_M) * exag;
  if (p.y < min) p.y = min;
}

export interface FlyoverPlan {
  camera: THREE.CatmullRomCurve3;
  look: THREE.CatmullRomCurve3;
}

export function planFlyover(hf: Heightfield, exag: number, from: { pos: THREE.Vector3; target: THREE.Vector3 }, to: { pos: THREE.Vector3; target: THREE.Vector3 }): FlyoverPlan {
  const cam = [from.pos.clone(), ...WAYPOINTS.map((w) => groundPoint(hf, exag, w.lon, w.lat, w.above)), to.pos.clone()];
  const look = [from.target.clone(), ...LOOKS.slice(1).map((l) => groundPoint(hf, exag, l.lon, l.lat)), to.target.clone()];
  const camera = new THREE.CatmullRomCurve3(cam, false, 'centripetal');
  camera.arcLengthDivisions = 600;
  return { camera, look: new THREE.CatmullRomCurve3(look, false, 'centripetal') };
}

/** Lowest clearance (true metres above the DEM) along the planned path, before clamping. */
export function minClearance(plan: FlyoverPlan, hf: Heightfield, exag: number, samples = 600): number {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const p = plan.camera.getPointAt(i / samples);
    min = Math.min(min, p.y / exag - hf.heightAt(p.x, p.z));
  }
  return min;
}

/**
 * Returns a stage animator that drives the camera along the plan. `onFrame(t)` reports progress (0–1 in
 * time); `onDone` fires once at the end (not when stopped early via the returned `stop`).
 */
export function runFlyover(
  plan: FlyoverPlan, camera: THREE.PerspectiveCamera, target: THREE.Vector3, hf: Heightfield, exag: number,
  hooks: { onFrame?: (t: number, clearance: number) => void; onDone?: () => void },
) {
  const start = performance.now();
  let stopped = false;
  const animator = (_dt: number, now: number): boolean => {
    if (stopped) return false;
    // rAF timestamps can precede `start` (read with performance.now()) by a few ms: clamp to [0, 1].
    const t = Math.min(1, Math.max(0, (now - start) / FLYOVER_MS));
    const u = easeInOutCubic(t);
    plan.camera.getPointAt(u, camera.position);
    clampAboveTerrain(camera.position, hf, exag);
    plan.look.getPoint(u, target);
    camera.lookAt(target);
    hooks.onFrame?.(t, camera.position.y / exag - hf.heightAt(camera.position.x, camera.position.z));
    if (t >= 1) { hooks.onDone?.(); return false; }
    return true;
  };
  return { animator, stop: () => { stopped = true; } };
}
