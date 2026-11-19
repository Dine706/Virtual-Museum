// Ground cover in 8 m tiles around the walker: summit tussock grass, lowland savanna grass, turf, ferns
// and broad-leaved herbs on the forest floor, fallen branches and stones. Deterministic per place.
import * as THREE from 'three';
import { hash2, vnoise } from './noise';
import type { WalkData } from './data';
import { biomeAt } from './biome';
import { buildCover, detailedTussock, type CoverType } from './plants';
import { grassBlades, frond, bigLeaf, bark, groundTextures, singleLeaf } from './textures';
import { trailK, AREA } from './data';
import { depthFor } from './forest';
import type { PhotoSet } from './photo';
import type { ModelSet, ScanModel } from './models';
import { walkMaterial } from './env';

function nearFade(s: THREE.WebGLProgramParametersWithUniforms) {
  s.fragmentShader = s.fragmentShader.replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
    { float dn = length(vViewPosition); float th = 0.5 + 0.6 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      if (dn < th) discard; }`);
}

export interface CoverOpts { radius: number; spacing: number; shadows: boolean; rockRadius: number; texSize: number; msaa: boolean }

const TILE = 8;
const TYPES: CoverType[] = ['grassGolden', 'grassGreen', 'grassTall', 'fern', 'herb', 'stick', 'stone', 'sapling'];

interface Inst { x: number; y: number; z: number; s: number; sy: number; rot: number; tilt: number; tint: number }

export class GroundCover {
  readonly group = new THREE.Group();
  private meshes = new Map<CoverType, THREE.InstancedMesh>();
  private tiles = new Map<string, Map<CoverType, Inst[]>>();
  private boulders = new Map<string, Inst[]>();
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private caps = new Map<CoverType, number>();
  private logs?: THREE.InstancedMesh;
  private nearbyLogs: { x: number; z: number; dx: number; dz: number; length: number; radius: number }[] = [];
  private boulderMesh!: THREE.InstancedMesh;
  private geos = new Map<CoverType, THREE.BufferGeometry>();
  private mats = new Map<CoverType, THREE.Material>();
  private middle = new Map<CoverType, { geometry: THREE.BufferGeometry; material: THREE.Material; mesh?: THREE.InstancedMesh; capacity: number }>();

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
        case 'sapling': return walkMaterial(new THREE.MeshStandardMaterial({ map: singleLeaf(5), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.45 }), 'leaf', nearFade, 'sapling');
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
      const pa = this.data.pathAt(x, z);
      const onPath = pa.dist < 0.15 ? 1 : 0;
      const trail = trailK(x, z, b.forest);
      if (this.data.buildingAt(x, z, 0.4)) continue;
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
      const pFern = b.forest * (b.cloud > 0.5 ? 0.3 : 0.08) + b.wet * 0.3;
      const pHerb = b.forest * (b.cloud > 0.5 ? 0.06 : 0.11) + b.regrowth * 0.08;
      const pStick = b.forest * 0.012;
      const pStone = b.rock * 0.25 + (b.high > 0.5 ? 0.025 : 0.006) + b.wet * 0.05;
      const pSapling = (b.forest * (b.cloud > 0.5 ? 0.05 : 0.075) + b.regrowth * 0.05) * (1 - trail);
      const ac = this.data.areaAt(x, z);
      const lcWater = b.cls === 80, lcWet = b.cls === 90, lcBare = b.cls === 60;
      if (ac === AREA.water || lcWater) continue;
      if (ac === AREA.sand || (ac === AREA.mine && b.forest < 0.5) || ac === AREA.rock || lcBare) {
        // bare ground: stones and gravel; on old mine ground a little grass recolonising
        const u2 = hash2(ti * 97 + i, tj * 97 + j, 8);
        const yy = this.data.heightAt(x, z);
        if (u2 < (ac === AREA.rock || lcBare ? 0.14 : 0.06)) push('stone', { x, y: yy - 0.05, z, s: 0.15 + h1 * h1 * 0.9, sy: 0.15 + h1 * h1 * 0.7, rot: h3 * 6.28, tilt: h2 * 0.4, tint: 0.85 + h2 * 0.25 });
        else if (ac === AREA.mine && u2 < 0.22) push('grassGreen', { x, y: yy, z, s: 0.4 + h1 * 0.3, sy: 0.2 + h2 * 0.3, rot: h3 * 6.28, tilt: 0, tint: 0.8 + h2 * 0.2 });
        continue;
      }
      if (ac === AREA.field) {
        // crop rows (upland rice and cassava are the staples at Bossou)
        const row = (((z / 0.9) % 1) + 1) % 1;
        if (row > 0.55) continue;
        const yy = this.data.heightAt(x, z);
        if (hash2(ti * 97 + i, tj * 97 + j, 9) < 0.18) push('sapling', { x, y: yy, z, s: 0.7 + h1 * 0.8, sy: 0.7 + h1 * 0.8, rot: h3 * 6.28, tilt: 0, tint: 1 });
        else push('grassGreen', { x, y: yy, z, s: 0.45 + h1 * 0.2, sy: 0.4 + h2 * 0.35, rot: h3 * 6.28, tilt: 0, tint: 0.9 + h2 * 0.2 });
        continue;
      }
      if (ac === AREA.wetland || lcWet) {
        if (hash2(ti * 97 + i, tj * 97 + j, 10) < 0.7) push('grassTall', { x, y: this.data.heightAt(x, z), z, s: 0.7 + h1 * 0.5, sy: 1.0 + h2 * 1.1, rot: h3 * 6.28, tilt: 0, tint: 0.85 + h2 * 0.2 });
        continue;
      }
      if (onPath || trail > 0.7) { // beaten earth: only the odd stone or twig
        if (hash2(ti * 97 + i, tj * 97 + j, 7) < 0.02) push('stone', { x, y: this.data.heightAt(x, z) - 0.04, z, s: 0.08 + h1 * 0.12, sy: 0.08 + h2 * 0.1, rot: h3 * 6.28, tilt: 0.2, tint: 0.9 });
        continue;
      }
      const y = this.data.heightAt(x, z);
      const rot = h3 * Math.PI * 2;
      const tint = 0.8 + hash2(ti * 97 + i, tj * 97 + j, 4) * 0.35;
      let u = hash2(ti * 97 + i, tj * 97 + j, 5);
      const pick = (p: number) => { if (u < p) return true; u -= p; return false; };
      if (pick(pGolden)) push('grassGolden', { x, y, z, s: 0.38 + h1 * 0.67, sy: (0.26 + h2 * 0.65) * (0.65 + patch * 0.65), rot, tilt: (h1 - 0.5) * 0.36, tint: tint * (0.87 + patch * 0.24) });
      else if (pick(pTall)) push('grassTall', { x, y, z, s: 0.8 + h1 * 0.5, sy: 0.9 + h2 * 1.0, rot, tilt: 0, tint });
      else if (pick(pGreen)) push('grassGreen', { x, y, z, s: 0.5 + h1 * 0.3, sy: 0.25 + h2 * 0.35, rot, tilt: 0, tint });
      else if (pick(pFern)) push('fern', { x, y, z, s: 0.5 + h1 * 0.8, sy: 0.5 + h2 * 0.7, rot, tilt: 0, tint });
      else if (pick(pHerb)) push('herb', { x, y, z, s: 0.6 + h1 * 0.6, sy: 0.4 + h2 * 0.6, rot, tilt: 0, tint });
      else if (pick(pStick)) push('stick', { x, y: y + 0.02, z, s: 0.8 + h1 * 1.6, sy: 0.5 + h1 * 0.6, rot, tilt: 0, tint });
      else if (pick(pSapling)) push('sapling', { x, y, z, s: 0.6 + h1 * 1.8, sy: 0.6 + h1 * 1.8, rot, tilt: 0, tint });
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
      const ac = this.data.areaAt(x, z);
      const p = b.rock * 0.8 + (b.high > 0.5 ? 0.08 : 0.01) + (ac === AREA.rock || b.cls === 60 ? 0.5 : 0) + (ac === AREA.mine ? 0.12 : 0);
      if (ac === AREA.water || b.cls === 80 || this.data.buildingAt(x,z,3) || this.data.pathAt(x,z).dist < 2.5) continue;
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
    // Populate the player's immediate surroundings first, including on the very first reveal.
    // Row-order loading previously left an empty circle around the spawn while distant tiles filled.
    const wanted: { i: number; j: number; distance: number }[] = [];
    for (let j = u0; j <= u1; j++) for (let i = t0; i <= t1; i++) {
      const cx = (i + 0.5) * TILE - eye.x, cz = (j + 0.5) * TILE - eye.z;
      const distance = Math.hypot(cx, cz);
      if (distance <= R + TILE) wanted.push({ i, j, distance });
    }
    wanted.sort((a, b) => a.distance - b.distance);
    let budget = 40;
    for (const { i, j } of wanted) {
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
      const all = lists.get(t) ?? [];
      const fallback = this.middle.get(t);
      // A scanned fern has thousands of triangles. Preserve it within 22 m, then retain the
      // original lightweight 3D plant instead of repeating full scans out to the cover horizon.
      const nearLimit = t.startsWith('grass') ? 14 : 22;
      const l = fallback ? all.filter((it) => Math.hypot(it.x - eye.x, it.z - eye.z) < nearLimit) : all;
      let mesh = this.meshes.get(t);
      if (!mesh || (this.caps.get(t) ?? 0) < l.length) {
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        const cap = Math.ceil(l.length * 1.4) + 64;
        mesh = this.alloc(t, cap);
        this.meshes.set(t, mesh);
        this.caps.set(t, cap);
      }
      let n = 0;
      const grass = t === 'grassGolden' || t === 'grassTall' || t === 'grassGreen' || t === 'sapling';
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
        if (this.uniform.has(t)) { const k = it.s * grow * 1.15; sc.set(k, k * fade, k); }
        else sc.set(it.s * grow, it.sy * fade * (grass ? Math.min(1.3, grow) : 1), it.s * grow);
        // sink grass roots a little: on a slope the downhill side would otherwise float
        p.set(it.x, it.y - (grass ? 0.06 * sc.y : 0), it.z);
        m.compose(p, q, sc);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, c.setScalar(it.tint));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (fallback) {
        const middle = all.filter((it) => Math.hypot(it.x - eye.x, it.z - eye.z) >= nearLimit);
        if (!fallback.mesh || fallback.capacity < middle.length) {
          if (fallback.mesh) { this.group.remove(fallback.mesh); fallback.mesh.dispose(); }
          fallback.capacity = Math.ceil(middle.length * 1.4) + 64;
          const mid = new THREE.InstancedMesh(fallback.geometry, fallback.material, fallback.capacity);
          mid.frustumCulled = false; mid.receiveShadow = this.opts.shadows;
          mid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          fallback.mesh = mid; this.group.add(mid);
        }
        let count = 0;
        for (const it of middle) {
          const d = Math.hypot(it.x - eye.x, it.z - eye.z);
          const outer = t.startsWith('grass') ? R : R * .56;
          if (d > outer) continue;
          if (d > inner && hash2(Math.floor(it.x*13),Math.floor(it.z*13),9) > (inner/d)**2) continue;
          const fade = 1 - THREE.MathUtils.smoothstep(d, outer*.82, outer);
          e.set(it.tilt, it.rot, it.tilt * 0.5); q.setFromEuler(e);
          m.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s, it.sy * fade, it.s));
          fallback.mesh.setMatrixAt(count, m);
          fallback.mesh.setColorAt(count++, c.setScalar(it.tint));
        }
        fallback.mesh.count = count;
        fallback.mesh.instanceMatrix.needsUpdate = true;
        if (fallback.mesh.instanceColor) fallback.mesh.instanceColor.needsUpdate = true;
      }
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
    if (all.length > 256) {
      all.sort((a,b) => Math.hypot(a.x-eye.x,a.z-eye.z)-Math.hypot(b.x-eye.x,b.z-eye.z));
      all.length=256;
    }
    all.forEach((it, n) => {
      e.set(it.tilt, it.rot, it.tilt * 0.5); q.setFromEuler(e);
      m.compose(p.set(it.x, it.y, it.z), q, sc.set(it.s, it.sy, it.s * 0.9));
      this.boulderMesh.setMatrixAt(n, m);
      this.boulderMesh.setColorAt(n, c.setScalar(it.tint));
    });
    if (this.logs) this.placeDeadfall(eye);
    this.boulderMesh.count = all.length;
    this.boulderMesh.instanceMatrix.needsUpdate = true;
    if (this.boulderMesh.instanceColor) this.boulderMesh.instanceColor.needsUpdate = true;
    return true;
  }

  private placeDeadfall(eye: THREE.Vector3) {
    const logs = this.logs!;
    logs.count = 0;
    this.nearbyLogs.length = 0;
    const pose = new THREE.Object3D();
    const cell = 11, cx=Math.floor(eye.x/cell), cz=Math.floor(eye.z/cell);
    for(let j=cz-4;j<=cz+4;j++) for(let i=cx-4;i<=cx+4;i++) {
      const x=(i+.1+.8*hash2(i,j,111))*cell, z=(j+.1+.8*hash2(i,j,112))*cell;
      const a=this.data.attrAt(x,z), length=2.4+4.3*hash2(i,j,113);
      if(a.canopy<6 || hash2(i,j,114)>0.32 || this.data.buildingAt(x,z,length/2) ||
        this.data.pathAt(x,z).dist<length/2 || this.data.streamAt(x,z).dist<2) continue;
      const angle=hash2(i,j,115)*Math.PI*2, dx=Math.cos(angle), dz=Math.sin(angle);
      const y0=this.data.heightAt(x-dx*length*.4,z-dz*length*.4), y1=this.data.heightAt(x+dx*length*.4,z+dz*length*.4);
      pose.position.set(x,(y1+y0)/2-.035,z);
      pose.rotation.set(0,-angle,Math.atan2(y1-y0,length*.8),'YXZ');
      pose.scale.setScalar(length);
      pose.updateMatrix();
      logs.setMatrixAt(logs.count++,pose.matrix);
      if(Math.hypot(x-eye.x,z-eye.z)<9) this.nearbyLogs.push({x,z,dx,dz,length,radius:length*.049});
    }
    logs.instanceMatrix.needsUpdate=true;
  }

  deadfallHeight(x:number,z:number) {
    let rise=0;
    for(const log of this.nearbyLogs) {
      const ax=x-log.x, az=z-log.z, along=ax*log.dx+az*log.dz;
      if(Math.abs(along)>log.length*.45) continue;
      const cross=ax*log.dz-az*log.dx;
      rise=Math.max(rise,1.6*Math.sqrt(Math.max(0,log.radius**2-cross**2)));
    }
    return rise;
  }

  /** Scanned models replace the drawn fern, forest herb and boulders (high-quality look). */
  useModels(m: ModelSet) {
    const swap = (t: CoverType, sm: ScanModel | undefined, wind: 'frond' | 'none', key: string) => {
      if (!sm) return;
      this.middle.set(t, { geometry: this.geos.get(t)!, material: this.mats.get(t)!, capacity: 0 });
      const mat = wind === 'none' ? walkMaterial(sm.material, 'none', undefined, key) : walkMaterial(sm.material, wind, nearFade, key);
      this.geos.set(t, sm.geometry);
      this.mats.set(t, mat);
      this.uniform.add(t);
      const mesh = this.meshes.get(t);
      if (mesh) {
        mesh.geometry = sm.geometry; mesh.material = mat;
        const d = depthFor(mat); if (d) mesh.customDepthMaterial = d;
      }
      this.last.set(1e9, 0, 1e9);
    };
    if (m.deadfall) {
      this.logs=new THREE.InstancedMesh(m.deadfall.geometry,walkMaterial(m.deadfall.material),81);
      this.logs.frustumCulled=false; this.logs.count=0;
      this.logs.receiveShadow=this.logs.castShadow=this.opts.shadows;
      this.group.add(this.logs);
    }
    swap('fern', m.fern_02, 'frond', 'scan-fern');
    swap('herb', m.calathea_orbifolia_01, 'frond', 'scan-herb');
    if (m.rock_07) {
      this.boulderMesh.geometry = m.rock_07.geometry;
      this.boulderMesh.material = walkMaterial(m.rock_07.material, 'none', undefined, 'scan-rock');
      this.boulderMesh.customDepthMaterial = undefined;
    }
  }
  /** Cover types drawn from scanned models keep their own proportions (uniform scale). */
  private uniform = new Set<CoverType>();

  usePhotos(p: PhotoSet) {
    const m = this.mats.get('stone') as THREE.MeshStandardMaterial;
    m.map = p.rock.map; m.normalMap = p.rock.normal; m.needsUpdate = true;
  }

  reset() { this.tiles.clear(); this.boulders.clear(); this.last.set(1e9, 0, 1e9); }

  useGrass(texture: THREE.Texture) {
    for (const kind of ['grassGolden', 'grassGreen', 'grassTall'] as const) {
      const material = this.mats.get(kind) as THREE.MeshStandardMaterial;
      material.map?.dispose(); material.map = texture; material.needsUpdate = true;
      material.roughness = 0.88;
      this.middle.set(kind, { geometry: this.geos.get(kind)!, material, capacity: 0 });
      const geometry = detailedTussock(kind);
      const blades = walkMaterial(new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: .83,
      }), 'grass', nearFade);
      this.geos.set(kind, geometry);
      this.mats.set(kind, blades);
      const mesh = this.meshes.get(kind);
      if (mesh) { mesh.geometry = geometry; mesh.material = blades; mesh.customDepthMaterial = undefined; }
      this.last.set(1e9,0,1e9);
    }
  }

  get stats() {
    return { tiles: this.tiles.size, instances: [...this.meshes.values()].reduce((n, m) => n + m.count, 0), middleInstances: [...this.middle.values()].reduce((n, m) => n + (m.mesh?.count ?? 0), 0), boulders: this.boulderMesh.count };
  }

  /** Boulders near a point (for picking). */
  bouldersNear(x: number, z: number, r: number) {
    const out: Inst[] = [];
    for (const l of this.boulders.values()) for (const it of l) if (Math.hypot(it.x - x, it.z - z) < r) out.push(it);
    return out;
  }
}
