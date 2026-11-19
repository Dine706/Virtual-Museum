// Villages in walk mode, following docs/VILLAGE_SOURCES.md:
// • houses stand on the real OpenStreetMap footprints (© OpenStreetMap contributors, ODbL); small square
//   footprints become round wattle-and-daub huts with thatched cones, the rest rectangular earth-plastered
//   houses with corrugated metal roofs (some rusty, some with a porch) – typical of the region, not surveyed;
// • villagers (fictional, generic figures) do sourced everyday activities: pounding in a mortar, carrying
//   loads or water, a child with firewood, a mother with a baby on her back, hoeing in fields, sitting and
//   talking, children playing, walking along the real paths. No rites, no sacred places, no masks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WalkData, Building } from './data';
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

// ---------------------------------------------------------------- house geometry (unit sizes)

function gableRoof(): THREE.BufferGeometry {
  // Fold the sheet itself so ridges catch grazing light along the full roof.
  const p:number[]=[],uv:number[]=[],idx:number[]=[];
  const divisions=112;
  for(let side=0;side<2;side++)for(let i=0;i<=divisions;i++){
    const x=i/divisions-.5, fold=(i%2)*.014;
    const k=p.length/3;
    p.push(x,fold,side-.5,x,1+fold,0);
    uv.push(i/divisions*2,0,i/divisions*2,1);
    if(i)idx.push(k-2,k-1,k,k,k-1,k+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
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

export interface Person {
  root:THREE.Group; activity:'sit'; pos:THREE.Vector3; village:string|null;
}
export class Village {
  readonly group = new THREE.Group();
  readonly houses: HouseInst[] = [];
  readonly people: Person[] = [];
  private houseMeshes: THREE.Object3D[] = [];
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private lastPeople = new THREE.Vector3(1e9, 0, 1e9);
  private mats: Record<string, THREE.Material> = {};
  private residents:THREE.Group[]=[];
  private residentLoad=false;
  private seat=new THREE.BoxGeometry(.50,.085,.38);
  private seatLeg=new THREE.CylinderGeometry(.031,.042,.44,8);
  private artRequested = false;
  private disposed = false;

  constructor(private data: WalkData, private maxPeople: number, private base:string, private detailed:boolean) {
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
    this.mats.joinery = W(new THREE.MeshStandardMaterial({ color: 0x694b39, roughness: 0.87 }));
    this.mats.woodLight = W(new THREE.MeshStandardMaterial({ color: '#7d5a38', roughness: 0.8 }));
    this.mats.hair = W(new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.95 }));
    this.mats.basin = W(new THREE.MeshStandardMaterial({ color: '#9aa3a8', roughness: 0.35, metalness: 0.6 }));

  }

  // ---------------------------------------------------------------- houses

  private streamMaterials() {
    if (!this.detailed || this.artRequested) return;
    this.artRequested = true;
    const surfaces: Record<string, string[]> = {
      door: ['wallDoor', 'wallDoor2', 'hutWall'], windows: ['wallWin', 'wallWin2'],
      plaster: ['gable'], boards: ['joinery'], zinc: ['metal', 'rust'], thatch: ['thatch'],
    };
    const loader = new THREE.TextureLoader();
    for (const [file, names] of Object.entries(surfaces)) {
      void loader.loadAsync(`${this.base}walk/art/village/${file}.webp`).then(map => {
        if (this.disposed) { map.dispose(); return; }
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = 4;
        for (const name of names) {
          const material = this.mats[name] as THREE.MeshStandardMaterial;
          material.map?.dispose();
          material.map = map;
          material.bumpMap = map;
          material.bumpScale = file === 'zinc' ? 0.055 : 0.024;
          if (name === 'joinery') material.color.set(0xffffff);
          if (name === 'rust') material.color.set('#ba947b');
          material.needsUpdate = true;
        }
      }).catch(() => { /* Retain the procedural building material when a detail map is unavailable. */ });
    }
  }

  dispose() { this.disposed = true; }

  private buildHouses(eye: THREE.Vector3) {
    for (const m of this.houseMeshes) { this.group.remove(m); (m as THREE.InstancedMesh).dispose?.(); }
    this.houseMeshes = [];
    this.houses.length = 0;
    const list = this.data.buildingsNear(eye.x, eye.z, 650);
    if(list.length){
      this.streamMaterials();
      if(!this.residentLoad){
        this.residentLoad=true;
        const loader=new GLTFLoader();
        void Promise.all([0,1,2].map(i=>loader.loadAsync(this.base+'walk/models/resident-'+i+'.glb'))).then(assets=>{
          if(this.disposed)return;
          this.residents=assets.map(asset=>{
            asset.scene.traverse(o=>{if(o instanceof THREE.Mesh){walkMaterial(o.material);o.castShadow=true;o.receiveShadow=true;}});
            return asset.scene;
          });
          this.lastPeople.set(Infinity,0,0);
        }).catch(()=>{this.residentLoad=false;});
      }
    }
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
    const trim = mk(box, this.mats.joinery, n((x) => !x.round) * 25);
    const steps=mk(box,this.mats.gable,n(x=>!x.round)*2);
    const pots=mk(new THREE.LatheGeometry([new THREE.Vector2(.15,0),new THREE.Vector2(.30,.11),new THREE.Vector2(.34,.36),new THREE.Vector2(.23,.48),new THREE.Vector2(.20,.46)],20),this.mats.woodLight,this.houses.length);
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
      const yardX=b.x-Math.sin(b.a)*(b.d/2+.72)+Math.cos(b.a)*b.w*.32;
      const yardZ=b.z+Math.cos(b.a)*(b.d/2+.72)+Math.sin(b.a)*b.w*.32;
      put(pots,yardX,this.data.heightAt(yardX,yardZ)-.03,yardZ,rot,1,1,1);
      if (h.round) {
        const r = Math.min(b.w, b.d);
        put(mHut, b.x, h.base, b.z, rot, r, h.wallH, r);
        put(mCone, b.x, h.base + h.wallH - 0.05, b.z, rot, r * 1.35, h.roofH, r * 1.35);
      } else {
        put(h.rust < 0.6 ? mWallA : mWallB, b.x, h.base, b.z, rot, b.w, h.wallH, b.d);
        put(h.rust < 0.55 ? mRoofM : mRoofR, b.x, h.base + h.wallH, b.z, rot, b.w + 0.7, h.roofH, b.d + 0.7);
        put(mEnds, b.x, h.base + h.wallH, b.z, rot, b.w, h.roofH, b.d);
        // Door jambs and header follow the painted opening; shutters flank both side windows.
        const cos = Math.cos(b.a), sin = Math.sin(b.a);
        const timber = (u: number, v: number, y: number, w: number, height: number, depth: number) =>
          put(trim, b.x + cos*u - sin*v, h.base+y, b.z + sin*u + cos*v, rot, w, height, depth);
        for (const side of [-1, 1]) {
          timber(side*b.w*0.113, b.d/2, 0, 0.09, h.wallH*0.72, 0.17);
          timber(0, side*(b.d/2+0.22), h.wallH-0.06, b.w+0.55, 0.14, 0.13);
          for (const pos of [-0.25, 0.25]) timber(side*b.w/2, pos*b.d, h.wallH*0.44, 0.15, h.wallH*0.22, b.d*0.17);
        }
        timber(0, b.d/2, h.wallH*0.71, b.w*0.23+0.09, 0.11, 0.17);
        for(const side of [-1,1]){
          for(let slat=0;slat<5;slat++) timber(side*(b.w/2+.06),-.25*b.d,h.wallH*.46+slat*.078,.09,.045,b.d*.18);
        }
        for(let i=0;i<2;i++){
          const v=b.d/2+.23+i*.31, px=b.x-sin*v,pz=b.z+cos*v;
          put(steps,px,this.data.heightAt(px,pz)-.045,pz,rot,Math.min(1.6,b.w*.28),.24-i*.09,.42);
        }
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

  private buildPeople(eye:THREE.Vector3){
    for(const p of this.people)this.group.remove(p.root);
    this.people.length=0;
    if(!this.residents.length)return;
    const houses=this.houses.filter(h=>Math.hypot(h.b.x-eye.x,h.b.z-eye.z)<145)
      .sort((p,q)=>Math.hypot(p.b.x-eye.x,p.b.z-eye.z)-Math.hypot(q.b.x-eye.x,q.b.z-eye.z));
    for(const {b} of houses){
      if(this.people.length>=this.maxPeople)break;
      const c=Math.cos(b.a),s=Math.sin(b.a),seed=hash2(Math.floor(b.x),Math.floor(b.z),91);
      if(seed<.36 && this.people.length)continue;
      const village=this.data.nearestPlace(b.x,b.z)?.place.name??null;
      for(let i=0;i<2 && this.people.length<this.maxPeople;i++){
        const u=(i-.5)*1.24,v=b.d/2+1.85;
        const x=b.x+c*u-s*v,z=b.z+s*u+c*v;
        if(this.data.buildingAt(x,z,.4))continue;
        const root=new THREE.Group();
        root.add(this.residents[(Math.floor(seed*19)+i)%3].clone(true));
        const seat=new THREE.Mesh(this.seat,this.mats.wood);seat.position.set(0,.43,-.04);root.add(seat);
        for(const side of [-1,1])for(const end of [-1,1]){
          const leg=new THREE.Mesh(this.seatLeg,this.mats.wood);leg.position.set(side*.19,.20,end*.14-.04);root.add(leg);
        }
        root.position.set(x,this.data.heightAt(x,z),z);
        root.rotation.y=-b.a+(i?-.90:.94);
        this.group.add(root);this.people.push({root,activity:'sit',pos:root.position,village});
      }
    }
  }
  update(eye:THREE.Vector3){
    if(this.last.distanceTo(eye)>120){this.last.copy(eye);this.buildHouses(eye);}
    if(this.lastPeople.distanceTo(eye)>60){this.lastPeople.copy(eye);this.buildPeople(eye);}
  }
  reset(){this.last.set(Infinity,0,0);this.lastPeople.set(Infinity,0,0);}

  /** Nearest person or house hit by a ray (for the info card). */
  pick(ray: THREE.Ray): { kind: 'person'; p: Person; t: number } | { kind: 'house'; h: HouseInst; t: number } | null {
    let best: { kind: 'person'; p: Person; t: number } | { kind: 'house'; h: HouseInst; t: number } | null = null;
    const v = new THREE.Vector3();
    for (const p of this.people) {
      const c = v.copy(p.pos); c.y += 0.9 * p.root.scale.y;
      const hit = ray.intersectSphere(new THREE.Sphere(c, 0.55 * p.root.scale.y), new THREE.Vector3());
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

export type { Road } from "./data";
