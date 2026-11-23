// Things hung on the walls: framed photographic prints with their labels, the introduction text in vinyl
// lettering, section headings and the sign over the doorway. All of them sample the wall's baked lightmap so
// they sit in the same light as the plaster around them (spot scallops included).
import * as THREE from 'three';
import { setAtlasUv1, type Plane } from './bake';
import { lightmapped } from './room';
import { HZ, PRINT_CY, printSize, wallFrame, type ExhibitDef, type Wall } from './layout';

export interface PrintInfo { def: ExhibitDef; aspect: number; number: number; title: string; kicker: string }

const FRAME = 0.028;   // black aluminium frame width
const MAT = 0.075;     // white mat (passe-partout) width
const DEPTH = 0.035;   // frame depth (proud of the wall)

function wallMatrix(wall: Wall, z: number, y: number, out = 0): THREE.Matrix4 {
  const f = wallFrame(wall);
  const m = new THREE.Matrix4();
  // local +x = viewer's right, +y up, +z = out of the wall
  const basisX = f.right.clone(), basisY = new THREE.Vector3(0, 1, 0), basisZ = f.normal.clone();
  m.makeBasis(basisX, basisY, basisZ);
  m.setPosition(f.x + f.normal.x * out, y, z);
  return m;
}

/** Soft contact shadow texture (blurred rectangle), shared by all frames. */
let shadowTex: THREE.CanvasTexture | null = null;
function contactShadow(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.filter = 'blur(9px)';
  g.fillStyle = '#000';
  g.fillRect(22, 22, 84, 84);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export class WallExhibits {
  readonly group = new THREE.Group();
  /** clickable meshes → exhibit id */
  readonly pickables: THREE.Object3D[] = [];
  private photoMats = new Map<string, THREE.MeshStandardMaterial>();
  private labelTex = new Map<string, { tex: THREE.CanvasTexture; draw: () => void }>();
  private envMats: THREE.MeshStandardMaterial[] = [];

  constructor(private planes: Map<string, Plane>, private atlas: THREE.Texture, private lm: number) {}

  get envMaterials() { return this.envMats; }

  addPrint(info: PrintInfo, photo: THREE.Texture, label: () => LabelText) {
    const { def } = info;
    const { w, h } = printSize(info.aspect);
    const wall = def.wall!;
    const plane = this.planes.get(wall)!;
    const M = wallMatrix(wall, def.z!, PRINT_CY);
    const grp = new THREE.Group();
    grp.applyMatrix4(M);
    grp.updateMatrixWorld(true);

    const outerW = w + 2 * (MAT + FRAME), outerH = h + 2 * (MAT + FRAME);
    // Contact shadow on the wall (light comes from above: shifted down a little).
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(outerW * 1.32, outerH * 1.32),
      new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, opacity: 0.32, depthWrite: false, color: 0x000000 }));
    sh.position.set(0, -0.05, 0.002);
    // Frame: four bars.
    const frameMat = lightmapped({ color: 0x1c1c1b, roughness: 0.42, metalness: 0.35 }, this.atlas, this.lm);
    const bars: [number, number, number, number][] = [
      [0, outerH / 2 - FRAME / 2, outerW, FRAME], [0, -outerH / 2 + FRAME / 2, outerW, FRAME],
      [-outerW / 2 + FRAME / 2, 0, FRAME, outerH - 2 * FRAME], [outerW / 2 - FRAME / 2, 0, FRAME, outerH - 2 * FRAME],
    ];
    for (const [x, y, bw, bh] of bars) {
      const g = new THREE.BoxGeometry(bw, bh, DEPTH);
      g.translate(x, y, DEPTH / 2);
      setAtlasUv1(g, plane, grp.matrixWorld);
      grp.add(new THREE.Mesh(g, frameMat));
    }
    // Mat board, slightly recessed, and the print.
    const matMat = lightmapped({ color: 0xf6f4ee, roughness: 0.9 }, this.atlas, this.lm);
    const mg = new THREE.PlaneGeometry(outerW - 2 * FRAME, outerH - 2 * FRAME);
    mg.translate(0, 0, DEPTH - 0.008);
    setAtlasUv1(mg, plane, grp.matrixWorld);
    const photoMat = lightmapped({ map: photo, roughness: 0.62, envMapIntensity: 0.12 }, this.atlas, this.lm);
    const pg = new THREE.PlaneGeometry(w, h);
    pg.translate(0, 0, DEPTH - 0.006);
    setAtlasUv1(pg, plane, grp.matrixWorld);
    const print = new THREE.Mesh(pg, photoMat);
    print.userData.exhibit = def.id;
    grp.add(sh, new THREE.Mesh(mg, matMat), print);
    this.photoMats.set(def.id, photoMat);
    this.envMats.push(frameMat, photoMat);
    this.pickables.push(print);
    this.group.add(grp);

    // Label (cartel): a small acrylic block to the viewer's right of the frame.
    const lw = 0.42, lh = 0.28;
    const lx = outerW / 2 + 0.28 + lw / 2;
    const lab = this.label(def.id, lw, lh, label);
    lab.position.set(lx, 1.32 - PRINT_CY, 0);
    lab.updateMatrix();
    grp.add(lab);
    for (const o of lab.children) setAtlasUv1((o as THREE.Mesh).geometry, plane, grp.matrixWorld.clone().multiply(lab.matrix));
    lab.children.forEach((o) => { o.userData.exhibit = def.id; this.pickables.push(o); });
  }

  /** Swap a print's texture (thumbnail first, full resolution once loaded). */
  setPhoto(id: string, tex: THREE.Texture) {
    const m = this.photoMats.get(id);
    if (!m) return;
    const old = m.map;
    m.map = tex;
    m.needsUpdate = true;
    if (old && old !== tex) old.dispose();
  }

  private label(id: string, w: number, h: number, text: () => LabelText): THREE.Group {
    const c = document.createElement('canvas');
    c.width = 720; c.height = Math.round(720 * (h / w));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const draw = () => { drawLabel(c, text()); tex.needsUpdate = true; };
    draw();
    this.labelTex.set(id, { tex, draw });
    const g = new THREE.Group();
    const d = 0.012;
    const block = new THREE.BoxGeometry(w, h, d);
    block.translate(0, 0, d / 2);
    const edge = lightmapped({ color: 0xf2f1ee, roughness: 0.3, envMapIntensity: 0.6 }, this.atlas, this.lm);
    const face = new THREE.PlaneGeometry(w, h);
    face.translate(0, 0, d + 0.0005);
    const faceMat = lightmapped({ map: tex, roughness: 0.35, envMapIntensity: 0.3 }, this.atlas, this.lm);
    this.envMats.push(edge, faceMat);
    g.add(new THREE.Mesh(block, edge), new THREE.Mesh(face, faceMat));
    return g;
  }

  /** Vinyl lettering applied to a wall (transparent canvas texture). */
  addVinyl(wall: Wall | 'south', z: number, y: number, w: number, h: number, draw: (c: HTMLCanvasElement) => void, id?: string, pxPerM = 420): () => void {
    const c = document.createElement('canvas');
    c.width = Math.round(w * pxPerM); c.height = Math.round(h * pxPerM);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const redraw = () => { draw(c); tex.needsUpdate = true; };
    redraw();
    const plane = this.planes.get(wall)!;
    const mat = lightmapped({ map: tex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }, this.atlas, this.lm);
    const geo = new THREE.PlaneGeometry(w, h);
    let M: THREE.Matrix4;
    if (wall === 'south') {
      M = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(z, y, HZ - 0.003); // z holds x for the south wall
    } else {
      M = wallMatrix(wall, z, y, 0.003);
    }
    geo.applyMatrix4(M);
    setAtlasUv1(geo, plane);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    if (id) { mesh.userData.exhibit = id; this.pickables.push(mesh); }
    this.group.add(mesh);
    return redraw;
  }

  relabel() { for (const l of this.labelTex.values()) l.draw(); }
}

// ---------------------------------------------------------------- canvas typography
export interface LabelText { number: string; title: string; kicker: string; line: string }

const INK = '#22261d';
const SOFT = '#5c6155';
export const DISPLAY = '"Fraunces Variable", Fraunces, Georgia, serif';
export const UI = '"Inter Variable", Inter, system-ui, sans-serif';

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawLabel(c: HTMLCanvasElement, t: LabelText) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#f7f6f2';
  g.fillRect(0, 0, W, H);
  const pad = 46;
  g.fillStyle = INK;
  g.textBaseline = 'alphabetic';
  g.font = `600 74px ${DISPLAY}`;
  g.fillText(t.number, pad, pad + 60);
  g.font = `600 22px ${UI}`;
  g.fillStyle = SOFT;
  g.letterSpacing = '3px';
  g.fillText(t.kicker.toUpperCase(), pad + 98, pad + 26);
  g.letterSpacing = '0px';
  g.fillStyle = INK;
  g.font = `600 40px ${DISPLAY}`;
  const lines = wrap(g, t.title, W - pad * 2 - 98).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, pad + 98, pad + 72 + i * 46));
  g.font = `400 25px ${UI}`;
  g.fillStyle = SOFT;
  const y = Math.max(pad + 72 + lines.length * 46 + 26, H - pad - 34);
  wrap(g, t.line, W - pad * 2).slice(0, 2).forEach((l, i) => g.fillText(l, pad, y + i * 32));
}

export interface IntroText { kicker: string; title: string; body: string; stats: { value: string; label: string }[]; hint: string }

export function drawIntro(c: HTMLCanvasElement, t: IntroText) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const s = W / 4.6 / 420 * 0.86; // scale: px per design-px
  g.clearRect(0, 0, W, H);
  g.fillStyle = INK;
  g.font = `600 ${44 * s}px ${UI}`;
  g.letterSpacing = `${10 * s}px`;
  g.fillText(t.kicker.toUpperCase(), 0, 70 * s);
  g.letterSpacing = '0px';
  g.font = `600 ${190 * s}px ${DISPLAY}`;
  g.fillText(t.title, -6 * s, 260 * s);
  g.font = `400 ${50 * s}px ${UI}`;
  const lines = wrap(g, t.body, W * 0.9);
  lines.forEach((l, i) => g.fillText(l, 0, 380 * s + i * 72 * s));
  const y0 = 380 * s + lines.length * 72 * s + 80 * s;
  g.fillRect(0, y0 - 40 * s, W, 3 * s);
  const colW = W / t.stats.length;
  t.stats.forEach((st, i) => {
    g.font = `600 ${92 * s}px ${DISPLAY}`;
    g.fillText(st.value, i * colW, y0 + 80 * s);
    g.font = `500 ${36 * s}px ${UI}`;
    g.fillStyle = SOFT;
    wrap(g, st.label, colW - 30 * s).forEach((l, k) => g.fillText(l, i * colW, y0 + 140 * s + k * 44 * s));
    g.fillStyle = INK;
  });
}

export function drawHeading(c: HTMLCanvasElement, title: string, sub: string) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = INK;
  g.font = `600 ${H * 0.52}px ${DISPLAY}`;
  g.textAlign = 'center';
  g.fillText(title, W / 2, H * 0.58);
  if (sub) {
    g.font = `500 ${H * 0.17}px ${UI}`;
    g.fillStyle = SOFT;
    g.letterSpacing = `${H * 0.03}px`;
    g.fillText(sub.toUpperCase(), W / 2, H * 0.92);
    g.letterSpacing = '0px';
  }
  g.textAlign = 'left';
}

