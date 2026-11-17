// Villages in walk mode, following docs/VILLAGE_SOURCES.md:
// • houses stand on the real OpenStreetMap footprints (© OpenStreetMap contributors, ODbL); small square
//   footprints become round wattle-and-daub huts with thatched cones, the rest rectangular earth-plastered
//   houses with corrugated metal roofs (some rusty, some with a porch) – typical of the region, not surveyed;
// • villagers (fictional, generic figures) do sourced everyday activities: pounding in a mortar, carrying
//   loads or water, a child with firewood, a mother with a baby on her back, hoeing in fields, sitting and
//   talking, children playing, walking along the real paths. No rites, no sacred places, no masks.
import * as THREE from 'three';
import type { WalkData, Building, Road } from './data';
import { walkMaterial } from './env';
import { hash2, rng } from './noise';

// ---------------------------------------------------------------- textures (drawn in code)

const cv = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })!] as const; };
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plaster(kind: 'door' | 'window' | 'plain', hue: number, seed: number): THREE.Texture {
  const [c, g] = cv(256, 256);
  const r = rng(seed);
  g.fillStyle = hsl(hue, 38, 42); g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 900; k++) { g.fillStyle = hsl(hue + (r() - 0.5) * 8, 30 + r() * 15, 34 + r() * 18, 0.25); g.fillRect(r() * 256, r() * 256, 2 + r() * 10, 2 + r() * 6); }
  g.strokeStyle = hsl(hue, 30, 26, 0.45); g.lineWidth = 1;
  for (let k = 0; k < 14; k++) { let x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (r() - 0.5) * 30; y += r() * 20; g.lineTo(x, y); } g.stroke(); }
  // splash band at the foot of the wall (canvas y = 256 is the bottom of the wall)
  const sp = g.createLinearGradient(0, 256, 0, 200); sp.addColorStop(0, hsl(hue - 4, 35, 22, 0.8)); sp.addColorStop(1, hsl(hue, 35, 30, 0)); g.fillStyle = sp; g.fillRect(0, 196, 256, 60);
  if (kind === 'door') {
    g.fillStyle = hsl(28, 30, 16); g.fillRect(100, 74, 56, 182);
    g.strokeStyle = hsl(28, 25, 26); g.lineWidth = 3; for (let x = 104; x < 156; x += 9) { g.beginPath(); g.moveTo(x, 76); g.lineTo(x, 256); g.stroke(); }
  } else if (kind === 'window') {
    for (const x of [44, 168]) { g.fillStyle = hsl(28, 25, 18); g.fillRect(x, 92, 44, 52); g.strokeStyle = hsl(28, 20, 30); g.lineWidth = 3; g.strokeRect(x, 92, 44, 52); g.beginPath(); g.moveTo(x + 22, 92); g.lineTo(x + 22, 144); g.stroke(); }
  }
  return tex(c);
}

function thatch(seed: number): THREE.Texture {
  const [c, g] = cv(256, 256);
  const r = rng(seed);
  g.fillStyle = hsl(40, 35, 38); g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) {
    g.strokeStyle = hsl(36 + r() * 12, 30 + r() * 20, 28 + r() * 30, 0.7); g.lineWidth = 1 + r();
    const x = r() * 256, y = r() * 256, l = 10 + r() * 26;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y + l); g.stroke();
  }
  for (let y = 18; y < 256; y += 34) { g.fillStyle = hsl(30, 25, 18, 0.35); g.fillRect(0, y, 256, 3); }
  return tex(c, true);
}

function metal(rusty: number, seed: number): THREE.Texture {
  const [c, g] = cv(256, 256);
  const r = rng(seed);
  for (let x = 0; x < 256; x += 2) { const l = 52 + 12 * Math.sin(x / 256 * Math.PI * 2 * 12); g.fillStyle = hsl(200, 6, l); g.fillRect(x, 0, 2, 256); }
  for (let k = 0; k < 40 + rusty * 260; k++) {
    g.fillStyle = hsl(18 + r() * 14, 45 + r() * 25, 26 + r() * 16, 0.25 + r() * 0.5);
    g.beginPath(); g.ellipse(r() * 256, r() * 256, 4 + r() * 30 * rusty + 2, 2 + r() * 14, r() * 3, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = hsl(200, 5, 35, 0.6); for (let y = 0; y < 256; y += 128) g.fillRect(0, y, 256, 2); // sheet overlaps
  return tex(c, true);
}

function cloth(seed: number): THREE.Texture {
  // generic everyday cloth: plain, stripes or simple geometric print (no specific cultural motif)
  const [c, g] = cv(64, 64);
  const r = rng(seed);
  const h = Math.floor(r() * 360), h2 = (h + 120 + Math.floor(r() * 120)) % 360;
  g.fillStyle = hsl(h, 45 + r() * 35, 28 + r() * 30); g.fillRect(0, 0, 64, 64);
  const style = Math.floor(r() * 3);
  g.fillStyle = hsl(h2, 50, 30 + r() * 35, 0.85);
  if (style === 1) for (let y = 0; y < 64; y += 10) g.fillRect(0, y, 64, 4);
  if (style === 2) for (let y = 4; y < 64; y += 16) for (let x = 4 + (y % 32 ? 8 : 0); x < 64; x += 16) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  const t = tex(c, true);
  t.repeat.set(2, 2);
  return t;
}

// ---------------------------------------------------------------- house geometry (unit sizes)

function gableRoof(): THREE.BufferGeometry {
  // unit footprint 1 × 1 (x along the ridge), ridge height 1; two slopes + two gable triangles
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0,
    -0.5, 1, 0, 0.5, 1, 0, 0.5, 0, 0.5, -0.5, 0, 0.5];
  const uv = [0, 0, 2, 0, 2, 1, 0, 1, 0, 1, 2, 1, 2, 0, 0, 0];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function gableEnds(): THREE.BufferGeometry {
  const p = [-0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0];
  const uv = [0, 0.75, 1, 0.75, 0.5, 1, 0, 0.75, 1, 0.75, 0.5, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

interface HouseInst { b: Building; round: boolean; base: number; wallH: number; roofH: number; porch: boolean; rust: number; hue: number }

// ---------------------------------------------------------------- people

export type Activity = 'walk' | 'pound' | 'carry' | 'firewood' | 'baby' | 'hoe' | 'sit' | 'play';

interface Rig {
  root: THREE.Group; hips: THREE.Group; spine: THREE.Group; head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group; foreL: THREE.Group; foreR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; shinL: THREE.Group; shinR: THREE.Group; prop: THREE.Group;
}

export interface Person {
  rig: Rig; activity: Activity; child: boolean; female: boolean;
  pos: THREE.Vector3; heading: number; speed: number; phase: number;
  path: [number, number][] | null; pathT: number; pathDir: number; center: THREE.Vector3 | null; radius: number;
  village: string | null;
}

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 8);

export class Village {
  readonly group = new THREE.Group();
  readonly houses: HouseInst[] = [];
  readonly people: Person[] = [];
  private houseMeshes: THREE.Object3D[] = [];
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private lastPeople = new THREE.Vector3(1e9, 0, 1e9);
  private mats: Record<string, THREE.Material> = {};
  private skin: THREE.Material[] = [];
  private clothes: THREE.Material[] = [];
  private geo = {
    torso: capsule(0.15, 0.36), pelvis: capsule(0.14, 0.12), upper: capsule(0.055, 0.24), lower: capsule(0.045, 0.24),
    thigh: capsule(0.07, 0.34), shin: capsule(0.055, 0.34), head: new THREE.SphereGeometry(0.105, 14, 10), hair: new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    skirt: new THREE.CylinderGeometry(0.17, 0.25, 0.6, 12, 1, true), foot: new THREE.BoxGeometry(0.09, 0.05, 0.22),
    stick: new THREE.CylinderGeometry(0.02, 0.025, 1, 6), mortar: new THREE.CylinderGeometry(0.2, 0.16, 0.6, 12), basin: new THREE.CylinderGeometry(0.28, 0.2, 0.12, 14),
    bundle: new THREE.CylinderGeometry(0.05, 0.05, 1, 6), baby: new THREE.SphereGeometry(0.16, 10, 8), bench: new THREE.BoxGeometry(1.4, 0.08, 0.3),
    hoeBlade: new THREE.BoxGeometry(0.16, 0.02, 0.14),
  };

  constructor(private data: WalkData, private maxPeople: number) {
    const W = (m: THREE.Material) => walkMaterial(m);
    this.mats.wallDoor = W(new THREE.MeshStandardMaterial({ map: plaster('door', 22, 1), roughness: 0.95 }));
    this.mats.wallWin = W(new THREE.MeshStandardMaterial({ map: plaster('window', 22, 2), roughness: 0.95 }));
    this.mats.wallDoor2 = W(new THREE.MeshStandardMaterial({ map: plaster('door', 30, 3), roughness: 0.95, color: new THREE.Color(1.05, 1.0, 0.95) }));
    this.mats.wallWin2 = W(new THREE.MeshStandardMaterial({ map: plaster('window', 30, 4), roughness: 0.95, color: new THREE.Color(1.05, 1.0, 0.95) }));
    this.mats.hutWall = W(new THREE.MeshStandardMaterial({ map: plaster('door', 18, 5), roughness: 0.95 }));
    this.mats.thatch = W(new THREE.MeshStandardMaterial({ map: thatch(6), roughness: 1, side: THREE.DoubleSide }));
    this.mats.metal = W(new THREE.MeshStandardMaterial({ map: metal(0.15, 7), roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }));
    this.mats.rust = W(new THREE.MeshStandardMaterial({ map: metal(0.9, 8), roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
    this.mats.gable = W(new THREE.MeshStandardMaterial({ map: plaster('plain', 22, 9), roughness: 0.95, side: THREE.DoubleSide }));
    this.mats.wood = W(new THREE.MeshStandardMaterial({ color: '#5b3d25', roughness: 0.85 }));
    this.mats.woodLight = W(new THREE.MeshStandardMaterial({ color: '#7d5a38', roughness: 0.8 }));
    this.mats.hair = W(new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.95 }));
    this.mats.basin = W(new THREE.MeshStandardMaterial({ color: '#9aa3a8', roughness: 0.35, metalness: 0.6 }));
    for (const c of ['#4a2c1d', '#5b3824', '#3d2418', '#6a412a', '#33201a']) this.skin.push(W(new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })));
    for (let k = 0; k < 14; k++) this.clothes.push(W(new THREE.MeshStandardMaterial({ map: cloth(100 + k), roughness: 0.85 })));
  }

  // ---------------------------------------------------------------- houses

  private buildHouses(eye: THREE.Vector3) {
    for (const m of this.houseMeshes) { this.group.remove(m); (m as THREE.InstancedMesh).dispose?.(); }
    this.houseMeshes = [];
    this.houses.length = 0;
    const list = this.data.buildingsNear(eye.x, eye.z, 650);
    for (const b of list) {
      const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([su, sv]) => {
        const c = Math.cos(b.a), s = Math.sin(b.a);
        const u = su * b.w / 2, v = sv * b.d / 2;
        return this.data.heightAt(b.x + u * c - v * s, b.z + u * s + v * c);
      });
      const lo = Math.min(...hs), hi = Math.max(...hs);
      const size = Math.max(b.w, b.d), aspect = size / Math.max(0.5, Math.min(b.w, b.d));
      const round = (b.kind === 'hut' || (size <= 6.5 && aspect < 1.25)) && b.kind !== 'school' && b.kind !== 'government';
      const h = hash2(Math.floor(b.x * 3), Math.floor(b.z * 3), 11);
      this.houses.push({
        b, round, base: lo - 0.35, wallH: (round ? 2.1 : 2.6) + (hi - lo) + 0.35, roofH: round ? 1.6 + h * 0.8 : Math.min(b.w, b.d) * 0.22 + 0.4,
        porch: !round && b.d > 4.5 && h < 0.45, rust: h, hue: 0,
      });
    }
    const n = (f: (x: HouseInst) => boolean) => this.houses.filter(f).length;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], count: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      this.group.add(m); this.houseMeshes.push(m);
      return m;
    };
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, true).translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(0.5, 1, 20, 1, true).translate(0, 0.5, 0);
    const roof = gableRoof(), ends = gableEnds();
    const post = new THREE.CylinderGeometry(0.06, 0.07, 1, 6).translate(0, 0.5, 0);
    // box material groups: +x, −x, +y, −y, +z (front), −z
    const wallsA = [this.mats.wallWin, this.mats.wallWin, this.mats.gable, this.mats.gable, this.mats.wallDoor, this.mats.wallWin];
    const wallsB = [this.mats.wallWin2, this.mats.wallWin2, this.mats.gable, this.mats.gable, this.mats.wallDoor2, this.mats.wallWin2];
    const mWallA = mk(box, wallsA, n((x) => !x.round && x.rust < 0.6));
    const mWallB = mk(box, wallsB, n((x) => !x.round && x.rust >= 0.6));
    const mRoofM = mk(roof, this.mats.metal, n((x) => !x.round && x.rust < 0.55));
    const mRoofR = mk(roof, this.mats.rust, n((x) => !x.round && x.rust >= 0.55));
    const mEnds = mk(ends, this.mats.gable, n((x) => !x.round));
    const mHut = mk(cyl, this.mats.hutWall, n((x) => x.round));
    const mCone = mk(cone, this.mats.thatch, n((x) => x.round));
    const mPorch = mk(new THREE.BoxGeometry(1, 0.04, 1).translate(0, 0, 0.5), this.mats.metal, n((x) => x.porch));
    const mPost = mk(post, this.mats.wood, n((x) => x.porch) * 3);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const put = (m: THREE.InstancedMesh, px: number, py: number, pz: number, rot: number, sx: number, sy: number, sz: number) => {
      Q.setFromAxisAngle(Y, rot); P.set(px, py, pz); S.set(sx, sy, sz);
      m.setMatrixAt(m.count++, M.compose(P, Q, S));
    };
    for (const h of this.houses) {
      const { b } = h;
      // footprint u axis (width) at angle a in the x–z plane; three.js yaw rotates +x toward −z, so negate
      const rot = -b.a;
      if (h.round) {
        const r = Math.min(b.w, b.d);
        put(mHut, b.x, h.base, b.z, rot, r, h.wallH, r);
        put(mCone, b.x, h.base + h.wallH - 0.05, b.z, rot, r * 1.35, h.roofH, r * 1.35);
      } else {
        put(h.rust < 0.6 ? mWallA : mWallB, b.x, h.base, b.z, rot, b.w, h.wallH, b.d);
        put(h.rust < 0.55 ? mRoofM : mRoofR, b.x, h.base + h.wallH, b.z, rot, b.w + 0.7, h.roofH, b.d + 0.7);
        put(mEnds, b.x, h.base + h.wallH, b.z, rot, b.w, h.roofH, b.d);
        if (h.porch) {
          const c = Math.cos(b.a), s = Math.sin(b.a);
          const fx = b.x - s * (b.d / 2), fz = b.z + c * (b.d / 2); // front (+v) side
          put(mPorch, fx, h.base + h.wallH - 0.25, fz, rot, b.w, 1, 1.8);
          for (const t of [-0.45, 0, 0.45]) {
            const px = fx - s * 1.75 + c * t * b.w, pz = fz + c * 1.75 + s * t * b.w;
            put(mPost, px, this.data.heightAt(px, pz) - 0.1, pz, 0, 1, h.base + h.wallH - 0.2 - this.data.heightAt(px, pz), 1);
          }
        }
      }
    }
    for (const m of this.houseMeshes) (m as THREE.InstancedMesh).instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- people

  private makeRig(female: boolean, child: boolean, seed: number): Rig {
    const r = rng(seed);
    const skin = this.skin[Math.floor(r() * this.skin.length)];
    const top = this.clothes[Math.floor(r() * this.clothes.length)];
    const bottom = this.clothes[Math.floor(r() * this.clothes.length)];
    const G = () => new THREE.Group();
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, y = 0) => { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = true; return o; };
    const root = G(), hips = G(), spine = G(), head = G(), prop = G();
    const armL = G(), armR = G(), foreL = G(), foreR = G(), legL = G(), legR = G(), shinL = G(), shinR = G();
    root.add(hips);
    hips.position.y = 0.9;
    hips.add(mesh(this.geo.pelvis, bottom), spine);
    spine.add(mesh(this.geo.torso, top, 0.28));
    spine.add(head); head.position.y = 0.62;
    head.add(mesh(this.geo.head, skin, 0.1));
    const hair = mesh(this.geo.hair, this.mats.hair, 0.12); head.add(hair);
    for (const [arm, fore, sx] of [[armL, foreL, -1], [armR, foreR, 1]] as const) {
      spine.add(arm); arm.position.set(sx * 0.2, 0.5, 0);
      arm.add(mesh(this.geo.upper, top, -0.15));
      arm.add(fore); fore.position.y = -0.3;
      fore.add(mesh(this.geo.lower, skin, -0.14));
    }
    for (const [leg, shin, sx] of [[legL, shinL, -1], [legR, shinR, 1]] as const) {
      hips.add(leg); leg.position.set(sx * 0.09, -0.05, 0);
      leg.add(mesh(this.geo.thigh, female ? skin : bottom, -0.2));
      leg.add(shin); shin.position.y = -0.42;
      shin.add(mesh(this.geo.shin, skin, -0.2));
      const foot = mesh(this.geo.foot, this.mats.wood, -0.42); foot.position.z = 0.04; shin.add(foot);
    }
    if (female) { const sk = mesh(this.geo.skirt, bottom, -0.28); sk.material = bottom; hips.add(sk); }
    root.add(prop);
    const s = child ? 0.62 + r() * 0.12 : female ? 0.95 + r() * 0.05 : 1.0 + r() * 0.06;
    root.scale.setScalar(s);
    this.group.add(root);
    return { root, hips, spine, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, prop };
  }

  private addProp(p: Person) {
    const pr = p.rig.prop;
    pr.clear();
    const m = (g: THREE.BufferGeometry, mat: THREE.Material) => { const o = new THREE.Mesh(g, mat); o.castShadow = true; pr.add(o); return o; };
    switch (p.activity) {
      case 'pound': {
        const mortar = m(this.geo.mortar, this.mats.wood); mortar.position.set(0, 0.3, 0.45);
        const pestle = m(this.geo.stick, this.mats.woodLight); pestle.scale.y = 1.7; pestle.name = 'pestle'; pestle.position.set(0, 1.25, 0.45);
        break;
      }
      case 'carry': { const basin = m(this.geo.basin, this.mats.basin); basin.position.set(0, 1.78, 0); break; }
      case 'firewood': {
        for (let k = 0; k < 6; k++) { const st = m(this.geo.bundle, this.mats.woodLight); st.rotation.z = Math.PI / 2; st.position.set(0, 1.74 + (k % 3) * 0.06, (k - 2.5) * 0.05); }
        break;
      }
      case 'baby': { const baby = m(this.geo.baby, this.clothes[3]); baby.position.set(0, 1.15, -0.2); baby.scale.set(1, 1.2, 0.9); break; }
      case 'hoe': {
        const handle = m(this.geo.stick, this.mats.woodLight); handle.name = 'hoe'; handle.scale.y = 1.1;
        const blade = new THREE.Mesh(this.geo.hoeBlade, this.mats.basin); blade.position.y = -0.55; handle.add(blade);
        break;
      }
      case 'sit': { const bench = m(this.geo.bench, this.mats.wood); bench.position.set(0, 0.42, -0.05); break; }
    }
  }

  private spawn(activity: Activity, x: number, z: number, seed: number, extra: Partial<Person> = {}) {
    const r = rng(seed);
    const child = activity === 'play' || activity === 'firewood' || (activity === 'walk' && r() < 0.2);
    const female = activity === 'pound' || activity === 'baby' || activity === 'carry' ? true : activity === 'hoe' ? r() < 0.5 : r() < 0.5;
    const rig = this.makeRig(female, child, seed);
    const p: Person = {
      rig, activity, child, female, pos: new THREE.Vector3(x, this.data.heightAt(x, z), z), heading: r() * Math.PI * 2,
      speed: child ? 1.6 : 1.1 + r() * 0.3, phase: r() * 10, path: null, pathT: 0, pathDir: 1, center: null, radius: 0, village: null, ...extra,
    };
    this.addProp(p);
    this.people.push(p);
  }

  private buildPeople(eye: THREE.Vector3) {
    for (const p of this.people) this.group.remove(p.rig.root);
    this.people.length = 0;
    const near = this.data.buildingsNear(eye.x, eye.z, 160);
    if (near.length < 3) return;
    const np = this.data.nearestPlace(eye.x, eye.z);
    const village = np && np.d < 2500 ? np.place.name : null;
    const cand: [number, () => void][] = [];
    for (const b of near) {
      const h = hash2(Math.floor(b.x * 2), Math.floor(b.z * 2), 21);
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const fx = b.x - s * (b.d / 2 + 2.2), fz = b.z + c * (b.d / 2 + 2.2); // in front of the house
      if (this.data.buildingAt(fx, fz, 0.6)) continue;
      const d = Math.hypot(fx - eye.x, fz - eye.z);
      const face = Math.atan2(s, -c) + Math.PI; // face the house front... roughly
      if (h < 0.18) cand.push([d, () => this.spawn('pound', fx, fz, Math.floor(h * 1e6), { heading: face, village })]);
      else if (h < 0.28) cand.push([d, () => {
        this.spawn('sit', fx, fz, Math.floor(h * 1e6), { heading: face, village });
        this.spawn('sit', fx + c * 0.7, fz + s * 0.7, Math.floor(h * 1e6) + 1, { heading: face, village });
      }]);
      else if (h < 0.34) cand.push([d, () => this.spawn('baby', fx, fz, Math.floor(h * 1e6), { heading: face + 1.2, village })]);
      else if (h < 0.40) cand.push([d, () => {
        const center = new THREE.Vector3(fx, 0, fz);
        for (let k = 0; k < 3; k++) this.spawn('play', fx, fz, Math.floor(h * 1e6) + k, { center, radius: 2.2 + k * 0.6, phase: k * 2.1, village });
      }]);
    }
    // walkers on the real paths and streets
    const roads = this.data.roadsNear(eye.x, eye.z, 150).filter((rd) => rd.k !== 'trunk' && rd.p.length >= 4);
    roads.forEach((rd, i) => {
      const pts: [number, number][] = [];
      for (let k = 0; k < rd.p.length; k += 2) pts.push([rd.p[k], rd.p[k + 1]]);
      const kinds: Activity[] = ['walk', 'carry', 'firewood', 'walk'];
      for (let q = 0; q < Math.min(2, Math.ceil(pts.length / 6)); q++) {
        const a = kinds[(i + q) % kinds.length];
        const t0 = hash2(i, q, 31) * (pts.length - 1);
        const [x, z] = pts[Math.floor(t0)];
        cand.push([Math.hypot(x - eye.x, z - eye.z), () => this.spawn(a, x, z, i * 31 + q * 7 + 5, { path: pts, pathT: t0, pathDir: q % 2 ? -1 : 1, village })]);
      }
    });
    // hoeing in nearby fields (WorldCover cropland) – rice / cassava fields per the Bossou sources
    for (let k = 0; k < 24; k++) {
      const a = k * 2.4, d = 40 + (k % 6) * 25;
      const x = eye.x + Math.cos(a) * d, z = eye.z + Math.sin(a) * d;
      if (this.data.attrAt(x, z).cls === 40 && !this.data.buildingAt(x, z, 2)) cand.push([d, () => this.spawn('hoe', x, z, 900 + k, { heading: a, village })]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    for (const [, fn] of cand) { if (this.people.length >= this.maxPeople) break; fn(); }
  }

  update(eye: THREE.Vector3, dt: number, time: number) {
    if (this.last.distanceTo(eye) > 120) { this.last.copy(eye); this.buildHouses(eye); }
    if (this.lastPeople.distanceTo(eye) > 70) { this.lastPeople.copy(eye); this.buildPeople(eye); }
    for (const p of this.people) this.animate(p, dt, time);
  }

  /** Force a rebuild (after OSM tiles arrive or a jump). */
  reset() { this.last.set(1e9, 0, 1e9); this.lastPeople.set(1e9, 0, 1e9); }

  private animate(p: Person, dt: number, time: number) {
    const R = p.rig, t = time + p.phase;
    const set = (g: THREE.Group, x: number, y = 0, z = 0) => g.rotation.set(x, y, z);
    let moving = false;
    if (p.path && (p.activity === 'walk' || p.activity === 'carry' || p.activity === 'firewood' || p.activity === 'baby')) {
      // walk along the real path, turn back at its ends
      const pts = p.path;
      let i = Math.floor(p.pathT);
      const [ax, az] = pts[Math.min(pts.length - 1, i)], [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
      const segLen = Math.max(0.1, Math.hypot(bx - ax, bz - az));
      p.pathT += (p.speed * dt / segLen) * p.pathDir;
      if (p.pathT >= pts.length - 1.001) { p.pathT = pts.length - 1.001; p.pathDir = -1; }
      if (p.pathT <= 0) { p.pathT = 0; p.pathDir = 1; }
      i = Math.floor(p.pathT);
      const f = p.pathT - i;
      const [cx, cz] = pts[i], [dx, dz] = pts[Math.min(pts.length - 1, i + 1)];
      // keep slightly to one side of the path
      const nx = -(dz - cz), nz = dx - cx, nl = Math.hypot(nx, nz) || 1;
      const side = (p.pathDir > 0 ? 0.5 : -0.5);
      p.pos.set(cx + (dx - cx) * f + nx / nl * side, 0, cz + (dz - cz) * f + nz / nl * side);
      p.heading = Math.atan2(dx - cx, dz - cz) + (p.pathDir < 0 ? Math.PI : 0);
      moving = true;
    } else if (p.activity === 'play' && p.center) {
      const a = t * 1.3 / p.radius * 1.6;
      p.pos.set(p.center.x + Math.cos(a) * p.radius, 0, p.center.z + Math.sin(a) * p.radius);
      p.heading = Math.atan2(-Math.sin(a), Math.cos(a));
      moving = true;
    }
    p.pos.y = this.data.heightAt(p.pos.x, p.pos.z);
    R.root.position.copy(p.pos);
    R.root.rotation.y = p.heading;
    // reset pose
    for (const g of [R.spine, R.head, R.armL, R.armR, R.foreL, R.foreR, R.legL, R.legR, R.shinL, R.shinR]) g.rotation.set(0, 0, 0);
    R.hips.position.y = 0.9;
    if (moving) {
      const w = t * (p.child ? 9 : 6.2) * (p.speed / 1.2);
      const sw = Math.sin(w);
      set(R.legL, sw * 0.5); set(R.legR, -sw * 0.5);
      set(R.shinL, Math.max(0, -Math.cos(w)) * 0.7); set(R.shinR, Math.max(0, Math.cos(w)) * 0.7);
      R.hips.position.y = 0.9 + Math.abs(Math.cos(w)) * 0.03;
      if (p.activity === 'carry' || p.activity === 'firewood') {
        // one arm steadies the load on the head
        set(R.armR, -2.9, 0, 0.15); set(R.foreR, -0.3);
        set(R.armL, -sw * 0.35);
      } else {
        set(R.armL, -sw * 0.4); set(R.armR, sw * 0.4);
        set(R.foreL, -0.25); set(R.foreR, -0.25);
      }
      if (p.activity === 'play') R.hips.position.y += Math.max(0, Math.sin(w * 0.5)) * 0.08;
    } else {
      switch (p.activity) {
        case 'pound': {
          // both hands on the pestle, lifted and driven down into the mortar
          const c = (Math.sin(t * 4.2) + 1) / 2;
          set(R.spine, 0.12 + c * 0.05);
          set(R.armL, -1.4 - c * 0.9, 0, 0.25); set(R.armR, -1.4 - c * 0.9, 0, -0.25);
          set(R.foreL, -0.6 + c * 0.3); set(R.foreR, -0.6 + c * 0.3);
          const pestle = R.prop.getObjectByName('pestle');
          if (pestle) pestle.position.y = 1.05 + c * 0.5;
          set(R.legL, 0.05); set(R.legR, -0.05);
          break;
        }
        case 'hoe': {
          const c = (Math.sin(t * 2.4) + 1) / 2;
          set(R.spine, 0.55 + c * 0.15);
          set(R.armL, -0.6 - c * 1.6, 0, 0.2); set(R.armR, -0.6 - c * 1.6, 0, -0.2);
          set(R.legL, 0.35); set(R.legR, -0.25); set(R.shinL, 0.2);
          const hoe = R.prop.getObjectByName('hoe');
          if (hoe) { hoe.position.set(0, 1.0 - c * 0.2, 0.55 + c * 0.1); hoe.rotation.x = -0.3 - c * 1.2; }
          break;
        }
        case 'sit': {
          R.hips.position.y = 0.5;
          set(R.legL, -1.5); set(R.legR, -1.5); set(R.shinL, 1.5); set(R.shinR, 1.5);
          set(R.armL, -0.4, 0, 0.1); set(R.foreL, -1.0);
          set(R.armR, -0.5 - Math.max(0, Math.sin(t * 0.9)) * 0.6, 0, -0.1); set(R.foreR, -1.1); // talking gesture
          set(R.head, 0, Math.sin(t * 0.4) * 0.4);
          break;
        }
        case 'baby': {
          set(R.armL, -0.2, 0, 0.1); set(R.armR, 0.2, 0, -0.1);
          set(R.spine, 0.05 + Math.sin(t * 1.4) * 0.03); // gentle rocking
          set(R.head, 0, Math.sin(t * 0.3) * 0.5);
          break;
        }
        default: {
          set(R.head, 0, Math.sin(t * 0.3) * 0.4);
          set(R.armL, Math.sin(t) * 0.05); set(R.armR, -Math.sin(t) * 0.05);
        }
      }
    }
  }

  /** Nearest person or house hit by a ray (for the info card). */
  pick(ray: THREE.Ray): { kind: 'person'; p: Person; t: number } | { kind: 'house'; h: HouseInst; t: number } | null {
    let best: { kind: 'person'; p: Person; t: number } | { kind: 'house'; h: HouseInst; t: number } | null = null;
    const v = new THREE.Vector3();
    for (const p of this.people) {
      const c = v.copy(p.pos); c.y += 0.9 * p.rig.root.scale.y;
      const hit = ray.intersectSphere(new THREE.Sphere(c, 0.55 * p.rig.root.scale.y), new THREE.Vector3());
      if (hit) { const t = hit.distanceTo(ray.origin); if (!best || t < best.t) best = { kind: 'person', p, t }; }
    }
    for (const h of this.houses) {
      const b = h.b;
      const r = Math.max(b.w, b.d) / 2 + 0.4;
      if (Math.hypot(b.x - ray.origin.x, b.z - ray.origin.z) > 160) continue;
      const box = new THREE.Box3(new THREE.Vector3(b.x - r * 0.75, h.base, b.z - r * 0.75), new THREE.Vector3(b.x + r * 0.75, h.base + h.wallH + h.roofH, b.z + r * 0.75));
      const hit = ray.intersectBox(box, new THREE.Vector3());
      if (hit) { const t = hit.distanceTo(ray.origin); if (!best || t < best.t) best = { kind: 'house', h, t }; }
    }
    return best;
  }

  /** Simple obstacle test for the walker. */
  collide(pos: THREE.Vector3, radius: number) {
    for (const h of this.houses) {
      const b = h.b;
      if (Math.abs(pos.x - b.x) > 12 || Math.abs(pos.z - b.z) > 12) continue;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const dx = pos.x - b.x, dz = pos.z - b.z;
      let u = dx * c + dz * s, v = -dx * s + dz * c;
      const hu = (h.round ? Math.min(b.w, b.d) : b.w) / 2 + radius, hv = (h.round ? Math.min(b.w, b.d) : b.d) / 2 + radius;
      if (Math.abs(u) < hu && Math.abs(v) < hv) {
        if (hu - Math.abs(u) < hv - Math.abs(v)) u = Math.sign(u || 1) * hu; else v = Math.sign(v || 1) * hv;
        pos.x = b.x + u * c - v * s; pos.z = b.z + u * s + v * c;
      }
    }
  }
}

export type { Road };
