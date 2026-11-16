// ESA WorldCover classes (landcover_classes.png, 1008², value = class code) →
//  1. a Uint8Array for the click readout, and
//  2. a softened natural-colour texture for the terrain base colour.
// We colour from the classes instead of albedo_*.jpg because the albedo has a fixed hillshade baked in,
// which contradicts the moving sun of the atmosphere presets (see docs/BUILD_NOTES.md, M1).
import * as THREE from 'three';

export const LANDCOVER_LABELS: Record<number, { fr: string; en: string }> = {
  10: { fr: 'Forêt', en: 'Forest' },
  20: { fr: 'Arbustes', en: 'Shrub' },
  30: { fr: 'Prairie', en: 'Grassland' },
  40: { fr: 'Cultures', en: 'Cropland' },
  50: { fr: 'Bâti', en: 'Built-up' },
  60: { fr: 'Sol nu', en: 'Bare' },
  80: { fr: 'Eau', en: 'Water' },
  90: { fr: 'Zone humide', en: 'Wetland' },
};

// Natural colours (sRGB), sampled to read like a drone photograph of the region in the wet season,
// not the saturated WorldCover legend. Alpha carries a "roughness/canopy" hint for the shader:
// 255 = closed canopy (gets clumpy detail), lower = open ground.
const PALETTE: Record<number, [number, number, number, number]> = {
  10: [44, 66, 36, 255],
  20: [88, 100, 56, 150],
  30: [146, 138, 86, 60],
  40: [150, 134, 88, 90],
  50: [150, 108, 84, 20],
  60: [156, 116, 82, 10],
  80: [46, 74, 82, 0],
  90: [66, 92, 66, 120],
};

export class Landcover {
  constructor(readonly classes: Uint8Array, readonly size: number) {}

  static fromPixels(rgba: Uint8ClampedArray, size: number): Landcover {
    const c = new Uint8Array(size * size);
    for (let i = 0; i < c.length; i++) c[i] = rgba[i * 4];
    return new Landcover(c, size);
  }

  /** Class code at normalised texture coords (u east, v south), nearest pixel. */
  classAtUV(u: number, v: number): number {
    const n = this.size;
    const col = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    const row = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
    return this.classes[row * n + col];
  }

  /** RGBA colour texture with soft class edges (two 3×3 box-blur passes). */
  toTexture(): THREE.DataTexture {
    const n = this.size;
    const a = new Float32Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      const p = PALETTE[this.classes[i]] ?? PALETTE[10];
      a[i * 4] = p[0]; a[i * 4 + 1] = p[1]; a[i * 4 + 2] = p[2]; a[i * 4 + 3] = p[3];
    }
    const b = new Float32Array(a.length);
    const blur = (src: Float32Array, dst: Float32Array, dx: number, dy: number) => {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const xm = Math.max(0, x - dx), xp = Math.min(n - 1, x + dx);
        const ym = Math.max(0, y - dy), yp = Math.min(n - 1, y + dy);
        const i0 = (ym * n + xm) * 4, i1 = (y * n + x) * 4, i2 = (yp * n + xp) * 4;
        for (let k = 0; k < 4; k++) dst[i1 + k] = (src[i0 + k] + src[i1 + k] * 2 + src[i2 + k]) * 0.25;
      }
    };
    blur(a, b, 1, 0); blur(b, a, 0, 1); blur(a, b, 1, 0); blur(b, a, 0, 1);
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i];
    const tex = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }
}
