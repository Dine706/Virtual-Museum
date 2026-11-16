// Draped GeoJSON overlays (CLAUDE.md §6.5). Currently only the national borders (thin white 40 % dashed):
// the reserve boundary (amber) and mining enclave (terracotta) lines were removed at Dean's request for the
// prototype (see BUILD_NOTES, "Simplification"). Restore them by re-adding their layers below.
// Fat lines (Line2) keep a constant pixel width; dashes are in world metres. Each ring is densified so it
// follows the relief between vertices and lifted a little above the DEM so it never sinks into the mesh.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { lonLatToXZ, WORLD } from '../data/geo';
import type { Regions } from '../data/regions';
import type { Mode } from '../data/content';
import type { Heightfield } from './heightfield';

type Layer = 'borders';

/** Target opacity of each layer per mode (DESIGN.md §7). */
const MODE_OPACITY: Record<Mode, Record<Layer, number>> = {
  nature: { borders: 0 },
  culture: { borders: 0.3 },
  conservation: { borders: 0.4 },
};

const STEP_M = 40; // densify: one vertex every 40 m
const LIFT_M = 25; // true metres above the DEM
const EDGE_MARGIN = 2600; // borders stop before the faded tile edge

export class Overlays {
  readonly group = new THREE.Group();
  private materials = new Map<Layer, LineMaterial[]>();
  private baseWidth = new Map<LineMaterial, number>();
  private opacity: Record<Layer, number> = { borders: 0 };

  constructor(regions: Regions, private hf: Heightfield, private exag: number) {
    for (const line of regions.borders) {
      for (const part of this.clipToInner(line)) {
        this.add('borders', part, { color: '#FFFFFF', width: 1.6, closed: false, dash: [260, 170] });
      }
    }
    this.group.renderOrder = 3;
  }

  private clipToInner(line: [number, number][]): [number, number][][] {
    const inside = (lon: number, lat: number) => {
      const [x, z] = lonLatToXZ(lon, lat);
      return x > WORLD.minX + EDGE_MARGIN && x < WORLD.maxX - EDGE_MARGIN && z > WORLD.minZ + EDGE_MARGIN && z < WORLD.maxZ - EDGE_MARGIN;
    };
    const parts: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const p of line) {
      if (inside(p[0], p[1])) cur.push(p);
      else if (cur.length) { if (cur.length > 1) parts.push(cur); cur = []; }
    }
    if (cur.length > 1) parts.push(cur);
    return parts;
  }

  private add(layer: Layer, ring: [number, number][], o: { color: string; width: number; closed: boolean; dash?: [number, number] }) {
    const pts: number[] = [];
    const xz = ring.map(([lon, lat]) => lonLatToXZ(lon, lat));
    if (o.closed && xz.length) {
      const [a, b] = [xz[0], xz[xz.length - 1]];
      if (a[0] !== b[0] || a[1] !== b[1]) xz.push(a);
    }
    const push = (x: number, z: number) => pts.push(x, (this.hf.heightAt(x, z) + LIFT_M) * this.exag, z);
    for (let i = 0; i < xz.length - 1; i++) {
      const [x0, z0] = xz[i], [x1, z1] = xz[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / STEP_M));
      for (let k = 0; k < n; k++) push(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
    }
    const last = xz[xz.length - 1];
    push(last[0], last[1]);

    const geo = new LineGeometry();
    geo.setPositions(pts);
    const mat = new LineMaterial({
      color: new THREE.Color(o.color).getHex(),
      linewidth: o.width,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      dashed: !!o.dash,
      dashSize: o.dash?.[0] ?? 1,
      gapSize: o.dash?.[1] ?? 1,
      worldUnits: false,
    });
    mat.toneMapped = false;
    this.baseWidth.set(mat, o.width);
    const line = new Line2(geo, mat);
    if (o.dash) line.computeLineDistances();
    line.visible = false;
    line.renderOrder = 3;
    this.group.add(line);
    if (!this.materials.has(layer)) this.materials.set(layer, []);
    this.materials.get(layer)!.push(mat);
  }

  /** Line widths are CSS pixels; thinner on phones so the overlay never swamps a 390 px screen. */
  get state() { return { ...this.opacity }; }

  /** Compile every line shader up front so the first switch to Conservation does not stall on it. */
  precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    for (const c of this.group.children) c.visible = true;
    renderer.compile(scene, camera);
    this.apply();
  }

  setResolution(w: number, h: number) {
    const k = Math.min(w, h) < 600 ? 0.65 : 1;
    for (const mats of this.materials.values()) for (const m of mats) {
      m.resolution.set(w, h);
      m.linewidth = (this.baseWidth.get(m) ?? 2) * k;
    }
  }

  private apply() {
    for (const [layer, mats] of this.materials) {
      const a = this.opacity[layer];
      for (const m of mats) m.opacity = a;
    }
    for (const child of this.group.children) {
      const m = (child as Line2).material as LineMaterial;
      child.visible = m.opacity > 0.005;
    }
  }

  /** Cross-fade to a mode. Returns an animator (or applies instantly when ms = 0). */
  setMode(mode: Mode, ms = 250): ((dt: number, now: number) => boolean) | null {
    const from = { ...this.opacity };
    const to = MODE_OPACITY[mode];
    if (ms <= 0) { this.opacity = { ...to }; this.apply(); return null; }
    const start = performance.now();
    return (_dt, now) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const k = t * t * (3 - 2 * t);
      for (const l of Object.keys(to) as Layer[]) this.opacity[l] = from[l] + (to[l] - from[l]) * k;
      this.apply();
      return t < 1;
    };
  }
}
