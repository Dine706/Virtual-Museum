import hornbillFlight from './hornbill-flight.json';
// Animals recorded in GBIF in the Nimba window, drawn as simple procedural models (not photographs, not scans):
// African pied hornbills crossing above the canopy, Guinea turacos flashing their red flight feathers between
// crowns, sunbirds near shrubs, Acraea and swallowtail butterflies in clearings and along streams.
// Where an animal appears is illustrative (habitat + altitude band from the records), never a real location.
import * as THREE from 'three';
import type { WalkData } from './data';
import { biomeAt } from './biome';
import { walkMaterial } from './env';
import { wingTexture } from './textures';
import { rng } from './noise';

export type AnimalKind = 'hornbill' | 'turaco' | 'sunbird' | 'acraea' | 'swallowtail' | 'graphium';

export interface Agent {
  kind: AnimalKind;
  obj: THREE.Object3D;
  flap: { value: number };
  pos: THREE.Vector3; vel: THREE.Vector3; target: THREE.Vector3;
  speed: number; height: number; size: number; phase: number; rate: number; glide: number;
}

interface Part { geo: THREE.BufferGeometry; color: string }

/** Low-poly bird: body, head, bill, tail and two wings (aWing marks how far a vertex is along the wing). */
function birdGeometry(kind: 'hornbill' | 'turaco' | 'sunbird'): THREE.BufferGeometry {
  const parts: Part[] = [];
  const C = kind === 'hornbill'
    ? { back: '#111111', belly: '#E8E4DA', wing: '#141414', tip: '#151515', bill: '#E3D3A0', head: '#121212', tail: '#EDEDED' }
    : kind === 'turaco'
      ? { back: '#2E7A3A', belly: '#3E8E45', wing: '#2B6B36', tip: '#B3122A', bill: '#C9492E', head: '#2F8A40', tail: '#22303F' }
      : { back: '#1F6F4A', belly: '#B8323A', wing: '#2A3F2C', tip: '#283828', bill: '#111111', head: '#1E7A4F', tail: '#203020' };
  const body = new THREE.SphereGeometry(0.5, 10, 8);
  body.scale(0.32, 0.3, 1);
  parts.push({ geo: body, color: C.back });
  const belly = new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  belly.scale(0.3, 0.28, 0.9);
  belly.translate(0, -0.01, 0);
  parts.push({ geo: belly, color: C.belly });
  const head = new THREE.SphereGeometry(0.15, 8, 6);
  head.translate(0, 0.08, 0.52);
  parts.push({ geo: head, color: C.head });
  const billLen = kind === 'hornbill' ? 0.45 : kind === 'sunbird' ? 0.32 : 0.12;
  const bill = new THREE.ConeGeometry(kind === 'hornbill' ? 0.08 : 0.04, billLen, 6);
  bill.rotateX(Math.PI / 2 + (kind === 'sunbird' ? 0.25 : 0.12));
  bill.translate(0, 0.05, 0.62 + billLen / 2);
  parts.push({ geo: bill, color: C.bill });
  if (kind === 'hornbill') {
    const casque = new THREE.SphereGeometry(0.07, 6, 4);
    casque.scale(0.7, 0.6, 2.2);
    casque.translate(0, 0.14, 0.72);
    parts.push({ geo: casque, color: C.bill });
  }
  if (kind === 'turaco') {
    const crest = new THREE.ConeGeometry(0.07, 0.22, 5);
    crest.translate(0, 0.25, 0.48);
    parts.push({ geo: crest, color: C.head });
  }
  const tail = new THREE.PlaneGeometry(kind === 'sunbird' ? 0.18 : 0.28, kind === 'hornbill' ? 0.75 : 0.6);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, -0.7);
  parts.push({ geo: tail, color: C.tail });
  const span = kind === 'hornbill' ? 1.25 : kind === 'turaco' ? 0.95 : 0.7;
  // Wings: a strip from root to tip; the outer third is the "tip" colour (turaco: crimson primaries).
  const wing = (side: number) => {
    const g = new THREE.BufferGeometry();
    const p: number[] = [], w: number[] = [], c: number[] = [];
    const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = side * (0.12 + t * span);
      const chord = 0.45 * (1 - t * 0.55);
      p.push(x, 0.04, 0.18, x, 0.04, 0.18 - chord);
      w.push(t, t);
      const col = new THREE.Color(t > 0.62 ? C.tip : C.wing);
      c.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // Merge everything into one geometry with colour + aWing attributes.
  const all: THREE.BufferGeometry[] = [];
  for (const part of parts) {
    const g = part.geo.toNonIndexed();
    const n = g.attributes.position.count;
    const col = new THREE.Color(part.color);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [col.r, col.g, col.b]), 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(new Array(n).fill(0), 1));
    g.deleteAttribute('uv');
    all.push(g);
  }
  for (const side of [-1, 1]) {
    const g = wing(side).toNonIndexed();
    all.push(g);
  }
  return merge(all);
}

function butterflyGeometry(): THREE.BufferGeometry {
  // Two wings hinged on the body axis (z); uv mirrored on the left wing.
  const g = new THREE.BufferGeometry();
  const p = [0, 0, 0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, -1, 0, 0.5, -1, 0, -0.5, 0, 0, -0.5];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
  const w = [0, 1, 1, 0, 0, 1, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  return g;
}

function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color', 'aWing'];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = name === 'aWing' ? 1 : 3;
    const arr: number[] = [];
    for (const g of gs) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const a = g.attributes[name];
      for (let i = 0; i < a.count * size; i++) arr.push((a.array as ArrayLike<number>)[i]);
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  return out;
}

function flapMaterial(base: THREE.MeshStandardMaterial, flap: { value: number }, amp: number, butterfly: boolean) {
  return walkMaterial(base, 'none', (s) => {
    s.uniforms.uFlap = flap;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing; uniform float uFlap;')
      .replace('#include <begin_vertex>', butterfly
        ? `#include <begin_vertex>
           { float a = sin(uFlap) * ${amp.toFixed(2)} * aWing; float x = transformed.x; transformed.x = x * cos(a); transformed.y += abs(x) * sin(a); }`
        : `#include <begin_vertex>
           { float a = sin(uFlap) * ${amp.toFixed(2)}; float x = transformed.x; float k = aWing;
             transformed.y += abs(x) * sin(a * k) * 0.9; transformed.x = x * mix(1.0, cos(a), k); }`);
  }, `flap:${amp}:${butterfly}`);
}

export class Fauna {
  readonly group = new THREE.Group();
  readonly agents: Agent[] = [];
  private r = rng(4242);
  /** Walker's view direction (yaw, radians): new animals favour what the walker is looking at. */
  viewYaw = 0;
  private geos: Partial<Record<AnimalKind, THREE.BufferGeometry>> = {};
  private wingTex: Partial<Record<AnimalKind, THREE.Texture>> = {};
  readonly site = new THREE.Group();
  sitePos: THREE.Vector3 | null = null;

  constructor(private data: WalkData, private counts: { birds: number; butterflies: number }) {
    for (const k of ['hornbill', 'turaco', 'sunbird'] as const) this.geos[k] = birdGeometry(k);
    this.geos.acraea = this.geos.swallowtail = this.geos.graphium = butterflyGeometry();
    this.wingTex.acraea = wingTexture('acraea');
    this.wingTex.swallowtail = wingTexture('swallowtail');
    this.wingTex.graphium = wingTexture('graphium');
    this.group.add(this.site);
  }

  private spawn(kind: AnimalKind, eye: THREE.Vector3): Agent {
    const flap = { value: 0 };
    const butterfly = kind === 'acraea' || kind === 'swallowtail' || kind === 'graphium';
    const mat = butterfly
      ? flapMaterial(new THREE.MeshStandardMaterial({ map: this.wingTex[kind]!, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }), flap, 1.1, true)
      : flapMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), flap, kind === 'hornbill' ? 0.5 : 0.7, false);
    const mesh = new THREE.Mesh(this.geos[kind]!, mat);
    mesh.castShadow = false;
    const size = kind === 'hornbill' ? 0.6 : kind === 'turaco' ? 0.45 : kind === 'sunbird' ? 0.12 : kind === 'swallowtail' ? 0.09 : kind === 'graphium' ? 0.05 : 0.04;
    mesh.scale.setScalar(butterfly ? size : size);
    mesh.userData.agent = true;
    const a: Agent = {
      kind, obj: mesh, flap, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(),
      speed: kind === 'hornbill' ? 7 : kind === 'turaco' ? 6 : kind === 'sunbird' ? 5 : 1.4,
      height: 0, size, phase: this.r() * 10, rate: kind === 'hornbill' ? 5 : kind === 'turaco' ? 9 : kind === 'sunbird' ? 28 : 22, glide: 0,
    };
    this.place(a, eye, true);
    this.group.add(mesh);
    this.agents.push(a);
    return a;
  }

  /** Choose where an animal of this kind fits near the walker (or return false). */
  private suitable(kind: AnimalKind, x: number, z: number): boolean {
    const b = biomeAt(this.data, x, z);
    switch (kind) {
      case 'hornbill': case 'turaco': return b.forest > 0.25 && b.elev < 1400;
      case 'sunbird': return b.elev < 1400 && b.forest < 0.95;
      case 'acraea': return b.elev < 1100 && b.forest < 0.9;
      case 'swallowtail': return b.elev < 1400;
      case 'graphium': return b.elev > 1200;
    }
  }

  private place(a: Agent, eye: THREE.Vector3, initial: boolean) {
    const bird = a.kind === 'hornbill' || a.kind === 'turaco' || a.kind === 'sunbird';
    const R = a.kind === 'hornbill' ? 70 : a.kind === 'turaco' ? 26 : a.kind === 'sunbird' ? 14 : 10;
    for (let tries = 0; tries < 16; tries++) {
      // two thirds of placements fall within ±55° of the view direction
      const fwd = -Math.PI / 2 - this.viewYaw;
      const ang = this.r() < 0.67 ? fwd + (this.r() - 0.5) * 1.9 : this.r() * Math.PI * 2;
      const d = (bird ? R * 0.35 : 2.5) + this.r() * R * (initial ? 0.8 : 1);
      const x = eye.x + Math.cos(ang) * d, z = eye.z + Math.sin(ang) * d;
      if (!this.suitable(a.kind, x, z)) continue;
      const b = biomeAt(this.data, x, z);
      a.height = a.kind === 'hornbill' ? Math.max(b.canopy * 0.8, 12) + this.r() * 10 : a.kind === 'turaco' ? 4 + this.r() * Math.max(4, b.canopy * 0.6) : a.kind === 'sunbird' ? 1.2 + this.r() * 2.5 : 0.7 + this.r() * 1.6;
      a.pos.set(x, this.data.heightAt(x, z) + a.height, z);
      this.newTarget(a, eye);
      a.obj.visible = true;
      return;
    }
    a.obj.visible = false;
    a.pos.set(eye.x, -1e4, eye.z);
  }

  private newTarget(a: Agent, eye: THREE.Vector3) {
    const bird = a.kind === 'hornbill' || a.kind === 'turaco' || a.kind === 'sunbird';
    const span = a.kind === 'hornbill' ? 90 : a.kind === 'turaco' ? 25 : bird ? 8 : 4;
    for (let tries = 0; tries < 6; tries++) {
      const x = a.pos.x + (this.r() - 0.5) * span * 2, z = a.pos.z + (this.r() - 0.5) * span * 2;
      if (!this.suitable(a.kind, x, z) && tries < 5) continue;
      const toEye = Math.hypot(x - eye.x, z - eye.z);
      if (toEye > (a.kind === 'hornbill' ? 110 : bird ? 35 : 12) && tries < 5) continue;
      a.target.set(x, this.data.heightAt(x, z) + a.height * (0.8 + this.r() * 0.4), z);
      return;
    }
  }

  /** Populate for the walker's surroundings (called when the walker arrives / moves far). */
  populate(eye: THREE.Vector3) {
    for (const a of this.agents) { this.group.remove(a.obj); ((a.obj as THREE.Mesh).material as THREE.Material).dispose(); }
    this.agents.length = 0;
    const b = biomeAt(this.data, eye.x, eye.z);
    const nb = this.counts.birds, nf = this.counts.butterflies;
    const kinds: AnimalKind[] = [];
    if (b.elev < 1400) {
      for (let i = 0; i < Math.round(nb * 0.35); i++) kinds.push('hornbill');
      for (let i = 0; i < Math.round(nb * 0.35); i++) kinds.push('turaco');
      for (let i = 0; i < Math.round(nb * 0.3); i++) kinds.push('sunbird');
    }
    const fly: AnimalKind[] = b.elev > 1300 ? ['graphium'] : b.elev < 1000 ? ['acraea', 'acraea', 'swallowtail'] : ['swallowtail', 'acraea'];
    for (let i = 0; i < nf; i++) kinds.push(fly[i % fly.length]);
    for (const k of kinds) this.spawn(k, eye);
  }

  update(dt: number, eye: THREE.Vector3, time: number) {
    const dir = new THREE.Vector3();
    for (const a of this.agents) {
      if (!a.obj.visible) { if (this.r() < 0.05) this.place(a, eye, false); continue; }
      const bird = a.kind === 'hornbill' || a.kind === 'turaco' || a.kind === 'sunbird';
      dir.subVectors(a.target, a.pos);
      const dist = dir.length();
      if (dist < (bird ? 3 : 0.6)) this.newTarget(a, eye);
      dir.normalize();
      // butterflies: erratic; birds: smooth turns
      if (!bird) { dir.x += Math.sin(time * 3.1 + a.phase) * 0.9; dir.y += Math.sin(time * 5.3 + a.phase * 2) * 0.8; dir.z += Math.cos(time * 2.7 + a.phase) * 0.9; dir.normalize(); }
      const turn = bird ? 1.6 : 4;
      a.vel.lerp(dir.multiplyScalar(a.speed), 1 - Math.exp(-dt * turn));
      a.pos.addScaledVector(a.vel, dt);
      const ground = this.data.heightAt(a.pos.x, a.pos.z);
      if (a.pos.y < ground + 0.3) a.pos.y = ground + 0.3;
      a.obj.position.copy(a.pos);
      if (a.vel.lengthSq() > 1e-4) {
        const yaw = Math.atan2(a.vel.x, a.vel.z);
        const pitch = -Math.atan2(a.vel.y, Math.hypot(a.vel.x, a.vel.z)) * 0.6;
        a.obj.rotation.set(pitch, yaw, 0, 'YXZ');
      }
      if (a.kind === 'hornbill') {
        const frame = (time * 24 + a.phase * 7) % hornbillFlight.length;
        const i = Math.floor(frame);
        a.flap.value = THREE.MathUtils.lerp(hornbillFlight[i], hornbillFlight[(i + 1) % hornbillFlight.length], frame - i);
      } else a.flap.value = time * a.rate + a.phase;
      if (a.pos.distanceTo(eye) > (a.kind === 'hornbill' ? 200 : bird ? 60 : 20)) this.place(a, eye, false);
    }
  }

  /** The Bossou stone-tool site: illustrative, beside an oil palm (Bossou chimpanzees crack oil-palm nuts). */
  buildSite(at: THREE.Vector3, rockMat: THREE.Material) {
    this.site.clear();
    const anvil = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.16, 9), rockMat);
    anvil.position.set(0, 0.05, 0);
    anvil.rotation.set(0.05, 0.4, 0.03);
    const hammer = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), rockMat);
    hammer.scale.set(1.3, 0.8, 1);
    hammer.position.set(0.48, 0.07, 0.15);
    const nutMat = walkMaterial(new THREE.MeshStandardMaterial({ color: '#3B2416', roughness: 0.6 }));
    const shellMat = walkMaterial(new THREE.MeshStandardMaterial({ color: '#6B4A2A', roughness: 0.8 }));
    const r = rng(77);
    for (let k = 0; k < 26; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), k < 8 ? nutMat : shellMat);
      const a = r() * 6.28, d = 0.35 + r() * 0.6;
      m.position.set(Math.cos(a) * d, 0.012, Math.sin(a) * d);
      m.scale.set(1, k < 8 ? 0.9 : 0.4, 1);
      this.site.add(m);
    }
    this.site.add(anvil, hammer);
    this.site.position.copy(at);
    this.sitePos = at.clone();
    this.site.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  }
}
