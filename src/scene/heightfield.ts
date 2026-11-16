// The DEM as a Float32Array of metres plus fast CPU queries (bilinear height, ray-march).
// Used for mesh building, pin occlusion, camera clamping and picking – we never raycast the mesh.
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';

export class Heightfield {
  readonly cellX: number;
  readonly cellZ: number;
  min = Infinity;
  max = -Infinity;
  maxIndex = 0;

  /** heights[row * size + col]; row 0 = north edge, col 0 = west edge; samples sit at pixel centres. */
  constructor(readonly heights: Float32Array, readonly size: number) {
    this.cellX = WORLD_W / size;
    this.cellZ = WORLD_D / size;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      if (h < this.min) this.min = h;
      if (h > this.max) { this.max = h; this.maxIndex = i; }
    }
  }

  /** Decode a Terrarium-encoded RGBA buffer: h = R·256 + G + B/256 − 32768. */
  static fromTerrarium(rgba: Uint8ClampedArray, size: number): Heightfield {
    const h = new Float32Array(size * size);
    for (let i = 0, p = 0; i < h.length; i++, p += 4) {
      h[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
    }
    return new Heightfield(h, size);
  }

  /** World position (x, z) of a sample. */
  samplePos(col: number, row: number): [number, number] {
    return [WORLD.minX + (col + 0.5) * this.cellX, WORLD.minZ + (row + 0.5) * this.cellZ];
  }

  /** Bilinear height in metres (true scale) at world x, z; clamped at the tile edge. */
  heightAt(x: number, z: number): number {
    const n = this.size;
    let fx = (x - WORLD.minX) / this.cellX - 0.5;
    let fz = (z - WORLD.minZ) / this.cellZ - 0.5;
    fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx;
    fz = fz < 0 ? 0 : fz > n - 1 ? n - 1 : fz;
    const c0 = Math.floor(fx), r0 = Math.floor(fz);
    const c1 = Math.min(c0 + 1, n - 1), r1 = Math.min(r0 + 1, n - 1);
    const tx = fx - c0, tz = fz - r0;
    const H = this.heights;
    const a = H[r0 * n + c0], b = H[r0 * n + c1], c = H[r1 * n + c0], d = H[r1 * n + c1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  inside(x: number, z: number): boolean {
    return x >= WORLD.minX && x <= WORLD.maxX && z >= WORLD.minZ && z <= WORLD.maxZ;
  }

  /**
   * March a ray (origin o, direction d, scene units where y = h·exag) against the heightfield.
   * Returns the distance t of the first hit, or -1. Coarse steps then bisection.
   */
  raymarch(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, exag: number, maxT: number, step = 30): number {
    let prevT = 0;
    let prevAbove = o.y - this.heightAt(o.x, o.z) * exag;
    if (prevAbove < 0) return 0;
    // Grow the step with distance: precise near the camera, cheap far away.
    for (let t = step; t <= maxT; t += step + t * 0.004) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (!this.inside(x, z)) {
        // Outside the tile: the ray can only come back if it heads towards it; stop if moving up.
        if (d.y >= 0) return -1;
        prevT = t; prevAbove = y - this.heightAt(x, z) * exag;
        continue;
      }
      const above = y - this.heightAt(x, z) * exag;
      if (above <= 0) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 12; i++) {
          const m = (lo + hi) / 2;
          const my = o.y + d.y * m;
          if (my - this.heightAt(o.x + d.x * m, o.z + d.z * m) * exag > 0) lo = m; else hi = m;
        }
        return (lo + hi) / 2;
      }
      prevT = t; prevAbove = above;
    }
    void prevAbove;
    return -1;
  }

  /** True if the straight segment a→b passes below the terrain (b itself excluded by `endMargin` metres). */
  occluded(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, exag: number, steps = 64, clearance = 8): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    // Stop shortly before b so the pin's own ground point never occludes itself.
    const len = Math.hypot(dx, dy, dz);
    const end = Math.max(0, 1 - 250 / Math.max(len, 1));
    for (let i = 1; i < steps; i++) {
      const t = (i / steps) * end;
      const y = a.y + dy * t;
      if (y + clearance < this.heightAt(a.x + dx * t, a.z + dz * t) * exag) return true;
    }
    return false;
  }
}
