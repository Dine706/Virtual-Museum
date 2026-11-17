// Procedural plant geometry, all normalised to height 1 (instances scale them to the measured height).
// Each plant type follows the habitat descriptions in content.json (UNESCO / Wikipedia):
// emergent trees with buttresses above the lowland canopy, mossy Parinari-type montane trees, tree ferns
// in wet valleys, oil and raphia palms, Protea bushland at the grassland edge, young regrowth.
import * as THREE from 'three';
import { rng } from './noise';

const V = THREE.Vector3;

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  private base() { return this.pos.length / 3; }

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c = 1) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(c, c, c);
  }

  /** Tube along a path with per-point radii; u wraps the circumference, v follows the length (bark). */
  tube(path: THREE.Vector3[], radii: number[], sides: number, vScale = 1, shade = 1) {
    const b0 = this.base();
    let len = 0;
    const tmp = new V(), up = new V(0, 1, 0), side = new V(), bin = new V(), n = new V();
    for (let i = 0; i < path.length; i++) {
      const t = (i < path.length - 1 ? tmp.subVectors(path[i + 1], path[i]) : tmp.subVectors(path[i], path[i - 1])).normalize();
      side.crossVectors(Math.abs(t.y) > 0.95 ? new V(1, 0, 0) : up, t).normalize();
      bin.crossVectors(t, side).normalize();
      if (i > 0) len += path[i].distanceTo(path[i - 1]);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
        const p = path[i].clone().addScaledVector(n, radii[i]);
        this.vert(p, n, s / sides * Math.max(1, Math.round(radii[0] * 40)), len / Math.max(1e-3, radii[0] * 6.28) * vScale * 0.25, shade);
      }
    }
    for (let i = 0; i < path.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = b0 + i * (sides + 1) + s, b = a + sides + 1;
        this.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  /** Quad card centred at c, spanned by axes ax/ay; normals bent toward `from → c` for soft, volumetric light. */
  card(c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, from: THREE.Vector3 | null, shade: number, uv = [0, 0, 1, 1]) {
    const b0 = this.base();
    const fn = new V().crossVectors(ax, ay).normalize();
    if (fn.y < 0) fn.negate(); // foliage normals face the sky (lit like the canopy above it)
    const out = from ? new V().subVectors(c, from).normalize() : fn;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of corners) {
      const p = c.clone().addScaledVector(ax, sx).addScaledVector(ay, sy);
      const n = from ? new V().subVectors(p, from).normalize().lerp(out, 0.4).normalize() : fn;
      this.vert(p, n, sx > 0 ? uv[2] : uv[0], sy > 0 ? uv[3] : uv[1], shade);
    }
    this.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }

  /** A curved, tapering strip (frond, grass blade, hanging moss): base at `start`, uv v from 0 (base) to 1. */
  strip(points: THREE.Vector3[], widths: number[], across: THREE.Vector3, shade = 1, up?: THREE.Vector3) {
    const b0 = this.base();
    const n = new V();
    for (let i = 0; i < points.length; i++) {
      const t = i < points.length - 1 ? new V().subVectors(points[i + 1], points[i]) : new V().subVectors(points[i], points[i - 1]);
      n.crossVectors(across, t).normalize();
      if (n.y < 0) n.negate();
      if (up) n.lerp(up, 0.85).normalize();
      const v = i / (points.length - 1);
      this.vert(points[i].clone().addScaledVector(across, -widths[i]), n, 0, v, shade);
      this.vert(points[i].clone().addScaledVector(across, widths[i]), n, 1, v, shade);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = b0 + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  get empty() { return this.idx.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export type LeafKind = 'lowland' | 'bigleaf' | 'montane' | 'protea' | 'regrowth' | 'savanna' | 'single';
export type BarkKind = 'brown' | 'grey' | 'mossy' | 'palm' | 'fern' | 'lichen';
export type FrondKind = 'fern' | 'oilpalm' | 'raphia';

export interface PlantGeo {
  trunk: THREE.BufferGeometry | null;
  leaves: THREE.BufferGeometry | null;
  fronds: THREE.BufferGeometry | null;
  moss: THREE.BufferGeometry | null;
  leafKind: LeafKind | null;
  frondKind: FrondKind | null;
  barkKind: BarkKind;
  /** Crown radius / height, and trunk radius / height (collision, picking). */
  crown: number;
  trunkR: number;
}

export type PlantType =
  | 'emergent' | 'canopy' | 'understory' | 'montane' | 'treefern' | 'oilpalm' | 'raphia' | 'protea' | 'savanna' | 'regrowth' | 'pole';

export const PLANT_TYPES: PlantType[] = ['emergent', 'canopy', 'understory', 'montane', 'treefern', 'oilpalm', 'raphia', 'protea', 'savanna', 'regrowth', 'pole'];

/** A wobbly path from `a` in direction `dir`. */
function limb(a: THREE.Vector3, dir: THREE.Vector3, length: number, segs: number, wobble: number, r: () => number, gravity = 0) {
  const pts = [a.clone()];
  const d = dir.clone().normalize();
  const p = a.clone();
  for (let i = 1; i <= segs; i++) {
    d.x += (r() - 0.5) * wobble; d.z += (r() - 0.5) * wobble; d.y += (r() - 0.5) * wobble * 0.5 - gravity;
    d.normalize();
    p.addScaledVector(d, length / segs);
    pts.push(p.clone());
  }
  return pts;
}

const taper = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => r0 + (r1 - r0) * (i / Math.max(1, n - 1)));

function leafClusterAt(b: Builder, p: THREE.Vector3, size: number, crownC: THREE.Vector3, crownR: number, r: () => number, n = 3) {
  for (let k = 0; k < n; k++) {
    const ax = new V(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize();
    const ay = new V().crossVectors(ax, new V(r() - 0.5, 1, r() - 0.5)).normalize();
    const c = p.clone().add(new V((r() - 0.5) * size * 0.6, (r() - 0.5) * size * 0.4, (r() - 0.5) * size * 0.6));
    const s = size * (0.7 + r() * 0.5);
    // inner cards darker (self-shadowing of the crown)
    const depth = Math.min(1, c.distanceTo(crownC) / Math.max(1e-3, crownR));
    const shade = 0.55 + 0.5 * depth;
    b.card(c, ax.multiplyScalar(s), ay.multiplyScalar(s), crownC, shade);
  }
}

function branchTree(b: Builder, leaves: Builder, moss: Builder | null, r: () => number, o: {
  trunkTop: number; trunkR: number; lean: number; limbs: number; limbAngle: [number, number]; limbLen: [number, number];
  children: number; crownR: number; crownC: number; leafSize: number; clusters: number; gravity?: number; flatTop?: boolean; sides?: number;
}) {
  const trunk = limb(new V(0, 0, 0), new V(o.lean * (r() - 0.5), 1, o.lean * (r() - 0.5)), o.trunkTop, 7, o.lean * 0.4, r);
  b.tube(trunk, taper(trunk.length, o.trunkR, o.trunkR * 0.55), o.sides ?? 8);
  const top = trunk[trunk.length - 1];
  const crownC = new V(top.x, o.crownC, top.z);
  const ends: THREE.Vector3[] = [];
  for (let k = 0; k < o.limbs; k++) {
    const az = (k / o.limbs) * Math.PI * 2 + r() * 0.8;
    const el = THREE.MathUtils.degToRad(o.limbAngle[0] + r() * (o.limbAngle[1] - o.limbAngle[0]));
    const dir = new V(Math.cos(az) * Math.sin(el), Math.cos(el), Math.sin(az) * Math.sin(el));
    const startI = Math.max(2, trunk.length - 1 - Math.floor(r() * 3));
    const start = trunk[startI];
    const L = o.limbLen[0] + r() * (o.limbLen[1] - o.limbLen[0]);
    const path = limb(start, dir, L, 4, 0.35, r, o.gravity ?? 0);
    b.tube(path, taper(path.length, o.trunkR * 0.45, o.trunkR * 0.12), 5);
    for (let c = 0; c < o.children; c++) {
      const from = path[1 + Math.floor(r() * (path.length - 1))];
      const cd = dir.clone().add(new V((r() - 0.5) * 1.4, r() * 0.6, (r() - 0.5) * 1.4)).normalize();
      const cp = limb(from, cd, L * (0.35 + r() * 0.3), 3, 0.5, r, (o.gravity ?? 0) * 0.5);
      b.tube(cp, taper(cp.length, o.trunkR * 0.16, o.trunkR * 0.05), 4);
      ends.push(cp[cp.length - 1]);
    }
    ends.push(path[path.length - 1]);
    if (moss && r() < 0.8) {
      // hanging moss strands under the limb
      for (let m = 0; m < 3; m++) {
        const at = path[1 + Math.floor(r() * (path.length - 1))];
        const len = 0.04 + r() * 0.08;
        const pts = [at.clone(), at.clone().add(new V(0, -len * 0.5, 0)), at.clone().add(new V((r() - 0.5) * 0.01, -len, 0))];
        const across = new V(r() - 0.5, 0, r() - 0.5).normalize();
        moss.strip(pts, [o.leafSize * 0.18, o.leafSize * 0.16, o.leafSize * 0.12], across, 1, new V(0, 1, 0));
      }
    }
  }
  // Leaf clusters at the branch ends + fill toward the crown shell.
  for (const e of ends) {
    const pp = e.clone();
    if (o.flatTop) pp.y = Math.min(pp.y, o.crownC + o.crownR * 0.35);
    leafClusterAt(leaves, pp, o.leafSize, crownC, o.crownR, r, 3);
  }
  for (let k = 0; k < o.clusters; k++) {
    const u = r() * Math.PI * 2, v = Math.acos(1 - 2 * r());
    const rr = o.crownR * (0.55 + r() * 0.45);
    const p = new V(Math.cos(u) * Math.sin(v) * rr, Math.cos(v) * rr * (o.flatTop ? 0.38 : 0.7), Math.sin(u) * Math.sin(v) * rr).add(crownC);
    if (p.y < o.trunkTop * 0.75) continue;
    leafClusterAt(leaves, p, o.leafSize, crownC, o.crownR, r, 2);
  }
}

/** Lianas: woody vines hanging in loops from the crown to the forest floor. */
function lianas(b: Builder, r: () => number, n: number, crownR: number, from: number) {
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const top = new V(Math.cos(a) * crownR * (0.4 + r() * 0.5), from + r() * 0.1, Math.sin(a) * crownR * (0.4 + r() * 0.5));
    const foot = new V(top.x * (1.1 + r() * 0.6), 0, top.z * (1.1 + r() * 0.6));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const p = top.clone().lerp(foot, t);
      p.x += Math.sin(t * Math.PI) * crownR * 0.25 * Math.cos(a + 1.3) + (r() - 0.5) * 0.01;
      p.z += Math.sin(t * Math.PI) * crownR * 0.25 * Math.sin(a + 1.3);
      pts.push(p);
    }
    b.tube(pts, pts.map(() => 0.0035 + r() * 0.0015), 4, 1, 0.8);
  }
}

function buttresses(b: Builder, r: () => number, trunkR: number, n: number, h: number, out: number) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.5;
    const d = new V(Math.cos(a), 0, Math.sin(a));
    const t = new V(-d.z, 0, d.x).multiplyScalar(trunkR * 0.18);
    const p0 = d.clone().multiplyScalar(trunkR * 0.8);
    const top = p0.clone().setY(h * (0.8 + r() * 0.4));
    const foot = d.clone().multiplyScalar(out * (0.8 + r() * 0.5)).setY(-0.004);
    const mid = d.clone().multiplyScalar(out * 0.35 + trunkR).setY(h * 0.25);
    const pts = [top, mid, foot];
    const b0 = b.pos.length / 3;
    for (const p of [...pts, p0.clone().setY(-0.004)]) {
      b.vert(p.clone().add(t), new V().copy(d).add(t.clone().normalize()).normalize(), 0, p.y * 20);
      b.vert(p.clone().sub(t), new V().copy(d).sub(t.clone().normalize()).normalize(), 0.5, p.y * 20);
    }
    // two faces: top-mid-foot-base polygon on each side
    const s = (i: number, side: number) => b0 + i * 2 + side;
    for (const side of [0, 1]) {
      b.idx.push(s(0, side), s(1, side), s(3, side), s(1, side), s(2, side), s(3, side));
    }
    // edge
    b.idx.push(s(0, 0), s(0, 1), s(1, 0), s(1, 0), s(0, 1), s(1, 1), s(1, 0), s(1, 1), s(2, 0), s(2, 0), s(1, 1), s(2, 1));
  }
}

/** Trunk tube closed at the top (palms and tree ferns are seen from above at eye level). */
function capped(b: Builder, path: THREE.Vector3[], radii: number[], sides: number) {
  const top = path[path.length - 1], prev = path[path.length - 2];
  const dir = top.clone().sub(prev).normalize();
  const r = radii[radii.length - 1];
  b.tube([...path, top.clone().addScaledVector(dir, r * 0.6), top.clone().addScaledVector(dir, r * 0.9)], [...radii, r * 0.7, 0.001], sides);
}

function palmCrown(f: Builder, r: () => number, top: THREE.Vector3, n: number, len: number, width: number, rise: number, droop: number) {
  for (let k = 0; k < n; k++) {
    const az = k * 2.39996 + r() * 0.3; // golden-angle spiral
    const tier = k / n;
    const el0 = rise - tier * 0.9 + (r() - 0.5) * 0.2; // younger fronds point up
    const L = len * (0.8 + r() * 0.3);
    const pts: THREE.Vector3[] = [];
    const dir = new V(Math.cos(az) * Math.cos(el0), Math.sin(el0), Math.sin(az) * Math.cos(el0));
    const p = top.clone();
    for (let i = 0; i <= 8; i++) {
      pts.push(p.clone());
      dir.y -= droop * (0.6 + tier);
      dir.normalize();
      p.addScaledVector(dir, L / 8);
    }
    const across = new V(-Math.sin(az), 0, Math.cos(az));
    const widths = pts.map((_, i) => width * Math.sin(Math.PI * Math.min(1, (i + 0.6) / 8.6)) * (1 - i / 16));
    const shade = tier > 0.85 ? 0.6 : 0.85 + r() * 0.2;
    f.strip(pts, widths, across, shade);
  }
}

/** Build one variant of a plant type. */
export function buildPlant(type: PlantType, seed: number): PlantGeo {
  const r = rng(seed * 7919 + type.length * 104729);
  const b = new Builder(), leaves = new Builder(), fr = new Builder(), moss = new Builder();
  let leafKind: LeafKind | null = 'lowland', frondKind: FrondKind | null = null, barkKind: BarkKind = 'brown';
  let crown = 0.3, trunkR = 0.025;
  switch (type) {
    case 'emergent': {
      trunkR = 0.022;
      buttresses(b, r, trunkR, 4 + Math.floor(r() * 3), 0.06 + r() * 0.03, 0.07);
      branchTree(b, leaves, null, r, { trunkTop: 0.72, trunkR, lean: 0.05, limbs: 7, limbAngle: [45, 75], limbLen: [0.22, 0.32], children: 4, crownR: 0.38, crownC: 0.86, leafSize: 0.07, clusters: 150, flatTop: true });
      lianas(b, r, 3, 0.3, 0.72);
      crown = 0.36; barkKind = 'grey';
      break;
    }
    case 'canopy': {
      trunkR = 0.026;
      if (r() < 0.5) buttresses(b, r, trunkR, 3, 0.04, 0.045);
      branchTree(b, leaves, null, r, { trunkTop: 0.5, trunkR, lean: 0.12, limbs: 6, limbAngle: [25, 60], limbLen: [0.22, 0.34], children: 4, crownR: 0.32, crownC: 0.74, leafSize: 0.085, clusters: 150 });
      if (r() < 0.6) lianas(b, r, 2, 0.25, 0.6);
      crown = 0.3; barkKind = r() < 0.5 ? 'brown' : 'grey';
      break;
    }
    case 'understory': {
      trunkR = 0.03;
      branchTree(b, leaves, null, r, { trunkTop: 0.4, trunkR, lean: 0.25, limbs: 5, limbAngle: [20, 55], limbLen: [0.25, 0.42], children: 3, crownR: 0.34, crownC: 0.68, leafSize: 0.13, clusters: 55 });
      crown = 0.3; leafKind = 'bigleaf';
      break;
    }
    case 'montane': {
      trunkR = 0.04;
      branchTree(b, leaves, moss, r, { trunkTop: 0.38, trunkR, lean: 0.35, limbs: 7, limbAngle: [40, 78], limbLen: [0.3, 0.44], children: 4, crownR: 0.44, crownC: 0.72, leafSize: 0.08, clusters: 190, gravity: 0.03, flatTop: true });
      // epiphyte ferns perched in the forks
      for (let k = 0; k < 7; k++) {
        const base = new V((r() - 0.5) * 0.3, 0.38 + r() * 0.2, (r() - 0.5) * 0.3);
        for (let q = 0; q < 5; q++) {
          const az = r() * 6.28;
          const pts = limb(base, new V(Math.cos(az), 0.8, Math.sin(az)), 0.07, 4, 0.2, r, 0.12);
          fr.strip(pts, [0.004, 0.014, 0.016, 0.012, 0.003], new V(-Math.sin(az), 0, Math.cos(az)), 0.9);
        }
      }
      crown = 0.42; leafKind = 'montane'; barkKind = 'mossy'; frondKind = 'fern';
      break;
    }
    case 'treefern': {
      trunkR = 0.03;
      const trunk = limb(new V(0, 0, 0), new V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), 0.8, 8, 0.12, r);
      capped(b, trunk, taper(trunk.length, trunkR * 1.25, trunkR * 0.9), 7);
      palmCrown(fr, r, trunk[trunk.length - 1], 15, 0.5, 0.16, 0.9, 0.11);
      crown = 0.42; leafKind = null; frondKind = 'fern'; barkKind = 'fern';
      break;
    }
    case 'oilpalm': {
      trunkR = 0.032;
      const trunk = limb(new V(0, 0, 0), new V((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15), 0.6, 6, 0.05, r);
      capped(b, trunk, taper(trunk.length, trunkR * 1.2, trunkR), 9);
      palmCrown(fr, r, trunk[trunk.length - 1], 30, 0.52, 0.11, 1.1, 0.07);
      crown = 0.45; leafKind = null; frondKind = 'oilpalm'; barkKind = 'palm';
      break;
    }
    case 'raphia': {
      trunkR = 0.03;
      const trunk = limb(new V(0, 0, 0), new V(0, 1, 0), 0.22, 3, 0.05, r);
      capped(b, trunk, taper(trunk.length, trunkR * 1.2, trunkR), 9);
      palmCrown(fr, r, trunk[trunk.length - 1], 18, 0.9, 0.13, 1.35, 0.045);
      crown = 0.55; leafKind = null; frondKind = 'raphia'; barkKind = 'palm';
      break;
    }
    case 'protea': {
      trunkR = 0.05;
      for (let s = 0; s < 3 + Math.floor(r() * 3); s++) {
        const az = r() * 6.28;
        const stem = limb(new V((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08), new V(Math.cos(az) * 0.5, 1, Math.sin(az) * 0.5), 0.55 + r() * 0.3, 5, 0.6, r);
        b.tube(stem, taper(stem.length, 0.035, 0.012), 5);
        for (let c = 0; c < 3; c++) {
          const from = stem[2 + Math.floor(r() * (stem.length - 2))];
          const cp = limb(from, new V(r() - 0.5, 0.8, r() - 0.5), 0.2 + r() * 0.15, 3, 0.6, r);
          b.tube(cp, taper(cp.length, 0.012, 0.004), 4);
          leafClusterAt(leaves, cp[cp.length - 1], 0.13, new V(0, 0.6, 0), 0.45, r, 3);
        }
        leafClusterAt(leaves, stem[stem.length - 1], 0.14, new V(0, 0.6, 0), 0.45, r, 3);
      }
      crown = 0.45; leafKind = 'protea'; barkKind = 'grey';
      break;
    }
    case 'savanna': {
      trunkR = 0.035;
      branchTree(b, leaves, null, r, { trunkTop: 0.42, trunkR, lean: 0.5, limbs: 5, limbAngle: [45, 80], limbLen: [0.3, 0.45], children: 2, crownR: 0.4, crownC: 0.78, leafSize: 0.08, clusters: 34, flatTop: true });
      crown = 0.4; leafKind = 'savanna'; barkKind = 'grey';
      break;
    }
    case 'regrowth': {
      trunkR = 0.02;
      for (let s = 0; s < 2 + Math.floor(r() * 3); s++) {
        const stem = limb(new V((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1), new V((r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.4), 0.7 + r() * 0.3, 6, 0.25, r);
        b.tube(stem, taper(stem.length, 0.02, 0.006), 5);
        for (let c = 0; c < 5; c++) {
          const at = stem[2 + Math.floor(r() * (stem.length - 2))];
          leafClusterAt(leaves, at.clone().add(new V((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25)), 0.15, new V(0, 0.65, 0), 0.35, r, 2);
        }
      }
      crown = 0.32; leafKind = 'regrowth';
      break;
    }
    case 'pole': {
      // young tree of the understorey: a thin straight stem (5–15 cm) with a small crown lost in the canopy above
      trunkR = 0.0075;
      const stem = limb(new V(0, 0, 0), new V((r() - 0.5) * 0.06, 1, (r() - 0.5) * 0.06), 0.92, 8, 0.03, r);
      b.tube(stem, taper(stem.length, trunkR * 1.25, trunkR * 0.55), 6, 1.4);
      for (let k = 0; k < 4; k++) {
        const from = stem[5 + Math.floor(r() * 3)];
        const az = r() * 6.28;
        const br = limb(from, new V(Math.cos(az), 0.9, Math.sin(az)), 0.1 + r() * 0.08, 3, 0.4, r);
        b.tube(br, taper(br.length, 0.003, 0.0012), 4);
        leafClusterAt(leaves, br[br.length - 1], 0.06, new V(0, 0.93, 0), 0.12, r, 2);
      }
      crown = 0.14; leafKind = 'bigleaf'; barkKind = 'lichen';
      break;
    }
  }
  return {
    trunk: b.empty ? null : b.build(),
    leaves: leaves.empty ? null : leaves.build(),
    fronds: fr.empty ? null : fr.build(),
    moss: moss.empty ? null : moss.build(),
    leafKind, frondKind, barkKind, crown, trunkR,
  };
}

// ---------------------------------------------------------------- ground cover

export type CoverType = 'grassGreen' | 'grassGolden' | 'grassTall' | 'fern' | 'herb' | 'stick' | 'stone' | 'sapling';

/** Ground-cover clump, height 1. */
export function buildCover(type: CoverType, seed: number): THREE.BufferGeometry {
  const r = rng(seed * 31 + type.length * 7);
  const b = new Builder();
  const up = new V(0, 1, 0);
  switch (type) {
    case 'grassGreen': case 'grassGolden': case 'grassTall': {
      const n = type === 'grassTall' ? 5 : 5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI + r() * 0.4;
        const ax = new V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.36);
        const off = new V((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35);
        // two stacked rows so the card can bend in the wind
        const pts = [off.clone(), off.clone().add(new V(0, 0.5, 0)), off.clone().add(new V((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15))];
        b.strip(pts, [0.36, 0.4, 0.42], ax.clone().normalize(), 0.85 + r() * 0.3, up);
      }
      break;
    }
    case 'fern': {
      const n = 6 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI * 2 + r() * 0.5;
        const pts = limb(new V(0, 0, 0), new V(Math.cos(az) * 0.6, 1, Math.sin(az) * 0.6), 1.0, 6, 0.1, r, 0.16);
        const ws = pts.map((_, i) => 0.24 * Math.sin(Math.PI * Math.min(1, (i + 0.5) / 6.5)));
        b.strip(pts, ws, new V(-Math.sin(az), 0, Math.cos(az)), 0.8 + r() * 0.3);
      }
      break;
    }
    case 'herb': {
      const n = 4 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const az = r() * 6.28, h = 0.5 + r() * 0.5;
        const stem = [new V(0, 0, 0), new V(Math.cos(az) * 0.1, h, Math.sin(az) * 0.1)];
        b.tube(stem, [0.012, 0.008], 3, 1, 0.6);
        const c = stem[1].clone().add(new V(Math.cos(az) * 0.22, 0.05, Math.sin(az) * 0.22));
        const ax = new V(Math.cos(az), 0.15, Math.sin(az)).normalize().multiplyScalar(0.26);
        const ay = new V(-Math.sin(az), 0.3, Math.cos(az)).normalize().multiplyScalar(0.26);
        b.card(c, ax, ay, null, 0.9 + r() * 0.2);
      }
      break;
    }
    case 'sapling': {
      // a young tree seedling with alternate broad leaves (texture: one leaf per card, petiole at v = 0);
      // the stem borrows the petiole colour at the bottom of the leaf texture
      const stem = limb(new V(0, 0, 0), new V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), 1, 6, 0.12, r);
      const b0 = b.pos.length / 3;
      b.tube(stem, taper(stem.length, 0.012, 0.004), 4, 1, 0.8);
      for (let i = b0 * 2; i < b.uv.length; i += 2) { b.uv[i] = 0.5; b.uv[i + 1] = 0.02; }
      const n = 7 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        const t = 0.25 + (k / n) * 0.75;
        const at = stem[Math.min(stem.length - 1, Math.round(t * (stem.length - 1)))];
        const az = k * 2.4 + r() * 0.4;
        const len = 0.2 + r() * 0.12 + (1 - t) * 0.08, wid = len * 0.24;
        const dir = new V(Math.cos(az), 0.25 + r() * 0.35 - (1 - t) * 0.2, Math.sin(az)).normalize();
        const side = new V(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(wid);
        b.card(at.clone().addScaledVector(dir, len / 2), side, dir.clone().multiplyScalar(len / 2), null, 0.85 + r() * 0.3);
      }
      break;
    }
    case 'stick': {
      const pts = limb(new V(-0.5, 0.02, 0), new V(1, 0.02, (r() - 0.5) * 0.3), 1, 4, 0.25, r);
      b.tube(pts, taper(pts.length, 0.03, 0.015), 5);
      break;
    }
    case 'stone': {
      const g = new THREE.IcosahedronGeometry(0.5, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new V().fromBufferAttribute(p, i);
        const k = 0.8 + 0.22 * Math.sin(v.x * 6 + seed) * Math.cos(v.z * 5 + seed * 2) + 0.08 * Math.sin(v.y * 17 + v.x * 11) + (r() - 0.5) * 0.03;
        v.multiplyScalar(k);
        v.y = v.y * 0.6 + 0.12;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      const n = p.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
      return g;
    }
  }
  return b.build();
}
