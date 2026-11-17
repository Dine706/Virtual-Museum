// Procedural textures drawn on canvases at start-up (no image downloads, no stock photos):
// leaf clusters for each plant type, fern and palm fronds, grass blades, bark, and ground materials.
import * as THREE from 'three';
import { rng, vnoise } from './noise';

type Ctx = CanvasRenderingContext2D;
const canvas = (w: number, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

function hsl(h: number, s: number, l: number, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

/** Alpha textures: copy the canvas into a DataTexture whose colour extends under transparent pixels, so
 *  mipmaps fade to leaf colour instead of black (canvas pixels are premultiplied). */
function alphaTex(c: HTMLCanvasElement): THREE.Texture {
  const W = c.width, H = c.height;
  const src = ctx2d(c).getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  // flip rows (canvas top = texture v 1, like CanvasTexture.flipY)
  for (let y = 0; y < H; y++) out.set(src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let k = 0; k < W * H; k++) if (out[k * 4 + 3] > 128) { sr += out[k * 4]; sg += out[k * 4 + 1]; sb += out[k * 4 + 2]; n++; }
  const mr = n ? sr / n : 60, mg = n ? sg / n : 80, mb = n ? sb / n : 40;
  // a few dilation passes, then the mean colour everywhere still empty
  let filled = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) filled[k] = out[k * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < 4; pass++) {
    const next = filled.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (filled[k]) continue;
      let r = 0, g = 0, b = 0, m = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const kk = yy * W + xx;
        if (!filled[kk]) continue;
        r += out[kk * 4]; g += out[kk * 4 + 1]; b += out[kk * 4 + 2]; m++;
      }
      if (m) { out[k * 4] = r / m; out[k * 4 + 1] = g / m; out[k * 4 + 2] = b / m; next[k] = 1; }
    }
    filled = next;
  }
  for (let k = 0; k < W * H; k++) if (!filled[k]) { out[k * 4] = mr; out[k * 4 + 1] = mg; out[k * 4 + 2] = mb; }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- leaves

export interface LeafStyle { hue: number; sat: number; light: number; len: number; width: number; count: number; spread: number; shape: 'ellipse' | 'lance' | 'round' | 'leathery' }

/** One leaf: a pointed ellipse with a lighter midrib and a darker edge. */
function leaf(g: Ctx, x: number, y: number, ang: number, len: number, w: number, col: [number, number, number], shape: LeafStyle['shape']) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  const [h, s, l] = col;
  const grad = g.createLinearGradient(0, -w, 0, w);
  grad.addColorStop(0, hsl(h, s, l - 6));
  grad.addColorStop(0.5, hsl(h, s - 4, l + 5));
  grad.addColorStop(1, hsl(h, s, l - 9));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 0);
  const tip = shape === 'round' ? 0.75 : shape === 'lance' ? 1.0 : 0.9;
  g.bezierCurveTo(len * 0.25, -w * 1.1, len * 0.7, -w * (shape === 'round' ? 1.1 : 0.8), len * tip, 0);
  g.bezierCurveTo(len * 0.7, w * (shape === 'round' ? 1.1 : 0.8), len * 0.25, w * 1.1, 0, 0);
  g.fill();
  g.strokeStyle = hsl(h, s - 10, l + 14, 0.55);
  g.lineWidth = Math.max(1, w * 0.12);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * tip * 0.95, 0); g.stroke();
  if (shape === 'leathery' || len > 40) {
    g.strokeStyle = hsl(h, s - 10, l + 8, 0.25);
    g.lineWidth = 1;
    for (let k = 1; k < 6; k++) {
      const px = len * tip * k / 6;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px + len * 0.1, -w * 0.6); g.moveTo(px, 0); g.lineTo(px + len * 0.1, w * 0.6); g.stroke();
    }
  }
  g.restore();
}

/** A square card of leaves on a twig, opaque in the middle, ragged at the edge (alpha-tested). */
export function leafCluster(style: LeafStyle, seed: number, size = 512): THREE.Texture {
  const c = canvas(size);
  const g = ctx2d(c);
  const r = rng(seed);
  const cx = size / 2, cy = size / 2;
  // Twigs.
  g.strokeStyle = hsl(28, 25, 22);
  g.lineCap = 'round';
  const twigs: [number, number][] = [];
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2, len = size * (0.18 + r() * 0.26);
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
    g.lineWidth = 2 + r() * 2;
    g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a + 0.4) * len * 0.5, cy + Math.sin(a + 0.4) * len * 0.5, ex, ey); g.stroke();
    twigs.push([ex, ey]);
  }
  const s = size / 512;
  for (let k = 0; k < style.count; k++) {
    // Leaves cluster along twigs, denser in the middle.
    const [tx, ty] = twigs[k % twigs.length];
    const t = Math.pow(r(), 0.7);
    const x = cx + (tx - cx) * t + (r() - 0.5) * 40 * s * style.spread;
    const y = cy + (ty - cy) * t + (r() - 0.5) * 40 * s * style.spread;
    const ang = Math.atan2(y - cy, x - cx) + (r() - 0.5) * 1.6;
    const len = style.len * s * (0.75 + r() * 0.5);
    const w = style.width * s * (0.8 + r() * 0.4);
    const col: [number, number, number] = [style.hue + (r() - 0.5) * 10, style.sat + (r() - 0.5) * 12, style.light + (r() - 0.5) * 12];
    if (r() < 0.06) col[0] -= 25, col[2] += 8; // an old yellowing leaf
    leaf(g, x, y, ang, len, w, col, style.shape);
  }
  return alphaTex(c);
}

/** A single tropical leaf filling the card (base at v = 0): broad, glossy, with a drip tip, for saplings. */
export function singleLeaf(seed: number): THREE.Texture {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const r = rng(seed);
  const hue = 92 + r() * 14;
  g.translate(W / 2, H);
  const L = H * 0.96, Wd = W * 0.42;
  const grad = g.createLinearGradient(-Wd, 0, Wd, 0);
  grad.addColorStop(0, hsl(hue, 48, 24)); grad.addColorStop(0.5, hsl(hue - 4, 52, 36)); grad.addColorStop(1, hsl(hue + 4, 46, 26));
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(0, -L * 0.06);
  g.bezierCurveTo(-Wd * 1.15, -L * 0.25, -Wd * 0.95, -L * 0.72, -Wd * 0.12, -L * 0.88);
  g.quadraticCurveTo(-Wd * 0.04, -L * 0.94, 0, -L);       // drip tip
  g.quadraticCurveTo(Wd * 0.04, -L * 0.94, Wd * 0.12, -L * 0.88);
  g.bezierCurveTo(Wd * 0.95, -L * 0.72, Wd * 1.15, -L * 0.25, 0, -L * 0.06);
  g.fill();
  // glossy sheen band
  const sh = g.createLinearGradient(-Wd, -L * 0.3, Wd * 0.4, -L * 0.6);
  sh.addColorStop(0, hsl(hue, 30, 60, 0)); sh.addColorStop(0.5, hsl(hue - 10, 30, 62, 0.18)); sh.addColorStop(1, hsl(hue, 30, 60, 0));
  g.fillStyle = sh; g.fill();
  g.strokeStyle = hsl(hue - 20, 30, 52, 0.85); g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.97); g.stroke();
  g.strokeStyle = hsl(hue - 10, 35, 46, 0.4); g.lineWidth = 1;
  for (let q = 1; q < 9; q++) {
    const y = -L * (0.1 + q * 0.085);
    for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(sd * Wd * 0.45, y - L * 0.04, sd * Wd * 0.82, y - L * 0.11); g.stroke(); }
  }
  // petiole
  g.strokeStyle = hsl(60, 30, 30); g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.07); g.stroke();
  return alphaTex(c);
}

/** One broad leaf filling the card (forest-floor herbs): oblong, glossy, with parallel veins. */
export function bigLeaf(seed: number): THREE.Texture {
  const S = 256;
  const c = canvas(S);
  const g = ctx2d(c);
  const r = rng(seed);
  for (let k = 0; k < 3; k++) {
    g.save();
    g.translate(S / 2 + (r() - 0.5) * 40, S - 10);
    g.rotate((k - 1) * 0.55 + (r() - 0.5) * 0.2);
    const L = S * (0.75 + r() * 0.2), Wd = S * 0.2;
    const grad = g.createLinearGradient(-Wd, 0, Wd, 0);
    grad.addColorStop(0, hsl(105, 45, 20)); grad.addColorStop(0.5, hsl(100, 50, 34)); grad.addColorStop(1, hsl(108, 45, 22));
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(-Wd * 1.2, -L * 0.3, -Wd, -L * 0.85, 0, -L);
    g.bezierCurveTo(Wd, -L * 0.85, Wd * 1.2, -L * 0.3, 0, 0); g.fill();
    g.strokeStyle = hsl(80, 35, 50, 0.7); g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.97); g.stroke();
    g.strokeStyle = hsl(95, 40, 42, 0.35); g.lineWidth = 1;
    for (let q = 1; q < 14; q++) {
      const y = -L * q / 14;
      g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(-Wd * 0.5, y - L * 0.05, -Wd * 0.9, y - L * 0.09); g.stroke();
      g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(Wd * 0.5, y - L * 0.05, Wd * 0.9, y - L * 0.09); g.stroke();
    }
    g.restore();
  }
  return alphaTex(c);
}

export const LEAVES = {
  lowland: { hue: 100, sat: 46, light: 31, len: 70, width: 20, count: 150, spread: 1.0, shape: 'ellipse' } as LeafStyle,
  bigleaf: { hue: 96, sat: 50, light: 33, len: 150, width: 52, count: 40, spread: 1.4, shape: 'ellipse' } as LeafStyle,
  montane: { hue: 95, sat: 34, light: 28, len: 46, width: 15, count: 260, spread: 0.8, shape: 'leathery' } as LeafStyle,
  protea: { hue: 85, sat: 18, light: 40, len: 72, width: 16, count: 110, spread: 0.7, shape: 'lance' } as LeafStyle,
  regrowth: { hue: 88, sat: 48, light: 36, len: 80, width: 28, count: 90, spread: 1.2, shape: 'round' } as LeafStyle,
  savanna: { hue: 78, sat: 30, light: 32, len: 34, width: 12, count: 220, spread: 0.9, shape: 'ellipse' } as LeafStyle,
};

// ---------------------------------------------------------------- fronds (ferns, palms) and grass

/** A pinnate frond along the texture's v axis (base at v = 0): ferns, oil palm, raphia. */
export function frond(kind: 'fern' | 'oilpalm' | 'raphia', seed: number): THREE.Texture {
  const W = 256, H = 1024;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const r = rng(seed);
  const cx = W / 2;
  const hue = kind === 'fern' ? 100 : kind === 'oilpalm' ? 88 : 84;
  const n = kind === 'fern' ? 44 : kind === 'oilpalm' ? 70 : 84;
  for (let k = 0; k < n; k++) {
    const t = k / n; // 0 = base (bottom), 1 = tip
    const y = H - 24 - t * (H - 40);
    const env = kind === 'fern' ? Math.sin(Math.PI * Math.min(1, t * 1.0 + 0.1)) : Math.sin(Math.PI * (0.12 + t * 0.88)) * (1 - t * 0.3);
    const len = (W / 2 - 4) * Math.max(0.15, env);
    for (const side of [-1, 1]) {
      const l = (kind === 'fern' ? 42 : 36) + (r() - 0.5) * 10 + t * 6;
      g.fillStyle = hsl(hue + (r() - 0.5) * 10, 46 + (r() - 0.5) * 12, l);
      g.save();
      g.translate(cx, y);
      const droop = kind === 'fern' ? 0.32 : 0.55 + r() * 0.25;
      g.rotate(side * (Math.PI / 2 - droop));
      if (kind === 'fern') {
        // pinna: a tapering blade with lobed (pinnule) edges
        const w = 11;
        g.beginPath();
        g.moveTo(0, -w * 0.6);
        for (let q = 0; q <= 10; q++) { const px = len * q / 10, pw = w * (1 - q / 11); g.lineTo(px, -pw * (q % 2 ? 1.25 : 0.8)); }
        for (let q = 10; q >= 0; q--) { const px = len * q / 10, pw = w * (1 - q / 11); g.lineTo(px, pw * (q % 2 ? 1.25 : 0.8)); }
        g.closePath();
        g.fill();
        g.strokeStyle = hsl(hue - 10, 30, l + 12, 0.5); g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      } else {
        const w = kind === 'oilpalm' ? 9 : 11;
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(len * 0.45, -w, len, 1);
        g.quadraticCurveTo(len * 0.45, w * 0.8, 0, 0);
        g.fill();
        g.strokeStyle = hsl(hue - 6, 30, l + 12, 0.55); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.97, 1); g.stroke();
      }
      g.restore();
    }
  }
  g.strokeStyle = hsl(hue - 40, 30, kind === 'fern' ? 24 : 34);
  g.lineWidth = kind === 'fern' ? 5 : 8;
  g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, 12); g.stroke();
  return alphaTex(c);
}

/** Grass blades for the clumps (base at v = 0): green, golden or dry. */
export function grassBlades(kind: 'green' | 'golden' | 'tall', seed: number): THREE.Texture {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const r = rng(seed);
  const n = kind === 'tall' ? 26 : 40;
  for (let k = 0; k < n; k++) {
    const x0 = 20 + r() * (W - 40);
    const lean = (r() - 0.5) * 70;
    const h = H * (0.55 + r() * 0.45);
    const w = kind === 'tall' ? 7 + r() * 5 : 3 + r() * 3;
    const hue = kind === 'golden' ? 48 + r() * 18 : kind === 'tall' ? 70 + r() * 25 : 80 + r() * 25;
    const sat = kind === 'golden' ? 42 + r() * 15 : 40 + r() * 15;
    const l = kind === 'golden' ? 38 + r() * 18 : 26 + r() * 16;
    const grad = g.createLinearGradient(0, H, 0, H - h);
    grad.addColorStop(0, hsl(hue - 10, sat - 8, l - 6));
    grad.addColorStop(0.6, hsl(hue, sat, l));
    grad.addColorStop(1, hsl(hue + (kind === 'golden' ? -6 : -20), sat - 8, l + (kind === 'golden' ? 12 : 8)));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, H);
    g.quadraticCurveTo(x0 + lean * 0.3 - w * 0.5, H - h * 0.5, x0 + lean, H - h);
    g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, H - h * 0.5, x0 + w, H);
    g.fill();
    if (kind === 'tall' && r() < 0.3) {
      // seed head
      g.fillStyle = hsl(40, 35, 55, 0.9);
      for (let q = 0; q < 12; q++) g.fillRect(x0 + lean + (r() - 0.5) * 10, H - h + q * 4, 3, 5);
    }
  }
  return alphaTex(c);
}

/** Hanging moss / lichen strands for cloud-forest branches. */
export function mossStrands(seed: number): THREE.Texture {
  const W = 128, H = 512;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const r = rng(seed);
  for (let k = 0; k < 60; k++) {
    const x = 10 + r() * (W - 20), len = H * (0.3 + r() * 0.7);
    g.strokeStyle = hsl(80 + r() * 20, 25 + r() * 15, 45 + r() * 15, 0.85);
    g.lineWidth = 1 + r() * 2;
    g.beginPath(); g.moveTo(x, 0);
    let px = x;
    for (let y = 0; y < len; y += 16) { px += (r() - 0.5) * 6; g.lineTo(px, y); }
    g.stroke();
  }
  return alphaTex(c);
}

// ---------------------------------------------------------------- bark

export function bark(kind: 'brown' | 'grey' | 'mossy' | 'palm' | 'fern' | 'lichen', seed: number): { map: THREE.Texture; normal: THREE.Texture } {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const r = rng(seed);
  const base = kind === 'lichen' ? [70, 7, 48] : kind === 'grey' ? [35, 8, 46] : kind === 'mossy' ? [70, 20, 30] : kind === 'palm' ? [34, 18, 40] : kind === 'fern' ? [25, 30, 18] : [28, 22, 32];
  g.fillStyle = hsl(base[0], base[1], base[2]);
  g.fillRect(0, 0, W, H);
  const hgt = new Float32Array(W * H);
  if (kind === 'palm' || kind === 'fern') {
    // persistent leaf bases / frond scars: overlapping upward-pointing wedges in a spiral
    const rowH = kind === 'palm' ? 40 : 22, colW = kind === 'palm' ? 52 : 28;
    for (let y = H + rowH; y > -rowH; y -= rowH) {
      const shift = ((Math.round(y / rowH) % 2) + 2) % 2 * colW / 2;
      for (let x = -colW; x < W + colW; x += colW) {
        const ox = x + shift + (r() - 0.5) * 6, l = base[2] + (r() - 0.5) * 10;
        const grad = g.createLinearGradient(0, y, 0, y - rowH * 1.4);
        grad.addColorStop(0, hsl(base[0], base[1], l - 10));
        grad.addColorStop(1, hsl(base[0] + 4, base[1] + 4, l + 10));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(ox - colW * 0.55, y);
        g.quadraticCurveTo(ox - colW * 0.3, y - rowH * 1.2, ox, y - rowH * 1.45);
        g.quadraticCurveTo(ox + colW * 0.3, y - rowH * 1.2, ox + colW * 0.55, y);
        g.closePath();
        g.fill();
        g.strokeStyle = hsl(base[0], base[1], l - 16, 0.6); g.lineWidth = 1.5; g.stroke();
      }
    }
  } else if (kind === 'lichen') {
    // smooth young bark, mottled with pale crustose lichen and dark patches (like the poles in forest footage)
    for (let k = 0; k < 22; k++) {
      g.strokeStyle = hsl(60, 6, 40 + r() * 10, 0.35); g.lineWidth = 1 + r() * 2;
      const x = r() * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 10, H); g.stroke();
    }
    for (let k = 0; k < 320; k++) {
      const pale = r() < 0.65;
      g.fillStyle = pale ? hsl(70 + r() * 30, 8 + r() * 12, 70 + r() * 14, 0.55 + r() * 0.3) : hsl(40, 10, 24 + r() * 10, 0.35);
      g.beginPath();
      const x = r() * W, y = r() * H, rx = 3 + r() * (pale ? 22 : 10), ry = rx * (0.5 + r() * 0.8);
      g.ellipse(x, y, rx, ry, r() * 3, 0, Math.PI * 2); g.fill();
    }
    for (let k = 0; k < 60; k++) { // lenticels
      g.fillStyle = hsl(40, 15, 30, 0.6); g.fillRect(r() * W, r() * H, 6 + r() * 8, 1.5);
    }
  } else {
    // vertical ridges and cracks
    for (let k = 0; k < 90; k++) {
      const x = r() * W;
      g.strokeStyle = hsl(base[0], base[1], base[2] + (r() < 0.5 ? -14 : 9), 0.55);
      g.lineWidth = 1 + r() * 4;
      g.beginPath();
      let px = x;
      g.moveTo(px, 0);
      for (let y = 0; y <= H; y += 24) { px += (r() - 0.5) * 8; g.lineTo(px, y); }
      g.stroke();
    }
    if (kind === 'mossy' || kind === 'brown') {
      const n = kind === 'mossy' ? 260 : 40;
      for (let k = 0; k < n; k++) {
        g.fillStyle = kind === 'mossy' ? hsl(85 + r() * 25, 35 + r() * 20, 26 + r() * 16, 0.7) : hsl(90, 15, 55, 0.35);
        g.beginPath(); g.ellipse(r() * W, r() * H, 4 + r() * 18, 3 + r() * 10, r() * 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
  const img = g.getImageData(0, 0, W, H).data;
  for (let k = 0; k < W * H; k++) hgt[k] = (img[k * 4] + img[k * 4 + 1] + img[k * 4 + 2]) / 765;
  const map = tex(c, true, true);
  return { map, normal: normalFrom(hgt, W, H, 3) };
}

/** Tangent-space normal map from a height field (Sobel), as a repeat-wrapped linear texture. */
export function normalFrom(h: Float32Array, W: number, H: number, strength: number): THREE.Texture {
  const c = canvas(W, H);
  const g = ctx2d(c);
  const id = g.createImageData(W, H);
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * W + x) * 4;
    id.data[k] = (nx * 0.5 + 0.5) * 255; id.data[k + 1] = (ny * 0.5 + 0.5) * 255; id.data[k + 2] = (nz * 0.5 + 0.5) * 255; id.data[k + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return tex(c, false, true);
}

// ---------------------------------------------------------------- ground materials

export interface GroundSet { maps: THREE.Texture[]; normals: THREE.Texture[] }

/** Five tiling ground textures: 0 leaf litter, 1 laterite soil, 2 grass turf, 3 rock, 4 moss. */
const groundCache = new Map<number, GroundSet>();
export function groundTextures(size = 512): GroundSet {
  const have = groundCache.get(size);
  if (have) return have;
  const set = drawGround(size);
  groundCache.set(size, set);
  return set;
}

function drawGround(size: number): GroundSet {
  const maps: THREE.Texture[] = [], normals: THREE.Texture[] = [];
  const S = size;
  const make = (draw: (g: Ctx, r: () => number, hgt: Float32Array) => void, seed: number, strength: number) => {
    const c = canvas(S);
    const g = ctx2d(c);
    const r = rng(seed);
    const hgt = new Float32Array(S * S);
    draw(g, r, hgt);
    const img = g.getImageData(0, 0, S, S).data;
    for (let k = 0; k < S * S; k++) hgt[k] = hgt[k] * 0.6 + (img[k * 4] + img[k * 4 + 1] + img[k * 4 + 2]) / 765 * 0.4;
    maps.push(tex(c, true, true));
    normals.push(normalFrom(hgt, S, S, strength));
  };
  const noiseFill = (g: Ctx, h: number, s: number, l: number, amp: number, scale: number, seed: number, hgt?: Float32Array) => {
    const id = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // tileable noise: sample on a torus via periodic lattice
      const n = tnoise(x / S, y / S, scale, seed) * 0.6 + tnoise(x / S, y / S, scale * 4, seed + 1) * 0.3 + tnoise(x / S, y / S, scale * 16, seed + 2) * 0.1;
      const k = (y * S + x) * 4;
      const [R, G, B] = hslToRgb(h, s, l + n * amp);
      id.data[k] = R; id.data[k + 1] = G; id.data[k + 2] = B; id.data[k + 3] = 255;
      if (hgt) hgt[y * S + x] = n * 0.5 + 0.5;
    }
    g.putImageData(id, 0, 0);
  };
  // 0 leaf litter: brown soil under hundreds of fallen leaves, some still green, twigs.
  make((g, r, hgt) => {
    noiseFill(g, 28, 24, 20, 7, 4, 11, hgt);
    for (let k = 0; k < 900; k++) {
      const x = r() * S, y = r() * S, len = 10 + r() * 26, w = 4 + r() * 9;
      const fresh = r() < 0.12;
      const col: [number, number, number] = fresh ? [75 + r() * 25, 28, 26 + r() * 10] : [24 + r() * 16, 22 + r() * 22, 22 + r() * 22];
      for (const ox of [0, S, -S]) for (const oy of [0, S, -S]) {
        if (x + ox < -40 || x + ox > S + 40 || y + oy < -40 || y + oy > S + 40) continue;
        leaf(g, x + ox, y + oy, r() * Math.PI * 2, len, w, col, r() < 0.5 ? 'ellipse' : 'round');
      }
    }
    g.strokeStyle = hsl(25, 25, 18); g.lineCap = 'round';
    for (let k = 0; k < 30; k++) { g.lineWidth = 1 + r() * 2.5; const x = r() * S, y = r() * S, a = r() * 6.3, l = 20 + r() * 60; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  }, 101, 4);
  // 1 laterite: red-brown iron-rich soil with pebbles.
  make((g, r, hgt) => {
    noiseFill(g, 16, 38, 30, 9, 3, 21, hgt);
    // fine gravel and small ironstone nodules, low contrast (not 'coins')
    for (let k = 0; k < 2600; k++) {
      g.fillStyle = hsl(12 + r() * 16, 30 + r() * 20, 20 + r() * 22, 0.35 + r() * 0.35);
      const x = r() * S, y = r() * S, s = 0.6 + r() * r() * 3.2;
      g.beginPath();
      g.moveTo(x + s, y);
      for (let q = 1; q < 6; q++) { const a = q / 6 * Math.PI * 2; const rr = s * (0.6 + r() * 0.6); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
      g.closePath(); g.fill();
    }
  }, 102, 3);
  // 2 turf: grass base with fine strokes.
  make((g, r, hgt) => {
    noiseFill(g, 70, 30, 26, 8, 3, 31, hgt);
    for (let k = 0; k < 5000; k++) {
      g.strokeStyle = hsl(55 + r() * 40, 30 + r() * 25, 22 + r() * 25, 0.8);
      g.lineWidth = 1 + r();
      const x = r() * S, y = r() * S, a = -Math.PI / 2 + (r() - 0.5) * 1.6, l = 5 + r() * 10;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }, 103, 2);
  // 3 rock: grey-brown ironstone / granite with cracks and lichen.
  make((g, r, hgt) => {
    noiseFill(g, 30, 10, 42, 16, 2, 41, hgt);
    g.strokeStyle = hsl(30, 10, 22, 0.8);
    for (let k = 0; k < 40; k++) {
      g.lineWidth = 1 + r() * 2;
      let x = r() * S, y = r() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let q = 0; q < 8; q++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); }
      g.stroke();
    }
    for (let k = 0; k < 160; k++) { g.fillStyle = hsl(60 + r() * 40, 20 + r() * 20, 55 + r() * 20, 0.35); g.beginPath(); g.arc(r() * S, r() * S, 2 + r() * 9, 0, 7); g.fill(); }
  }, 104, 6);
  // 4 moss
  make((g, r, hgt) => {
    noiseFill(g, 88, 42, 24, 12, 5, 51, hgt);
    for (let k = 0; k < 2500; k++) { g.fillStyle = hsl(80 + r() * 30, 40 + r() * 20, 22 + r() * 22, 0.8); g.fillRect(r() * S, r() * S, 2, 2); }
  }, 105, 3);
  return { maps, normals };
}

function tnoise(u: number, v: number, period: number, seed: number) {
  // Tileable value noise: wrap lattice coordinates.
  const x = u * period, y = v * period;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const P = Math.round(period);
  const h = (a: number, b: number) => (vnoise(((a % P) + P) % P + 0.5, ((b % P) + P) % P + 0.5, seed) * 0.5 + 0.5);
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const ux = s(fx), uy = s(fy);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Butterfly / bird wing patterns (small canvases). */
export function wingTexture(kind: 'acraea' | 'swallowtail' | 'graphium'): THREE.Texture {
  const c = canvas(128, 128);
  const g = ctx2d(c);
  const r = rng(kind.length * 977);
  g.clearRect(0, 0, 128, 128);
  const shape = (fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(0, 64);
    g.bezierCurveTo(30, 0, 110, 0, 124, 30);
    g.bezierCurveTo(118, 60, 90, 62, 70, 64);
    g.bezierCurveTo(100, 80, 110, 112, 80, 124);
    g.bezierCurveTo(40, 128, 20, 90, 0, 64);
    g.fill();
  };
  if (kind === 'acraea') {
    shape(hsl(18, 85, 50));
    g.fillStyle = hsl(20, 30, 12);
    for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(30 + r() * 70, 30 + r() * 70, 3 + r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = hsl(20, 30, 12); g.lineWidth = 6; g.beginPath(); g.moveTo(80, 10); g.bezierCurveTo(110, 4, 126, 20, 124, 30); g.stroke();
  } else if (kind === 'swallowtail') {
    shape(hsl(25, 25, 10));
    g.fillStyle = hsl(150, 70, 45);
    g.beginPath(); g.moveTo(10, 64); g.bezierCurveTo(40, 40, 70, 40, 90, 36); g.lineTo(96, 50); g.bezierCurveTo(70, 56, 40, 64, 14, 70); g.fill();
    g.beginPath(); g.ellipse(70, 92, 18, 8, 0.6, 0, 7); g.fill();
  } else {
    shape(hsl(160, 30, 85));
    g.fillStyle = hsl(30, 20, 15);
    for (let k = 0; k < 6; k++) { g.fillRect(20 + k * 16, 10, 5, 110); }
  }
  return alphaTex(c);
}

// ---------------------------------------------------------------- terrain layers (texture arrays)

/** Ground layers of the terrain shader, in array order. */
export const LAYERS = ['litter', 'laterite', 'turf', 'rock', 'moss', 'mud', 'road', 'mine', 'highgrass', 'sand', 'field'] as const;
export type Layer = typeof LAYERS[number];
/** Tiling size (m) of each layer on the ground. */
export const LAYER_SCALE = [2.6, 3.2, 2.0, 4.5, 2.2, 2.6, 3.0, 3.6, 2.6, 2.8, 3.0];

/** Pack images (canvases / bitmaps) into one repeat-wrapped, mipmapped 2D texture array. */
export function packArray(images: CanvasImageSource[], size: number, srgb: boolean, anisotropy = 4): THREE.DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * images.length);
  const c = canvas(size);
  const g = ctx2d(c);
  images.forEach((img, i) => {
    g.clearRect(0, 0, size, size);
    g.drawImage(img, 0, 0, size, size);
    const px = g.getImageData(0, 0, size, size).data;
    // flip rows like CanvasTexture.flipY so drawn and scanned layers share one orientation
    for (let y = 0; y < size; y++) data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), (i * size + y) * size * 4);
  });
  const t = new THREE.DataArrayTexture(data, size, size, images.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Drawn versions of the 11 layers (phones and the default look): the 5 drawn ground textures plus 6 derived ones. */
export function drawnLayers(size: number): { diff: THREE.DataArrayTexture; nor: THREE.DataArrayTexture } {
  const set = groundTextures(size);
  const d = set.maps.map((t) => t.image as HTMLCanvasElement);
  const n = set.normals.map((t) => t.image as HTMLCanvasElement);
  const derive = (base: HTMLCanvasElement, paint: (g: Ctx, r: () => number) => void, seed: number) => {
    const c = canvas(size);
    const g = ctx2d(c);
    g.drawImage(base, 0, 0, size, size);
    paint(g, rng(seed));
    return c;
  };
  const S = size;
  const mud = derive(d[1], (g, r) => {
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'hsl(30,25%,45%)'; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 40; k++) { g.fillStyle = hsla(30, 20, 18, 0.25); g.beginPath(); g.ellipse(r() * S, r() * S, 10 + r() * 40, 6 + r() * 20, r() * 3, 0, 7); g.fill(); }
  }, 201);
  const road = derive(d[1], (g, r) => {
    g.globalCompositeOperation = 'screen'; g.fillStyle = 'hsl(18,25%,14%)'; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    for (const x of [S * 0.3, S * 0.7]) { g.strokeStyle = hsla(15, 30, 22, 0.35); g.lineWidth = S * 0.06; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= S; y += S / 8) g.lineTo(x + (r() - 0.5) * 6, y); g.stroke(); }
  }, 202);
  const mine = derive(d[3], (g, r) => {
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'hsl(12,55%,62%)'; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 900; k++) { g.fillStyle = hsla(10 + r() * 20, 30 + r() * 30, 18 + r() * 30, 0.6); g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 3); }
  }, 203);
  const high = derive(d[2], (g) => { g.globalCompositeOperation = 'multiply'; g.fillStyle = 'hsl(44,55%,72%)'; g.fillRect(0, 0, S, S); }, 204);
  const sand = derive(d[1], (g, r) => {
    g.globalCompositeOperation = 'source-over'; g.fillStyle = hsla(40, 22, 58, 0.75); g.fillRect(0, 0, S, S);
    for (let k = 0; k < 600; k++) { g.fillStyle = hsla(30 + r() * 20, 10, 30 + r() * 40, 0.7); g.beginPath(); g.ellipse(r() * S, r() * S, 1 + r() * 5, 1 + r() * 4, r() * 3, 0, 7); g.fill(); }
  }, 205);
  const field = derive(d[1], (g, r) => {
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'hsl(25,30%,62%)'; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    for (let y = 0; y < S; y += S / 10) { g.fillStyle = hsla(22, 25, 20, 0.25); g.fillRect(0, y + (r() - 0.5) * 3, S, S / 30); }
  }, 206);
  const diff = packArray([d[0], d[1], d[2], d[3], d[4], mud, road, mine, high, sand, field], size, true);
  const nor = packArray([n[0], n[1], n[2], n[3], n[4], n[1], n[1], n[3], n[2], n[1], n[1]], size, false);
  return { diff, nor };
}

function hsla(h: number, s: number, l: number, a: number) { return `hsla(${h},${s}%,${l}%,${a})`; }
