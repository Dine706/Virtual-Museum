// Terrain mesh built once from the heightfield (no GLB download): regular grid over the tile,
// vertex normals from central differences of the heightfield (cheaper than computeVertexNormals).
import * as THREE from 'three';
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';
import type { Heightfield } from './heightfield';

export function buildTerrainGeometry(hf: Heightfield, segments: number, exag: number): THREE.BufferGeometry {
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const dx = WORLD_W / segments, dz = WORLD_D / segments;
  for (let j = 0; j < n; j++) {
    const z = WORLD.minZ + j * dz;
    for (let i = 0; i < n; i++) {
      const x = WORLD.minX + i * dx;
      const k = j * n + i;
      const h = hf.heightAt(x, z) * exag;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      // Central differences on the exaggerated surface.
      const hx = (hf.heightAt(x + dx, z) - hf.heightAt(x - dx, z)) * exag / (2 * dx);
      const hz = (hf.heightAt(x, z + dz) - hf.heightAt(x, z - dz)) * exag / (2 * dz);
      const inv = 1 / Math.hypot(hx, 1, hz);
      nor[k * 3] = -hx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -hz * inv;
      uv[k * 2] = i / segments; uv[k * 2 + 1] = j / segments;
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // Counter-clockwise seen from above (+y): a(NW) → c(SW) → b(NE), b → c → d.
    idx[p++] = a; idx[p++] = c; idx[p++] = b;
    idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
