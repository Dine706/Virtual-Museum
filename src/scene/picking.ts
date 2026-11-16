// Screen point → ground point by ray-marching the CPU heightfield (CLAUDE.md §6.7): no mesh raycast.
import * as THREE from 'three';
import type { Heightfield } from './heightfield';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function pickGround(clientX: number, clientY: number, canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, hf: Heightfield, exag: number): THREE.Vector3 | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera); // honours the panel view offset (projection matrix)
  const { origin, direction } = raycaster.ray;
  const t = hf.raymarch(origin, direction, exag, 90000, 25);
  if (t < 0) return null;
  const p = origin.clone().addScaledVector(direction, t);
  return hf.inside(p.x, p.z) ? p : null;
}
