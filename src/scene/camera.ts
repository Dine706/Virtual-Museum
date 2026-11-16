// Orbit camera helpers: compass azimuth (clockwise from north, camera position relative to target),
// elevation above the horizon, distance. Plus eased fly-to tweens and terrain clearance clamping.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD } from '../data/geo';
import { MIN_CLEARANCE, ORBIT } from './config';
import type { Heightfield } from './heightfield';

const D2R = Math.PI / 180;

export interface OrbitPose { target: THREE.Vector3; azimuthDeg: number; elevationDeg: number; distance: number }

export function poseToPosition(p: OrbitPose, out = new THREE.Vector3()): THREE.Vector3 {
  const az = p.azimuthDeg * D2R, el = p.elevationDeg * D2R;
  return out.set(
    p.target.x + Math.sin(az) * Math.cos(el) * p.distance,
    p.target.y + Math.sin(el) * p.distance,
    p.target.z - Math.cos(az) * Math.cos(el) * p.distance,
  );
}

export function currentPose(camera: THREE.Camera, target: THREE.Vector3): OrbitPose {
  const v = camera.position.clone().sub(target);
  const distance = v.length();
  const elevationDeg = Math.asin(THREE.MathUtils.clamp(v.y / distance, -1, 1)) / D2R;
  let azimuthDeg = Math.atan2(v.x, -v.z) / D2R;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return { target: target.clone(), azimuthDeg, elevationDeg, distance };
}

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement): OrbitControls {
  const c = new OrbitControls(camera, dom);
  c.enableDamping = true;
  c.dampingFactor = 0.08;
  c.minPolarAngle = ORBIT.minPolarDeg * D2R;
  c.maxPolarAngle = ORBIT.maxPolarDeg * D2R;
  c.minDistance = ORBIT.minDistance;
  c.maxDistance = ORBIT.maxDistance;
  c.screenSpacePanning = false; // pan along the ground plane
  c.zoomToCursor = true;
  c.rotateSpeed = 0.6;
  c.zoomSpeed = 1.1;
  c.panSpeed = 0.9;
  c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  return c;
}

/** Keep the target inside the tile and the camera at least MIN_CLEARANCE above the ground. */
export function clampCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, hf: Heightfield, exag: number) {
  const m = 1500;
  target.x = THREE.MathUtils.clamp(target.x, WORLD.minX + m, WORLD.maxX - m);
  target.z = THREE.MathUtils.clamp(target.z, WORLD.minZ + m, WORLD.maxZ - m);
  const groundAtTarget = hf.heightAt(target.x, target.z) * exag;
  if (target.y < groundAtTarget) target.y = groundAtTarget;
  const ground = hf.heightAt(camera.position.x, camera.position.z) * exag;
  const minY = ground + MIN_CLEARANCE * 0.45 * exag;
  if (camera.position.y < minY) camera.position.y = minY;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Animate the orbit pose (shortest way round in azimuth). Returns a frame callback for the stage. */
export function tweenPose(from: OrbitPose, to: OrbitPose, durationMs: number, apply: (p: OrbitPose) => void, done?: () => void) {
  let dAz = to.azimuthDeg - from.azimuthDeg;
  if (dAz > 180) dAz -= 360;
  if (dAz < -180) dAz += 360;
  const start = performance.now();
  const tmp: OrbitPose = { target: new THREE.Vector3(), azimuthDeg: 0, elevationDeg: 0, distance: 0 };
  return (): boolean => {
    const t = Math.min(1, (performance.now() - start) / Math.max(1, durationMs));
    const e = easeInOutCubic(t);
    tmp.target.lerpVectors(from.target, to.target, e);
    tmp.azimuthDeg = from.azimuthDeg + dAz * e;
    tmp.elevationDeg = from.elevationDeg + (to.elevationDeg - from.elevationDeg) * e;
    // Interpolate distance in log space: zooms feel even.
    tmp.distance = Math.exp(Math.log(from.distance) + (Math.log(to.distance) - Math.log(from.distance)) * e);
    apply(tmp);
    if (t >= 1) { done?.(); return false; }
    return true;
  };
}
