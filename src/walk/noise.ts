// Deterministic noise shared by the CPU (player height, placement) and the GPU (ground mesh):
// the same integer hash and interpolation in JS and GLSL, so both agree to the millimetre.

/** 32-bit integer hash of a lattice point → [0, 1). Mirrors `whash` in NOISE_GLSL. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1] with quintic interpolation. */
export function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const u = fade(fx), v = fade(fy);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Ground micro-relief (metres) added to the 30 m DEM: hummocks, roots and ruts the DEM cannot see. */
export function groundDetail(x: number, z: number, rough: number): number {
  return vnoise(x / 41, z / 41, 1) * 1.6 * rough
    + vnoise(x / 13.7, z / 13.7, 2) * 0.45 * rough
    + vnoise(x / 4.3, z / 4.3, 3) * 0.12;
}

/** Small seeded PRNG for procedural geometry. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_GLSL = /* glsl */ `
float whash(ivec2 p, int seed) {
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(seed) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}
float wfade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float vnoise(vec2 p, int seed) {
  vec2 i = floor(p); vec2 f = p - i;
  ivec2 ii = ivec2(i);
  float a = whash(ii, seed), b = whash(ii + ivec2(1, 0), seed);
  float c = whash(ii + ivec2(0, 1), seed), d = whash(ii + ivec2(1, 1), seed);
  float u = wfade(f.x), v = wfade(f.y);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2.0 - 1.0;
}
float groundDetail(vec2 p, float rough) {
  return vnoise(p / 41.0, 1) * 1.6 * rough + vnoise(p / 13.7, 2) * 0.45 * rough + vnoise(p / 4.3, 3) * 0.12;
}
float fbm3(vec2 p, int seed) {
  return vnoise(p, seed) * 0.57 + vnoise(p * 2.03, seed + 7) * 0.29 + vnoise(p * 4.11, seed + 13) * 0.14;
}
`;
