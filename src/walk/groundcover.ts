// Ground cover in 8 m tiles around the walker: summit tussock grass, lowland savanna grass, turf, ferns
// and broad-leaved herbs on the forest floor, fallen branches and stones. Deterministic per place.
import * as THREE from 'three';
import { hash2, vnoise } from './noise';
import type { WalkData } from './data';
import { biomeAt } from './biome';
import { buildCover, type CoverType } from './plants';
import { grassBlades, frond, bigLeaf, bark, groundTextures } from './textures';
import { depthFor } from './forest';
import { walkMaterial } from './env';

function nearFade(s: THREE.WebGLProgramParametersWithUniforms) {
  s.fragmentShader = s.fragmentShader.replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
    { float dn = length(vViewPosition); float th = 0.5 + 0.6 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      if (dn < th) discard; }`);
}

export interface CoverOpts { radius: number; spacing: number; shadows: boolean; rockRadius: number; texSize: number; msaa: boolean }

const TILE = 8;
const TYPES: CoverType[] = ['grassGolden', 'grassGreen', 'grassTall', 'fern', 'herb', 'stick', 'stone'];

interface Inst { x: number; y: number; z: number; s: number; sy: number; rot: number; tilt: number; tint: number }

export class GroundCover {
  readonly group = new THREE.Group();
  private meshes = new Map<CoverType, THREE.InstancedMesh>();
  private tiles = new Map<string, Map<CoverType, Inst[]>>();
  private boulders = new Map<string, Inst[]>();
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private caps = new Map<CoverType, number>();
  private boulderMesh!: THREE.InstancedMesh;
  private geos = new Map<CoverType, THREE.BufferGeometry>();
  private mats = new Map<CoverType, THREE.Material>();

  constructor(private data: WalkData, private opts: CoverOpts) {
    const rock = groundTextures(opts.texSize);
    const b = bark('brown', 77);
    const mk = (t: CoverType): THREE.Material => {
      switch (t) {
        case 'grassGolden': return walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('golden', 3), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 }), 'grass', nearFade);
        case 'grassGreen': return walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('green', 4), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 }), 'grass', nearFade);
        case 'grassTall': return walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('tall', 5), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 }), 'grass', nearFade);
        case 'fern': return walkMaterial(new THREE.MeshStandardMaterial({ map: frond('fern', 6), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 }), 'frond', nearFade);
        case 'herb': return walkMaterial(new THREE.MeshStandardMaterial({ map: bigLeaf(8), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.6 }), 'frond', nearFade);
        case 'stick': return walkMaterial(new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normal, vertexColors: true, roughness: 0.95 }));
        case 'stone': return walkMaterial(new THREE.MeshStandardMaterial({ map: rock.maps[3], normalMap: rock.normals[3], normalScale: new THREE.Vector2(2, 2), vertexColors: true, roughness: 0.9 }));
      }
    };
    for (const t of TYPES) {
      this.geos.set(t, buildCover(t, 1));
      const m = mk(t);
      if (opts.msaa && t !== 'stick' && t !== 'stone') m.alphaToCoverage = true;
      this.mats.set(t, m);
      this.caps.set(t, 0);
    }
    this.boulderMesh = this.alloc('stone', 256, true);
    this.boulderMesh.castShadow = opts.shadows;
  }

  private alloc(t: CoverType, cap: number, boulder = false) {
    const m = new THREE.InstancedMesh(this.geos.get(t)!, this.mats.get(t)!, cap);
    const depth = depthFor(this.mats.get(t)!);
    if (depth) m.customDepthMaterial = depth;
    m.count = 0;
    m.frustumCulled = false;
    m.receiveShadow = this.opts.shadows;
    m.castShadow = this.opts.shadows && (t === 'stone' || t === 'stick' || boulder);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.group.add(m);
    return m;
  }

  private genTile(ti: number, tj: number): Map<CoverType, Inst[]> {
    const out = new Map<CoverType, Inst[]>();
    const push = (t: CoverType, i: Inst) => { let l = out.get(t); if (!l) out.set(t, (l = [])); l.push(i); };
    const s = this.opts.spacing;
    const n = Math.max(1, Math.round(TILE / s));
    const step = TILE / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h1 = hash2(ti * 97 + i, tj * 97 + j, 1), h2 = hash2(ti * 97 + i, tj * 97 + j, 2), h3 = hash2(ti * 97 + i, tj * 97 + j, 3);
      const x = ti * TILE + (i + h1) * step, z = tj * TILE + (j + h2) * step;
      const b = biomeAt(this.data, x, z);
      if (b.streamDist < b.streamWidth * 0.9) continue; // the water itself
      const open = 1 - b.forest;
      const highGrass = b.grass * b.high + (b.cloud > 0.5 ? b.grass * 0.6 : 0);
      const lowGrass = b.grass * (1 - b.high) * (b.cloud > 0.5 ? 0.4 : 1);
      // grass grows in patches, not as a lawn
      const patch = 0.5 + 0.5 * vnoise(x / 7.3, z / 7.3, 5) * 0.8 + 0.5 * vnoise(x / 2.1, z / 2.1, 6) * 0.2;
      const pk = 0.3 + patch * 0.95;
      // probabilities per sample
      const pGolden = Math.min(1, highGrass * 1.1 * pk) * (1 - b.rock * 0.7);
      const pTall = lowGrass * 0.75 * pk;
      const pGreen = Math.min(0.9, (b.regrowth * 0.7 + lowGrass * 0.25 + b.wet * open * 0.5 + b.built * 0.3) * pk);
      const pFern = b.forest * (b.cloud > 0.5 ? 0.38 : 0.2) + b.wet * 0.3;
      const pHerb = b.forest * (b.cloud > 0.5 ? 0.08 : 0.3) + b.regrowth * 0.1;
      const pStick = b.forest * 0.035;
      const pStone = b.rock * 0.25 + (b.high > 0.5 ? 0.025 : 0.006) + b.wet * 0.05;
      const y = this.data.heightAt(x, z);
      const rot = h3 * Math.PI * 2;
      const tint = 0.8 + hash2(ti * 97 + i, tj * 97 + j, 4) * 0.35;
      let u = hash2(ti * 97 + i, tj * 97 + j, 5);
      const pick = (p: number) => { if (u < p) return true; u -= p; return false; };
      if (pick(pGolden)) push('grassGolden', { x, y, z, s: 0.55 + h1 * 0.35, sy: 0.45 + h2 * 0.45, rot, tilt: 0, tint });
      else if (pick(pTall)) push('grassTall', { x, y, z, s: 0.8 + h1 * 0.5, sy: 0.9 + h2 * 1.0, rot, tilt: 0, tint });
      else if (pick(pGreen)) push('grassGreen', { x, y, z, s: 0.5 + h1 * 0.3, sy: 0.25 + h2 * 0.35, rot, tilt: 0, tint });
      else if (pick(pFern)) push('fern', { x, y, z, s: 0.5 + h1 * 0.8, sy: 0.5 + h2 * 0.7, rot, tilt: 0, tint });
      else if (pick(pHerb)) push('herb', { x, y, z, s: 0.6 + h1 * 0.6, sy: 0.4 + h2 * 0.6, rot, tilt: 0, tint });
      else if (pick(pStick)) push('stick', { x, y: y + 0.03, z, s: 1 + h1 * 2.5, sy: 1 + h1 * 2, rot, tilt: 0, tint });
      else if (pick(pStone)) push('stone', { x, y: y - 0.05, z, s: 0.2 + h1 * h1 * 0.9, sy: 0.2 + h1 * h1 * 0.8, rot, tilt: h2 * 0.4, tint });
    }
    return out;
  }

  private genBoulders(bi: number, bj: number): Inst[] {
    // 24 m tiles, visible further than the small cover: outcrops on the summit and in rocky ravines.
    const out: Inst[] = [];
    for (let k = 0; k < 6; k++) {
      const x = bi * 24 + hash2(bi, bj * 7 + k, 31) * 24, z = bj * 24 + hash2(bi * 7 + k, bj, 32) * 24;
      const b = biomeAt(this.data, x, z);
      const p = b.rock * 0.8 + (b.high > 0.5 ? 0.08 : 0.01);
      if (hash2(bi + k, bj, 33) > p) continue;
      const sz = 0.8 + Math.pow(hash2(bi, bj + k, 34), 2) * 4 * (0.5 + b.rock);
      out.push({ x, y: this.data.heightAt(x, z) - sz * 0.25, z, s: sz * (1 + hash2(k, bi, 35) * 0.6), sy: sz, rot: hash2(bj, k, 36) * 6.28, tilt: hash2(k, bj, 37) * 0.5, tint: 0.75 + hash2(bi, k, 38) * 0.4 });
    }
    return out;
  }

  update(eye: THREE.Vector3): boolean {
    if (this.last.distanceTo(eye) < 2.5) return false;
    this.last.copy(eye);
    const R = this.opts.radius;
    const lists = new Map<CoverType, Inst[]>();
    const t0 = Math.floor((eye.x - R) / TILE), t1 = Math.floor((eye.x + R) / TILE);
    const u0 = Math.floor((eye.z - R) / TILE), u1 = Math.floor((eye.z + R) / TILE);
    const keep = new Set<string>();
    let budget = 40;
    for (let j = u0; j <= u1; j++) for (let i = t0; i <= t1; i++) {
      const cx = (i + 0.5) * TILE - eye.x, cz = (j + 0.5) * TILE - eye.z;
      if (Math.hypot(cx, cz) > R + TILE) continue;
      const key = `${i},${j}`;
      keep.add(key);
      let tile = this.tiles.get(key);
      if (!tile) {
        if (budget-- <= 0) { this.last.set(1e9, 0, 1e9); continue; }
        tile = this.genTile(i, j);
        this.tiles.set(key, tile);
      }
      for (const [t, l] of tile) { let a = lists.get(t); if (!a) lists.set(t, (a = [])); for (const it of l) a.push(it); }
    }
    for (const k of this.tiles.keys()) if (!keep.has(k)) this.tiles.delete(k);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    for (const t of TYPES) {
      const l = lists.get(t) ?? [];
      let mesh = this.meshes.get(t);
      if (!mesh || (this.caps.get(t) ?? 0) < l.length) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const cap = Math.ceil(l.length * 1.4) + 64;
        mesh = this.alloc(t, cap);
        this.meshes.set(t, mesh);
        this.caps.set(t, cap);
      }
      let n = 0;
      const grass = t === 'grassGolden' || t === 'grassTall' || t === 'grassGreen';
      const inner = R * 0.45;
      for (const it of l) {
        const d = Math.hypot(it.x - eye.x, it.z - eye.z);
        // Outer ring: thinned out with distance (constant count per ring), clumps a little larger;
        // only grasses reach the outer ring, smaller cover stops at the inner radius.
        if (d > inner) {
          if (!grass && d > inner * 1.25) continue;
          const keep = (inner / d) * (inner / d);
          if (hash2(Math.floor(it.x * 13), Math.floor(it.z * 13), 9) > keep) continue;
        }
        const fade = 1 - Math.min(1, Math.max(0, (d - R * 0.82) / (R * 0.18)));
        if (fade <= 0.02) continue;
        e.set(it.tilt, it.rot, it.tilt * 0.5);
        q.setFromEuler(e);
        const grow = d > inner ? Math.min(1.6, d / inner) : 1;
        sc.set(it.s * grow, it.sy * fade * (grass ? Math.min(1.3, grow) : 1), it.s * grow);
        p.set(it.x, it.y, it.z);
        m.compose(p, q, sc);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, c.setScalar(it.tint));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Boulders.
    const RB = this.opts.rockRadius;
    const all: Inst[] = [];
    const b0 = Math.floor((eye.x - RB) / 24), b1 = Math.floor((eye.x + RB) / 24), c0 = Math.floor((eye.z - RB) / 24), c1 = Math.floor((eye.z + RB) / 24);
    const keepB = new Set<string>();
    let bb = 60;
    for (let j = c0; j <= c1; j++) for (let i = b0; i <= b1; i++) {
      const key = `${i},${j}`;
      keepB.add(key);
      let l = this.boulders.get(key);
      if (!l) { if (bb-- <= 0) continue; l = this.genBoulders(i, j); this.boulders.set(key, l); }
      for (const it of l) if (Math.hypot(it.x - eye.x, it.z - eye.z) < RB) all.push(it);
    }
    for (const k of this.boulders.keys()) if (!keepB.has(k)) this.boulders.delete(k);
    if (all.length > 256) all.length = 256;
    all.forEach((it, n) => {
      e.set(it.tilt, it.rot, it.tilt * 0.5); q.setFromEuler(e);
      m.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s, it.sy, it.s * 0.9));
      this.boulderMesh.setMatrixAt(n, m);
      this.boulderMesh.setColorAt(n, c.setScalar(it.tint));
    });
    this.boulderMesh.count = all.length;
    this.boulderMesh.instanceMatrix.needsUpdate = true;
    if (this.boulderMesh.instanceColor) this.boulderMesh.instanceColor.needsUpdate = true;
    return true;
  }

  reset() { this.tiles.clear(); this.boulders.clear(); this.last.set(1e9, 0, 1e9); }

  /** Boulders near a point (for picking). */
  bouldersNear(x: number, z: number, r: number) {
    const out: Inst[] = [];
    for (const l of this.boulders.values()) for (const it of l) if (Math.hypot(it.x - x, it.z - z) < r) out.push(it);
    return out;
  }
}
