// Walk-mode data (public/walk/, built by scripts/worldpack/build_walk_data.py):
// 15 m tiles of ground height + canopy/land cover in the app frame, measured tree crowns in the hero zones,
// DEM-derived streams and the species walk mode names. A 512 × 512 window around the walker is kept both
// as JS arrays (player height, placement) and as GPU textures (ground mesh, shading) – the same numbers.
import * as THREE from 'three';
import { groundDetail, vnoise } from './noise';

export interface WalkIndex {
  frame: { lon0: number; lat0: number; kx: number; kz: number };
  step: number; tile: number; tiles: number; origin: number;
  height: { h0: number; scale: number };
  zones: ZoneInfo[];
}
export interface ZoneInfo { id: string; cx: number; cz: number; half: number; count: number; file: string; name_fr: string; name_en: string }
export interface Crown { x: number; z: number; h: number; r: number }
export interface SpeciesRef {
  sci: string; fr: string | null; en: string | null; family: string | null; class: string | null; iucn: string;
  records: number; bands: Record<string, number>; sensitive: boolean; gbif: string; wp_fr: string | null; wp_en: string | null;
}
export interface SpeciesData {
  taxa: Record<string, SpeciesRef[]>;
  bands: Record<string, { plants: SpeciesRef[]; birds: SpeciesRef[]; butterflies: SpeciesRef[]; counts: { species: number; plants: number; birds: number } }>;
}
export interface Attr { canopy: number; cls: number; rock: number; streamMask: number }
/** OpenStreetMap building as an oriented rectangle (centre, width along angle a, depth). */
export interface Building { x: number; z: number; w: number; d: number; a: number; kind: string; levels: string | null }
export interface Road { k: string; s?: string; p: number[] }
export interface Place { name: string; kind: string; x: number; z: number }
export interface River { k: string; w: number; name?: string | null; p: number[] }
export interface Area { k: string; name?: string | null; p: number[] }

/** Area classes rasterised from OpenStreetMap land use (2 m field around the walker). */
/** `enclave` = the Guinean mining enclave ("Mine de Nimba" in OSM): exploration, not an open pit – the land keeps its
 *  measured cover and only the card mentions the enclave. `mine` = quarries / brownfields (old LAMCO workings). */
export const AREA = { none: 0, water: 1, mine: 2, field: 3, rock: 4, sand: 5, wetland: 6, enclave: 7 } as const;
const AREA_CODE: Record<string, number> = {
  water: AREA.water, quarry: AREA.mine, brownfield: AREA.mine, industrial: AREA.mine,
  farmland: AREA.field, orchard: AREA.field, cliff: AREA.rock, bare_rock: AREA.rock, scree: AREA.rock, sand: AREA.sand, wetland: AREA.wetland,
};

function bboxHits(p: ArrayLike<number>, x0: number, z0: number, x1: number, z1: number) {
  for (let k = 0; k < p.length; k += 2) if (p[k] >= x0 && p[k] <= x1 && p[k + 1] >= z0 && p[k + 1] <= z1) return true;
  // polygon larger than the box: test the box centre against the polygon bbox
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let k = 0; k < p.length; k += 2) { a = Math.min(a, p[k]); b = Math.max(b, p[k]); c = Math.min(c, p[k + 1]); d = Math.max(d, p[k + 1]); }
  return a < x1 && b > x0 && c < z1 && d > z0;
}

/** Scan-line fill of a polygon (flat x,z array) into a size × size grid starting at (x0, z0) with cell `step`. */
function fillPolygon(p: ArrayLike<number>, x0: number, z0: number, step: number, size: number, put: (k: number) => void) {
  const n = p.length / 2;
  if (n < 3) return;
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < n; k++) { zmin = Math.min(zmin, p[k * 2 + 1]); zmax = Math.max(zmax, p[k * 2 + 1]); }
  const r0 = Math.max(0, Math.ceil((zmin - z0) / step)), r1 = Math.min(size - 1, Math.floor((zmax - z0) / step));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const pz = z0 + r * step;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[((k + 1) % n) * 2], bz = p[((k + 1) % n) * 2 + 1];
      if ((az <= pz && bz > pz) || (bz <= pz && az > pz)) xs.push(ax + (pz - az) / (bz - az) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const c0 = Math.max(0, Math.ceil((xs[q] - x0) / step)), c1 = Math.min(size - 1, Math.floor((xs[q + 1] - x0) / step));
      for (let c = c0; c <= c1; c++) put(r * size + c);
    }
  }
}

/** Half-width (m) of the beaten surface for an OSM highway class. */
export function roadHalfWidth(k: string): number {
  switch (k) {
    case 'trunk': case 'primary': return 4.5;
    case 'secondary': case 'tertiary': return 3.5;
    case 'unclassified': case 'residential': case 'service': return 2.6;
    case 'track': return 1.8;
    default: return 0.65; // path, footway
  }
}

const WIN = 512;            // window size in samples (15 m → 7.68 km)
const SWIN = 512;           // stream field size in samples (2 m → 1.02 km)
const SSTEP = 2;
const SMAX = 25.5;          // metres: stream distance saturates here

interface Tile { h: Float32Array; a: Uint8Array; s: Uint8Array }

async function decode(url: string): Promise<ImageData> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, c.width, c.height);
}

export class WalkData {
  index!: WalkIndex;
  species!: SpeciesData;
  private tiles = new Map<string, Promise<Tile>>();
  private streams: { a: number; p: Float32Array; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  private crowns = new Map<string, Crown[]>();

  // Window (JS copy + textures).
  winX0 = 0; winZ0 = 0;                       // world position of sample (0, 0)
  readonly height = new Float32Array(WIN * WIN);
  readonly attr = new Uint8Array(WIN * WIN * 4); // canopy m, class, rock, stream mask
  readonly heightTex: THREE.DataTexture;
  readonly attrTex: THREE.DataTexture;
  // Stream distance field (m, saturating at SMAX) + width, 2 m grid around the walker.
  sX0 = 0; sZ0 = 0;
  readonly stream = new Uint8Array(SWIN * SWIN * 2);
  readonly streamTex: THREE.DataTexture;
  // Path field: distance to the nearest OSM road/path (0.05 m steps, ≤ 12.75 m) and its half-width (0.05 m steps).
  pX0 = 0; pZ0 = 0;
  readonly path = new Uint8Array(SWIN * SWIN * 2);
  readonly pathTex: THREE.DataTexture;
  // OpenStreetMap (© OpenStreetMap contributors, ODbL): buildings / roads of the loaded 3 km tiles.
  places: Place[] = [];
  private osmTiles = new Map<string, Promise<{ buildings: Building[]; roads: Road[]; areas?: Area[]; rivers?: River[] }>>();
  private osmLoaded = new Map<string, { buildings: Building[]; roads: Road[]; areas?: Area[]; rivers?: River[] }>();
  readonly area = new Uint8Array(SWIN * SWIN);
  readonly areaTex: THREE.DataTexture;
  private bGrid = new Map<string, Building[]>();

  constructor(readonly base: string) {
    this.heightTex = new THREE.DataTexture(this.height, WIN, WIN, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.attrTex = new THREE.DataTexture(this.attr, WIN, WIN, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.attrTex.minFilter = this.attrTex.magFilter = THREE.LinearFilter;
    this.streamTex = new THREE.DataTexture(this.stream, SWIN, SWIN, THREE.RGFormat, THREE.UnsignedByteType);
    this.streamTex.minFilter = this.streamTex.magFilter = THREE.LinearFilter;
    this.uniforms.uHeightTex.value = this.heightTex;
    this.uniforms.uAttrTex.value = this.attrTex;
    this.uniforms.uStreamTex.value = this.streamTex;
    this.areaTex = new THREE.DataTexture(this.area, SWIN, SWIN, THREE.RedFormat, THREE.UnsignedByteType);
    this.areaTex.minFilter = this.areaTex.magFilter = THREE.NearestFilter;
    this.areaTex.needsUpdate = true;
    this.uniforms.uAreaTex.value = this.areaTex;
    this.pathTex = new THREE.DataTexture(this.path, SWIN, SWIN, THREE.RGFormat, THREE.UnsignedByteType);
    this.pathTex.minFilter = this.pathTex.magFilter = THREE.LinearFilter;
    this.path.fill(255);
    this.pathTex.needsUpdate = true;
    this.uniforms.uPathTex.value = this.pathTex;
  }

  async init() {
    const [index, species, streams] = await Promise.all([
      fetch(`${this.base}walk/index.json`).then((r) => r.json() as Promise<WalkIndex>),
      fetch(`${this.base}walk/species.json`).then((r) => r.json() as Promise<SpeciesData>),
      fetch(`${this.base}walk/streams.json`).then((r) => r.json() as Promise<{ a: number; p: number[] }[]>),
    ]);
    this.index = index;
    this.species = species;
    this.streams = streams.map((s) => {
      const p = chaikin(chaikin(s.p));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
        minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
      }
      return { a: s.a, p, minX, maxX, minZ, maxZ };
    });
  }

  get extent() { const i = this.index; return { min: i.origin, max: i.origin + i.tiles * i.tile * i.step }; }

  private tile(i: number, j: number): Promise<Tile> {
    const key = `${i}_${j}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = Promise.all([decode(`${this.base}walk/tiles/${key}_h.png`), decode(`${this.base}walk/tiles/${key}_a.png`)]).then(([h, a]) => {
        const n = h.width * h.height;
        const hh = new Float32Array(n), aa = new Uint8Array(n * 3), ss = new Uint8Array(n);
        const { h0, scale } = this.index.height;
        for (let k = 0; k < n; k++) {
          hh[k] = (h.data[k * 4] * 256 + h.data[k * 4 + 1]) / scale + h0;
          ss[k] = h.data[k * 4 + 2];
          aa[k * 3] = a.data[k * 4]; aa[k * 3 + 1] = a.data[k * 4 + 1]; aa[k * 3 + 2] = a.data[k * 4 + 2];
        }
        return { h: hh, a: aa, s: ss };
      });
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Fill the window centred near (x, z) (snapped to the 15 m grid). */
  async loadWindow(x: number, z: number) {
    const { step, tile, tiles, origin } = this.index;
    const half = (WIN / 2) * step;
    const x0 = origin + Math.round((x - half - origin) / step) * step;
    const z0 = origin + Math.round((z - half - origin) / step) * step;
    const i0 = Math.floor((x0 - origin) / (tile * step)), i1 = Math.floor((x0 + (WIN - 1) * step - origin) / (tile * step));
    const j0 = Math.floor((z0 - origin) / (tile * step)), j1 = Math.floor((z0 + (WIN - 1) * step - origin) / (tile * step));
    const loads: Promise<[number, number, Tile]>[] = [];
    for (let j = Math.max(0, j0); j <= Math.min(tiles - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(tiles - 1, i1); i++) {
        loads.push(this.tile(i, j).then((t) => [i, j, t]));
      }
    }
    const got = await Promise.all(loads);
    const byKey = new Map(got.map(([i, j, t]) => [`${i}_${j}`, t]));
    const tw = tile + 1;
    for (let r = 0; r < WIN; r++) {
      const zz = z0 + r * step;
      let gj = Math.round((zz - origin) / step);
      gj = Math.min(Math.max(gj, 0), tiles * tile);
      const j = Math.min(tiles - 1, Math.floor(gj / tile)), lj = gj - j * tile;
      for (let c = 0; c < WIN; c++) {
        const xx = x0 + c * step;
        let gi = Math.round((xx - origin) / step);
        gi = Math.min(Math.max(gi, 0), tiles * tile);
        const i = Math.min(tiles - 1, Math.floor(gi / tile)), li = gi - i * tile;
        const t = byKey.get(`${i}_${j}`);
        const k = r * WIN + c;
        if (!t) { this.height[k] = 400; this.attr.fill(0, k * 4, k * 4 + 4); continue; }
        const s = lj * tw + li;
        this.height[k] = t.h[s];
        this.attr[k * 4] = t.a[s * 3];
        this.attr[k * 4 + 1] = t.a[s * 3 + 1];
        this.attr[k * 4 + 2] = t.a[s * 3 + 2];
        this.attr[k * 4 + 3] = t.s[s];
      }
    }
    this.winX0 = x0; this.winZ0 = z0;
    this.uniforms.uWin.value.set(x0, z0, step, WIN);
    this.heightTex.needsUpdate = true;
    this.attrTex.needsUpdate = true;
  }

  /** True when (x, z) is far enough from the window centre that it should be reloaded. */
  windowStale(x: number, z: number) {
    const c = this.winX0 + (WIN / 2) * this.index.step, d = this.winZ0 + (WIN / 2) * this.index.step;
    return Math.max(Math.abs(x - c), Math.abs(z - d)) > 1400;
  }

  // ---------------------------------------------------------------- sampling (mirrors the GLSL in ground.ts)

  /** DEM ground (bicubic Catmull-Rom on the 15 m window). */
  baseHeight(x: number, z: number): number {
    const step = this.index.step;
    const fx = (x - this.winX0) / step, fz = (z - this.winZ0) / step;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const row = (r: number) => {
      const rr = Math.min(WIN - 1, Math.max(0, r)) * WIN;
      const s = (c: number) => this.height[rr + Math.min(WIN - 1, Math.max(0, c))];
      return cr(s(ix - 1), s(ix), s(ix + 1), s(ix + 2), tx);
    };
    return cr(row(iz - 1), row(iz), row(iz + 1), row(iz + 2), tz);
  }

  attrAt(x: number, z: number): Attr {
    const step = this.index.step;
    const fx = (x - this.winX0) / step - 0.0, fz = (z - this.winZ0) / step;
    const ix = Math.min(WIN - 2, Math.max(0, Math.floor(fx))), iz = Math.min(WIN - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
    const g = (c: number, r: number, ch: number) => this.attr[(r * WIN + c) * 4 + ch];
    const bl = (ch: number) => {
      const a = g(ix, iz, ch) + (g(ix + 1, iz, ch) - g(ix, iz, ch)) * tx;
      const b = g(ix, iz + 1, ch) + (g(ix + 1, iz + 1, ch) - g(ix, iz + 1, ch)) * tx;
      return a + (b - a) * tz;
    };
    const cls = g(Math.round(fx), Math.round(fz), 1) || g(ix, iz, 1);
    return { canopy: bl(0), cls, rock: bl(2) / 255, streamMask: bl(3) / 255 };
  }

  /** Distance to the nearest stream line (m, ≤ SMAX) and its bed half-width (m). */
  streamAt(x: number, z: number): { dist: number; width: number } {
    const fx = (x - this.sX0) / SSTEP, fz = (z - this.sZ0) / SSTEP;
    if (fx < 0 || fz < 0 || fx >= SWIN - 1 || fz >= SWIN - 1) return { dist: SMAX, width: 1 };
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const g = (c: number, r: number, ch: number) => this.stream[(r * SWIN + c) * 2 + ch];
    const bl = (ch: number) => {
      const a = g(ix, iz, ch) + (g(ix + 1, iz, ch) - g(ix, iz, ch)) * tx;
      const b = g(ix, iz + 1, ch) + (g(ix + 1, iz + 1, ch) - g(ix, iz + 1, ch)) * tx;
      return a + (b - a) * tz;
    };
    return { dist: (bl(0) / 255) * SMAX, width: 0.6 + (bl(1) / 255) * 3.4 };
  }

  /** Ground surface the walker stands on: DEM + micro-relief − stream bed. Mirrors groundHeight() in GLSL. */
  heightAt(x: number, z: number): number {
    const a = this.attrAt(x, z);
    const s = this.streamAt(x, z);
    const k = bedK(s.dist, s.width);
    return this.baseHeight(x, z) + groundDetail(x, z, roughness(a.rock)) * (1 - 0.95 * k) - bedDepth(s.width) * k;
  }

  // ---------------------------------------------------------------- streams

  /** Rasterise, into the 2 m fields around (x, z): distances to streams (DEM-derived lines and OpenStreetMap
   *  rivers/streams; inside OSM lakes the distance is 0, so the bed is carved below the water) and the area
   *  class (water, mine, field, rock, sand, wetland) from OSM land use. */
  updateStreams(x: number, z: number) {
    const x0 = Math.round((x - (SWIN / 2) * SSTEP) / SSTEP) * SSTEP;
    const z0 = Math.round((z - (SWIN / 2) * SSTEP) / SSTEP) * SSTEP;
    const ext = SWIN * SSTEP;
    const dist = new Float32Array(SWIN * SWIN).fill(SMAX);
    const width = new Float32Array(SWIN * SWIN);
    const line = (p: ArrayLike<number>, w: number) => {
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - SMAX - x0) / SSTEP)), c1 = Math.min(SWIN - 1, Math.ceil((Math.max(ax, bx) + SMAX - x0) / SSTEP));
        const r0 = Math.max(0, Math.floor((Math.min(az, bz) - SMAX - z0) / SSTEP)), r1 = Math.min(SWIN - 1, Math.ceil((Math.max(az, bz) + SMAX - z0) / SSTEP));
        if (c0 > c1 || r0 > r1) continue;
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
        for (let r = r0; r <= r1; r++) {
          const pz = z0 + r * SSTEP;
          for (let c = c0; c <= c1; c++) {
            const px = x0 + c * SSTEP;
            const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2));
            const ex = ax + dx * t - px, ez = az + dz * t - pz;
            const d = Math.sqrt(ex * ex + ez * ez);
            const k2 = r * SWIN + c;
            if (d < dist[k2]) { dist[k2] = d; width[k2] = w; }
          }
        }
      }
    };
    for (const s of this.streams) {
      if (s.maxX < x0 - SMAX || s.minX > x0 + ext + SMAX || s.maxZ < z0 - SMAX || s.minZ > z0 + ext + SMAX) continue;
      line(s.p, Math.min(1, Math.sqrt(s.a) / 4));
    }
    // OpenStreetMap rivers and streams (real courses; bed half-width from the mapped width)
    for (const rv of this.osmRivers()) {
      if (!bboxHits(rv.p, x0 - SMAX, z0 - SMAX, x0 + ext + SMAX, z0 + ext + SMAX)) continue;
      line(rv.p, Math.min(1, Math.max(0, (Math.min(rv.w / 2, 4) - 0.6) / 3.4)));
    }
    // OSM area classes; lakes also become "on the stream" (dist 0, widest bed) so the ground is carved under the water
    this.area.fill(0);
    for (const a of this.osmAreas()) {
      const code = a.name === 'Mine de Nimba' ? AREA.enclave : AREA_CODE[a.k];
      if (!code || !bboxHits(a.p, x0, z0, x0 + ext, z0 + ext)) continue;
      fillPolygon(a.p, x0, z0, SSTEP, SWIN, (k) => {
        if (code === AREA.water) { dist[k] = 0; width[k] = 1; }
        if (this.area[k] === 0 || code === AREA.water) this.area[k] = code;
      });
    }
    for (let k = 0; k < dist.length; k++) {
      this.stream[k * 2] = Math.round((dist[k] / SMAX) * 255);
      this.stream[k * 2 + 1] = Math.round(width[k] * 255);
    }
    this.sX0 = x0; this.sZ0 = z0;
    this.uniforms.uSWin.value.set(x0, z0, SSTEP, SWIN);
    this.streamTex.needsUpdate = true;
    this.areaTex.needsUpdate = true;
  }

  /** OSM area class at (x, z) (nearest 2 m cell; 0 outside the field). */
  areaAt(x: number, z: number): number {
    const c = Math.round((x - this.sX0) / SSTEP), r = Math.round((z - this.sZ0) / SSTEP);
    if (c < 0 || r < 0 || c >= SWIN || r >= SWIN) return 0;
    return this.area[r * SWIN + c];
  }

  private osmRivers(): River[] { const o: River[] = []; for (const t of this.osmLoaded.values()) for (const r of t.rivers ?? []) if (!o.includes(r)) o.push(r); return o; }
  osmAreas(): Area[] { const o: Area[] = []; for (const t of this.osmLoaded.values()) for (const a of t.areas ?? []) if (!o.includes(a)) o.push(a); return o; }
  /** OSM rivers near (x, z) (water ribbons). */
  riversNear(x: number, z: number, r: number) { return this.osmRivers().filter((rv) => bboxHits(rv.p, x - r, z - r, x + r, z + r)); }
  /** OSM lakes / reservoirs / pit lakes near (x, z) (water surfaces). */
  lakesNear(x: number, z: number, r: number) { return this.osmAreas().filter((a) => AREA_CODE[a.k] === AREA.water && bboxHits(a.p, x - r, z - r, x + r, z + r)); }

  streamStale(x: number, z: number) {
    const c = this.sX0 + (SWIN / 2) * SSTEP, d = this.sZ0 + (SWIN / 2) * SSTEP;
    return Math.max(Math.abs(x - c), Math.abs(z - d)) > 200;
  }

  /** Stream polylines near (x, z) (for water ribbons). */
  streamsNear(x: number, z: number, r: number) {
    return this.streams.filter((s) => s.maxX > x - r && s.minX < x + r && s.maxZ > z - r && s.minZ < z + r);
  }

  // ---------------------------------------------------------------- hero-zone crowns

  zoneAt(x: number, z: number, margin = 0): ZoneInfo | null {
    return this.index.zones.find((zn) => Math.abs(x - zn.cx) < zn.half + margin && Math.abs(z - zn.cz) < zn.half + margin) ?? null;
  }

  async loadCrowns(zone: ZoneInfo): Promise<Crown[]> {
    const have = this.crowns.get(zone.id);
    if (have) return have;
    const buf = await (await fetch(`${this.base}walk/${zone.file}`)).arrayBuffer();
    const v = new DataView(buf);
    const out: Crown[] = [];
    for (let o = 0; o + 6 <= buf.byteLength; o += 6) {
      out.push({ x: zone.cx + v.getInt16(o, true) / 10, z: zone.cz + v.getInt16(o + 2, true) / 10, h: v.getUint8(o + 4) / 4, r: v.getUint8(o + 5) / 10 });
    }
    this.crowns.set(zone.id, out);
    return out;
  }

  // ---------------------------------------------------------------- OpenStreetMap

  async loadPlaces() {
    try {
      const j = await (await fetch(`${this.base}walk/osm/places.json`)).json() as { places: Place[]; tiles: string[] };
      this.places = j.places;
      this.osmAvailable = new Set(j.tiles);
    } catch { this.places = []; }
  }
  private osmAvailable = new Set<string>();

  /** Load the OSM tiles around (x, z) (3 × 3 tiles of 3 km). */
  async loadOsm(x: number, z: number) {
    const { origin } = this.index;
    const T = 3000;
    const ci = Math.floor((x - origin) / T), cj = Math.floor((z - origin) / T);
    const jobs: Promise<void>[] = [];
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const key = `${i}_${j}`;
      if (!this.osmAvailable.has(key) || this.osmTiles.has(key)) continue;
      const pr = fetch(`${this.base}walk/osm/${key}.json`).then((r) => r.json());
      this.osmTiles.set(key, pr);
      jobs.push(pr.then((t) => {
        this.osmLoaded.set(key, t);
        for (const b of t.buildings) {
          const k2 = `${Math.floor(b.x / 16)},${Math.floor(b.z / 16)}`;
          let l = this.bGrid.get(k2);
          if (!l) this.bGrid.set(k2, (l = []));
          if (!l.includes(b)) l.push(b);
        }
      }).catch(() => { this.osmTiles.delete(key); }));
    }
    await Promise.all(jobs);
  }

  /** Buildings whose footprint (+ margin) may contain (x, z). */
  buildingAt(x: number, z: number, margin = 0): Building | null {
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let j = gz - 1; j <= gz + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
      const l = this.bGrid.get(`${i},${j}`);
      if (!l) continue;
      for (const b of l) {
        const dx = x - b.x, dz = z - b.z;
        const c = Math.cos(b.a), s = Math.sin(b.a);
        const u = dx * c + dz * s, v = -dx * s + dz * c;
        if (Math.abs(u) < b.w / 2 + margin && Math.abs(v) < b.d / 2 + margin) return b;
      }
    }
    return null;
  }

  buildingsNear(x: number, z: number, r: number): Building[] {
    const out: Building[] = [];
    const g0 = Math.floor((x - r) / 16), g1 = Math.floor((x + r) / 16), h0 = Math.floor((z - r) / 16), h1 = Math.floor((z + r) / 16);
    for (let j = h0; j <= h1; j++) for (let i = g0; i <= g1; i++) {
      for (const b of this.bGrid.get(`${i},${j}`) ?? []) if (Math.hypot(b.x - x, b.z - z) < r && !out.includes(b)) out.push(b);
    }
    return out;
  }

  roadsNear(x: number, z: number, r: number): Road[] {
    const out = new Set<Road>();
    for (const t of this.osmLoaded.values()) for (const rd of t.roads) {
      const p = rd.p;
      for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < r && Math.abs(p[k + 1] - z) < r) { out.add(rd); break; }
    }
    return [...out];
  }

  /** Nearest named village / town / hamlet. */
  nearestPlace(x: number, z: number): { place: Place; d: number } | null {
    let best: { place: Place; d: number } | null = null;
    for (const p of this.places) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.d) best = { place: p, d };
    }
    return best;
  }

  /** Rasterise OSM roads/paths into the 2 m path field around (x, z). */
  updatePaths(x: number, z: number) {
    const x0 = Math.round((x - (SWIN / 2) * SSTEP) / SSTEP) * SSTEP;
    const z0 = Math.round((z - (SWIN / 2) * SSTEP) / SSTEP) * SSTEP;
    const PMAX = 12.75;
    const dist = new Float32Array(SWIN * SWIN).fill(PMAX);
    const half = new Float32Array(SWIN * SWIN);
    for (const rd of this.roadsNear(x, z, (SWIN / 2) * SSTEP + 20)) {
      const hw = roadHalfWidth(rd.k);
      const p = rd.p;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const R = PMAX;
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / SSTEP)), c1 = Math.min(SWIN - 1, Math.ceil((Math.max(ax, bx) + R - x0) / SSTEP));
        const r0 = Math.max(0, Math.floor((Math.min(az, bz) - R - z0) / SSTEP)), r1 = Math.min(SWIN - 1, Math.ceil((Math.max(az, bz) + R - z0) / SSTEP));
        if (c0 > c1 || r0 > r1) continue;
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
        for (let r = r0; r <= r1; r++) {
          const pz = z0 + r * SSTEP;
          for (let c = c0; c <= c1; c++) {
            const px = x0 + c * SSTEP;
            const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2));
            const ex = ax + dx * t - px, ez = az + dz * t - pz;
            // distance to the road *edge*, so wide roads and narrow paths share one field
            const d = Math.max(0, Math.sqrt(ex * ex + ez * ez) - hw);
            const kk = r * SWIN + c;
            if (d < dist[kk]) { dist[kk] = d; half[kk] = hw; }
          }
        }
      }
    }
    for (let k = 0; k < dist.length; k++) {
      this.path[k * 2] = Math.round(dist[k] / 0.05);
      this.path[k * 2 + 1] = Math.round(Math.min(12.75, half[k]) / 0.05);
    }
    this.pX0 = x0; this.pZ0 = z0;
    this.uniforms.uPWin.value.set(x0, z0, SSTEP, SWIN);
    this.pathTex.needsUpdate = true;
  }

  pathStale(x: number, z: number) {
    const c = this.pX0 + (SWIN / 2) * SSTEP, d = this.pZ0 + (SWIN / 2) * SSTEP;
    return Math.max(Math.abs(x - c), Math.abs(z - d)) > 200;
  }

  /** Distance (m) beyond the edge of the nearest road/path and its half-width; dist 0 = on the beaten surface. */
  pathAt(x: number, z: number): { dist: number; half: number } {
    const fx = (x - this.pX0) / SSTEP, fz = (z - this.pZ0) / SSTEP;
    if (fx < 0 || fz < 0 || fx >= SWIN - 1 || fz >= SWIN - 1) return { dist: 12.75, half: 0 };
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const g = (c: number, r: number, ch: number) => this.path[(r * SWIN + c) * 2 + ch];
    const bl = (ch: number) => {
      const a = g(ix, iz, ch) + (g(ix + 1, iz, ch) - g(ix, iz, ch)) * tx;
      const b = g(ix, iz + 1, ch) + (g(ix + 1, iz + 1, ch) - g(ix, iz + 1, ch)) * tx;
      return a + (b - a) * tz;
    };
    return { dist: bl(0) * 0.05, half: bl(1) * 0.05 };
  }

  /** Uniforms for the GLSL mirror (shared objects; values follow the window). */
  readonly uniforms = {
    uHeightTex: { value: null as unknown as THREE.DataTexture },
    uAttrTex: { value: null as unknown as THREE.DataTexture },
    uStreamTex: { value: null as unknown as THREE.DataTexture },
    uWin: { value: new THREE.Vector4(0, 0, 15, WIN) },
    uSWin: { value: new THREE.Vector4(0, 0, SSTEP, SWIN) },
    uPathTex: { value: null as unknown as THREE.DataTexture },
    uPWin: { value: new THREE.Vector4(0, 0, SSTEP, SWIN) },
    uAreaTex: { value: null as unknown as THREE.DataTexture },
  };
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

export const roughness = (rock: number) => 0.55 + rock * 1.4;

/** Stream bed: a channel ~0.5–1.4 m deep whose banks fade out over ~4× the bed half-width. */
export const bedDepth = (width: number) => 0.35 + width * 0.32;
export function bedK(dist: number, width: number): number {
  const t = Math.min(1, Math.max(0, dist / (width * 4)));
  const s = 1 - t * t * (3 - 2 * t);
  return s * s;
}

/** Chaikin corner cutting: the D8 flow lines zig-zag along the 15 m DEM grid. */
function chaikin(p: ArrayLike<number>): Float32Array {
  const n = p.length / 2;
  if (n < 3) return Float32Array.from(p);
  const out: number[] = [p[0], p[1]];
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
  }
  out.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  return Float32Array.from(out);
}

export const DATA_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uAttrTex;
uniform sampler2D uStreamTex;
uniform vec4 uWin;   // x0, z0, step, size
uniform vec4 uSWin;  // x0, z0, step, size
float hTexel(int c, int r) {
  int n = int(uWin.w) - 1;
  return texelFetch(uHeightTex, ivec2(clamp(c, 0, n), clamp(r, 0, n)), 0).r;
}
float crw(float p0, float p1, float p2, float p3, float t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}
float baseHeight(vec2 p) {
  vec2 f = (p - uWin.xy) / uWin.z;
  vec2 i = floor(f); vec2 t = f - i;
  int ix = int(i.x), iz = int(i.y);
  float r[4];
  for (int k = 0; k < 4; k++) {
    int rr = iz - 1 + k;
    r[k] = crw(hTexel(ix - 1, rr), hTexel(ix, rr), hTexel(ix + 1, rr), hTexel(ix + 2, rr), t.x);
  }
  return crw(r[0], r[1], r[2], r[3], t.y);
}
vec4 attrAt(vec2 p) {
  vec2 uv = ((p - uWin.xy) / uWin.z + 0.5) / uWin.w;
  return texture(uAttrTex, uv); // canopy/255 m, class/255, rock, stream mask
}
vec2 streamAt(vec2 p) {
  vec2 f = (p - uSWin.xy) / uSWin.z;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= uSWin.w - 1.0 || f.y >= uSWin.w - 1.0) return vec2(25.5, 1.0);
  vec2 v = texture(uStreamTex, (f + 0.5) / uSWin.w).rg;
  return vec2(v.r * 25.5, 0.6 + v.g * 3.4);
}
float bedK(float dist, float width) {
  float t = clamp(dist / (width * 4.0), 0.0, 1.0);
  float s = 1.0 - t * t * (3.0 - 2.0 * t);
  return s * s;
}
uniform sampler2D uPathTex;
uniform vec4 uPWin;
/** distance beyond the edge of the nearest OSM road/path (m) and its half-width (m) */
vec2 pathAt(vec2 p) {
  vec2 f = (p - uPWin.xy) / uPWin.z;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= uPWin.w - 1.0 || f.y >= uPWin.w - 1.0) return vec2(12.75, 0.0);
  vec2 v = texture(uPathTex, (f + 0.5) / uPWin.w).rg;
  return v * 12.75;
}
uniform sampler2D uAreaTex;
/** OSM area classes around p, bilinearly blended one-hot: x water, y mine, z field, w rock; sand / wetland via out params. */
vec4 areaW(vec2 p, out float wSand, out float wWet) {
  wSand = 0.0; wWet = 0.0;
  vec2 f = (p - uSWin.xy) / uSWin.z;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= uSWin.w - 1.0 || f.y >= uSWin.w - 1.0) return vec4(0.0);
  ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    float wt = (o.x == 1 ? t.x : 1.0 - t.x) * (o.y == 1 ? t.y : 1.0 - t.y);
    int c = int(texelFetch(uAreaTex, i + o, 0).r * 255.0 + 0.5);
    if (c == 1) acc.x += wt; else if (c == 2) acc.y += wt; else if (c == 3) acc.z += wt; else if (c == 4) acc.w += wt;
    else if (c == 5) wSand += wt; else if (c == 6) wWet += wt;
  }
  return acc;
}
/** Animal / research trails under forest (narrow beaten earth), 0..1. Mirrors trailK() in data.ts. */
float trailK(vec2 p, float forest) {
  if (forest < 0.35) return 0.0;
  float n = vnoise(p / 64.0, 41) + 0.45 * vnoise(p / 21.0, 42);
  return (1.0 - smoothstep(0.012, 0.03, abs(n))) * smoothstep(0.35, 0.6, forest);
}
float groundHeight(vec2 p) {
  vec4 a = attrAt(p);
  vec2 s = streamAt(p);
  float k = bedK(s.x, s.y);
  return baseHeight(p) + groundDetail(p, 0.55 + a.b * 1.4) * (1.0 - 0.95 * k) - (0.35 + s.y * 0.32) * k;
}
`;

/** Animal / research trails under forest (narrow beaten earth), 0..1. Mirrors trailK() in GLSL. */
export function trailK(x: number, z: number, forest: number): number {
  if (forest < 0.35) return 0;
  const n = vnoise(x / 64, z / 64, 41) + 0.45 * vnoise(x / 21, z / 21, 42);
  const a = Math.abs(n);
  const t = Math.min(1, Math.max(0, (a - 0.012) / 0.018));
  const f = Math.min(1, Math.max(0, (forest - 0.35) / 0.25));
  return (1 - t * t * (3 - 2 * t)) * f * f * (3 - 2 * f);
}
