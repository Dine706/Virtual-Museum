// Light baking at load time. The gallery is static, so every flat surface (floor, walls, ceiling, plinth,
// bench) gets a lightmap rendered once on the GPU: soft daylight from the ceiling slot and from the window
// (coloured by the real summit panorama seen through it), gallery spotlights with soft shadows, and ambient
// occlusion from the room's corners and objects. At run time the scene has no dynamic lights at all, which
// is what keeps it fast on phones while looking like a lit room.
import * as THREE from 'three';
import { HX, HZ, ROOM, SKYLIGHT, WINDOW, OCCLUDERS, type Box, type Spot } from './layout';

/** A rectangle of the scene that owns a lightmap: p = origin + u·s·w + v·t·h, (s, t) ∈ [0, 1]², normal = u × v. */
export interface Plane {
  name: string;
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  w: number;
  h: number;
  /** filled by the atlas packer: uv1 rect (x, y, w, h) in [0, 1] */
  rect?: THREE.Vector4;
  /** texels per metre (filled by the packer) */
  density?: number;
}

export const plane = (name: string, origin: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, w: number, h: number): Plane =>
  ({ name, origin, u: u.clone().normalize(), v: v.clone().normalize(), w, h });

export const normalOf = (p: Plane) => new THREE.Vector3().crossVectors(p.u, p.v).normalize();

/** The 5 visible faces (no bottom) of an axis-aligned box, normals pointing out. */
export function boxPlanes(name: string, b: Box): Plane[] {
  const { min: a, max: c } = b;
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const w = c.x - a.x, h = c.y - a.y, d = c.z - a.z;
  return [
    plane(`${name}+x`, new THREE.Vector3(c.x, a.y, c.z), Z.clone().negate(), Y, d, h),
    plane(`${name}-x`, new THREE.Vector3(a.x, a.y, a.z), Z, Y, d, h),
    plane(`${name}+z`, new THREE.Vector3(a.x, a.y, c.z), X, Y, w, h),
    plane(`${name}-z`, new THREE.Vector3(c.x, a.y, a.z), X.clone().negate(), Y, w, h),
    plane(`${name}+y`, new THREE.Vector3(a.x, c.y, c.z), X, Z.clone().negate(), w, d),
  ];
}

/** uv1 (atlas coordinates) of a world point projected onto a plane. */
export function atlasUv(p: Plane, world: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
  const d = world.clone().sub(p.origin);
  const s = THREE.MathUtils.clamp(d.dot(p.u) / p.w, 0, 1);
  const t = THREE.MathUtils.clamp(d.dot(p.v) / p.h, 0, 1);
  const r = p.rect!;
  return out.set(r.x + s * r.z, r.y + t * r.w);
}

/** Give a geometry (in world space, or with `matrix` to world) a uv1 attribute that samples `p`'s lightmap. */
export function setAtlasUv1(geo: THREE.BufferGeometry, p: Plane, matrix?: THREE.Matrix4) {
  const pos = geo.getAttribute('position');
  const uv1 = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3(), o = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (matrix) v.applyMatrix4(matrix);
    atlasUv(p, v, o);
    uv1[i * 2] = o.x; uv1[i * 2 + 1] = o.y;
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

// ---------------------------------------------------------------- atlas packing
const PAD = 3; // texels of padding around every rect (bilinear filtering never reads a neighbour)

/** Shelf-pack all planes into a square atlas; returns its size in texels. */
export function packAtlas(planes: Plane[], density: number, maxSize: number): number {
  let size = 512;
  for (;;) {
    const ok = tryPack(planes, density, size);
    if (ok || size >= maxSize) { if (!ok) { density *= 0.75; continue; } return size; }
    size *= 2;
  }
}

function tryPack(planes: Plane[], density: number, size: number): boolean {
  const items = planes.map((p) => ({ p, w: Math.max(4, Math.ceil(p.w * density)) + PAD * 2, h: Math.max(4, Math.ceil(p.h * density)) + PAD * 2 }));
  items.sort((a, b) => b.h - a.h);
  let x = 0, y = 0, shelf = 0;
  for (const it of items) {
    if (x + it.w > size) { x = 0; y += shelf; shelf = 0; }
    if (it.w > size || y + it.h > size) return false;
    // rect = the inner area (padding excluded), in normalised atlas coordinates.
    it.p.rect = new THREE.Vector4((x + PAD) / size, (y + PAD) / size, (it.w - PAD * 2) / size, (it.h - PAD * 2) / size);
    it.p.density = density;
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return true;
}

// ---------------------------------------------------------------- bake shader
const MAX_BOX = 4;
const MAX_SPOT = 16;

const vert = /* glsl */`
uniform vec4 uPadRect; // (s0, t0, s1, t1): plane coordinates covered by the quad (padding included)
varying vec2 vST;
void main() {
  vST = mix(uPadRect.xy, uPadRect.zw, uv);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */`
precision highp float;
varying vec2 vST;
uniform vec3 uOrigin, uU, uV, uN;
uniform vec2 uSize;
uniform vec3 uBoxMin[${MAX_BOX}], uBoxMax[${MAX_BOX}];
uniform int uBoxes;
uniform vec3 uSpotPos[${MAX_SPOT}], uSpotDir[${MAX_SPOT}];
uniform vec3 uSpotCone[${MAX_SPOT}]; // cosOuter, cosInner, intensity
uniform int uSpots;
uniform vec3 uSpotColor;
uniform vec3 uRoomMin, uRoomMax;
uniform vec4 uSky;     // x0, x1, z0, z1 on the ceiling
uniform vec3 uSkyL;    // ceiling slot radiance
uniform vec4 uWin;     // x0, x1, y0, y1 on the north wall
uniform float uWinGain;
uniform sampler2D uPano;
uniform vec3 uAmbient;
uniform int uAreaN, uAoN, uSpotN;
uniform float uOutScale;

const float PI = 3.14159265;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// First hit of a ray against the occluder boxes (from outside), or 1e9.
float hitBoxes(vec3 ro, vec3 rd) {
  float best = 1e9;
  vec3 inv = 1.0 / rd;
  for (int i = 0; i < ${MAX_BOX}; i++) {
    if (i >= uBoxes) break;
    vec3 t0 = (uBoxMin[i] - ro) * inv, t1 = (uBoxMax[i] - ro) * inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    if (b >= max(a, 0.0) && a > 1e-3) best = min(best, a);
  }
  return best;
}
// Distance to the room's walls from inside.
float hitRoom(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uRoomMin - ro) * inv, t1 = (uRoomMax - ro) * inv;
  vec3 tf = max(t0, t1);
  return min(min(tf.x, tf.y), tf.z);
}

vec3 panoL(vec3 d) {
  float u = 0.5 + atan(d.x, -d.z) / (2.0 * PI);
  float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI;
  return textureLod(uPano, vec2(u, v), 3.0).rgb; // sRGB texture: decoded to linear by the GPU
}

void main() {
  vec3 p = uOrigin + uU * (vST.x * uSize.x) + uV * (vST.y * uSize.y);
  p = clamp(p, uRoomMin + 0.002, uRoomMax - 0.002) + uN * 0.004;
  vec3 N = uN;
  // Same sample pattern for every texel: no per-texel noise (smooth walls); the stratification hides banding.
  float jit = 0.5;
  vec3 E = vec3(0.0);

  // Ceiling light slot (area light pointing down), stratified samples.
  {
    int n = uAreaN;
    float side = floor(sqrt(float(n)));
    float area = (uSky.y - uSky.x) * (uSky.w - uSky.z);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 256; i++) {
      if (i >= n) break;
      float fi = float(i);
      vec2 g = vec2(mod(fi, side), floor(fi / side));
      vec2 r = (g + fract(vec2(jit + fi * 0.618, jit * 1.7 + fi * 0.382))) / side;
      vec3 s = vec3(mix(uSky.x, uSky.y, r.x), uRoomMax.y, mix(uSky.z, uSky.w, r.y));
      vec3 d = s - p; float r2 = dot(d, d); float dist = sqrt(r2); vec3 l = d / dist;
      float cp = dot(N, l), cl = l.y; // light normal is −y: cos = dot(−y, −l) = l.y
      if (cp <= 0.0 || cl <= 0.0) continue;
      if (hitBoxes(p, l) < dist - 0.01) continue;
      acc += vec3(cp * cl / r2);
    }
    E += uSkyL * acc * area / float(n);
  }
  // Window (area light coloured by the panorama outside).
  {
    int n = uAreaN;
    float side = floor(sqrt(float(n)));
    float area = (uWin.y - uWin.x) * (uWin.w - uWin.z);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 256; i++) {
      if (i >= n) break;
      float fi = float(i);
      vec2 g = vec2(mod(fi, side), floor(fi / side));
      vec2 r = (g + fract(vec2(jit * 1.3 + fi * 0.618, jit * 0.7 + fi * 0.382))) / side;
      vec3 s = vec3(mix(uWin.x, uWin.y, r.x), mix(uWin.z, uWin.w, r.y), uRoomMin.z);
      vec3 d = s - p; float r2 = dot(d, d); float dist = sqrt(r2); vec3 l = d / dist;
      float cp = dot(N, l), cl = -l.z; // window normal is +z (into the room)
      if (cp <= 0.0 || cl <= 0.0) continue;
      if (hitBoxes(p, l) < dist - 0.01) continue;
      acc += panoL(l) * (cp * cl / r2);
    }
    E += acc * uWinGain * area / float(n);
  }
  // Spotlights (small disc sources → soft shadows).
  for (int i = 0; i < ${MAX_SPOT}; i++) {
    if (i >= uSpots) break;
    vec3 d0 = uSpotPos[i] - p; float dist = length(d0); vec3 l = d0 / dist;
    float cp = dot(N, l);
    if (cp <= 0.0) continue;
    float cone = smoothstep(uSpotCone[i].x, uSpotCone[i].y, dot(-l, uSpotDir[i]));
    if (cone <= 0.0) continue;
    float vis = 0.0;
    for (int k = 0; k < 16; k++) {
      if (k >= uSpotN) break;
      float a = (float(k) + jit) * 2.39996;
      float rr = 0.06 * sqrt((float(k) + 0.5) / float(uSpotN));
      vec3 t1 = normalize(cross(uSpotDir[i], vec3(0.0, 0.0, 1.0)));
      vec3 t2 = cross(uSpotDir[i], t1);
      vec3 s = uSpotPos[i] + (t1 * cos(a) + t2 * sin(a)) * rr;
      vec3 d = s - p; float ds = length(d);
      vis += hitBoxes(p, d / ds) < ds - 0.01 ? 0.0 : 1.0;
    }
    vis /= float(uSpotN);
    E += uSpotColor * (uSpotCone[i].z * cone * cp / (dist * dist)) * vis;
  }
  // Ambient bounce × ambient occlusion (cosine-weighted hemisphere).
  {
    vec3 t1 = abs(N.y) < 0.9 ? normalize(cross(N, vec3(0.0, 1.0, 0.0))) : vec3(1.0, 0.0, 0.0);
    vec3 t2 = cross(N, t1);
    float occ = 0.0;
    for (int i = 0; i < 128; i++) {
      if (i >= uAoN) break;
      float fi = float(i) + jit;
      float r = sqrt(fract(fi * 0.618034));
      float a = fi * 2.39996;
      vec3 d = normalize(t1 * (r * cos(a)) + t2 * (r * sin(a)) + N * sqrt(max(0.0, 1.0 - r * r)));
      float t = min(hitBoxes(p, d), hitRoom(p, d));
      occ += smoothstep(0.0, 1.4, t);
    }
    occ /= float(uAoN);
    E += uAmbient * mix(0.25, 1.0, occ);
    // corners and floor joints get a little extra contact shadow
    E *= mix(0.78, 1.0, smoothstep(0.35, 1.0, occ));
  }
  gl_FragColor = vec4(E * uOutScale, 1.0);
}`;

export interface BakeLights {
  spots: Spot[];
  spotColor: THREE.Color;
  skyL: THREE.Color;
  winGain: number;
  ambient: THREE.Color;
}

export interface BakeQuality { density: number; maxAtlas: number; areaN: number; aoN: number; spotN: number }

export const BAKE_QUALITY: Record<'high' | 'mid' | 'low', BakeQuality> = {
  high: { density: 28, maxAtlas: 2048, areaN: 100, aoN: 64, spotN: 12 },
  mid: { density: 20, maxAtlas: 1024, areaN: 64, aoN: 40, spotN: 8 },
  low: { density: 12, maxAtlas: 1024, areaN: 36, aoN: 24, spotN: 4 },
};

/**
 * Render every plane's lightmap into one atlas render target. One draw per plane, one plane per animation
 * frame (a single huge draw can trip the GPU watchdog on phones). Returns the atlas texture.
 */
export async function bakeLightmaps(renderer: THREE.WebGLRenderer, planes: Plane[], lights: BakeLights, pano: THREE.Texture,
  q: BakeQuality, onProgress?: (f: number) => void): Promise<{ texture: THREE.Texture; intensity: number; size: number }> {
  const size = packAtlas(planes, q.density, q.maxAtlas);
  const halfOk = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
  });
  rt.texture.channel = 1;
  const bMin = OCCLUDERS.map((b) => b.min), bMax = OCCLUDERS.map((b) => b.max);
  while (bMin.length < MAX_BOX) { bMin.push(new THREE.Vector3()); bMax.push(new THREE.Vector3()); }
  const S = lights.spots;
  const pad = <T>(arr: T[], make: () => T) => { while (arr.length < MAX_SPOT) arr.push(make()); return arr; };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uPadRect: { value: new THREE.Vector4() },
      uOrigin: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() },
      uSize: { value: new THREE.Vector2() },
      uBoxMin: { value: bMin }, uBoxMax: { value: bMax }, uBoxes: { value: OCCLUDERS.length },
      uSpotPos: { value: pad(S.map((s) => s.pos), () => new THREE.Vector3()) },
      uSpotDir: { value: pad(S.map((s) => s.target.clone().sub(s.pos).normalize()), () => new THREE.Vector3(0, -1, 0)) },
      uSpotCone: { value: pad(S.map((s) => new THREE.Vector3(s.cosOuter, s.cosInner, s.intensity)), () => new THREE.Vector3()) },
      uSpots: { value: Math.min(S.length, MAX_SPOT) },
      uSpotColor: { value: lights.spotColor },
      uRoomMin: { value: new THREE.Vector3(-HX, 0, -HZ) }, uRoomMax: { value: new THREE.Vector3(HX, ROOM.H, HZ) },
      uSky: { value: new THREE.Vector4(SKYLIGHT.x0, SKYLIGHT.x1, SKYLIGHT.z0, SKYLIGHT.z1) }, uSkyL: { value: lights.skyL },
      uWin: { value: new THREE.Vector4(WINDOW.x0, WINDOW.x1, WINDOW.y0, WINDOW.y1) }, uWinGain: { value: lights.winGain },
      uPano: { value: pano },
      uAmbient: { value: lights.ambient },
      uAreaN: { value: q.areaN }, uAoN: { value: q.aoN }, uSpotN: { value: q.spotN },
      // 8-bit fallback (no float render targets): store E/4 and scale back up in the materials.
      uOutScale: { value: halfOk ? 1 : 0.25 },
    },
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  const u = mat.uniforms;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const r = p.rect!;
    // Pixel rect including padding.
    const x0 = Math.round(r.x * size) - PAD, y0 = Math.round(r.y * size) - PAD;
    const w = Math.round(r.z * size) + PAD * 2, h = Math.round(r.w * size) + PAD * 2;
    const ps = PAD / Math.max(1, Math.round(r.z * size)), pt = PAD / Math.max(1, Math.round(r.w * size));
    u.uPadRect.value.set(-ps, -pt, 1 + ps, 1 + pt);
    u.uOrigin.value.copy(p.origin); u.uU.value.copy(p.u); u.uV.value.copy(p.v); u.uN.value.copy(normalOf(p));
    u.uSize.value.set(p.w, p.h);
    rt.viewport.set(x0, y0, w, h);
    rt.scissor.set(x0, y0, w, h);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(quad, cam);
    onProgress?.((i + 1) / planes.length);
    await new Promise((res) => requestAnimationFrame(res));
  }
  rt.scissorTest = false;
  rt.viewport.set(0, 0, size, size);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  mat.dispose();
  quad.geometry.dispose();
  return { texture: rt.texture, intensity: halfOk ? 1 : 4, size };
}
