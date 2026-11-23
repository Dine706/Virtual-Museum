// The centrepiece: a painted relief model of the 31 × 31 km window, cut like a museum block and set on a plinth.
// Built from the same Copernicus DEM as the 3D map (terrarium PNG), coloured from ESA WorldCover classes with
// the WDPA reserve outline (amber) and the national borders (dashed) painted on, and 200 m contour lines.
// Vertical exaggeration ×2 (stated on the label). Lit by two of the gallery's spotlights with real self-shadows
// (ray-marched in the shader) so the ridge reads as it would under museum lights.
import * as THREE from 'three';
import { BBOX, lonLatToXZ, WORLD, WORLD_D, WORLD_W } from '../data/geo';
import type { Heightfield } from '../scene/heightfield';
import { RELIEF, type Spot } from './layout';

export interface ReliefInput {
  hf: Heightfield;
  landcover: { data: Uint8ClampedArray; width: number; height: number };
  reserve: GeoJSON;
  borders: GeoJSON;
  spots: Spot[]; // the two relief spots
  spotColor: THREE.Color;
  skyE: THREE.Color;
  ambient: THREE.Color;
  segments: number;
  anisotropy: number;
}

interface GeoJSON { features: { geometry: { type: string; coordinates: unknown } }[] }

// Muted, hand-painted palette for WorldCover classes (museum relief look; the map app uses its own).
const PALETTE: Record<number, [number, number, number]> = {
  10: [92, 108, 74],   // tree cover
  20: [128, 128, 82],  // shrubland
  30: [180, 166, 120], // grassland
  40: [190, 166, 118], // cropland
  50: [150, 136, 126], // built-up
  60: [168, 152, 130], // bare / sparse
  80: [104, 140, 158], // water
  90: [118, 142, 116], // wetland
};

export class Relief {
  readonly group = new THREE.Group();
  /** model-space size (x, z) and placement */
  readonly sx = RELIEF.size;
  readonly sz = RELIEF.size * (WORLD_D / WORLD_W);
  readonly minX = RELIEF.cx - RELIEF.size / 2;
  readonly minZ: number;
  readonly vs = (RELIEF.size / WORLD_W) * RELIEF.exag; // vertical metres of model per metre of terrain
  readonly y0: number; // model y of the lowest terrain sample
  readonly top: THREE.Mesh;
  private markers: THREE.Sprite[] = [];

  constructor(private readonly inp: ReliefInput) {
    const { hf } = inp;
    this.minZ = RELIEF.cz - this.sz / 2;
    this.y0 = RELIEF.plinthH + RELIEF.base;
    const colTex = this.paintTexture(inp.anisotropy);
    const nhTex = this.normalHeightTexture();
    const S = inp.spots;
    const uniforms = {
      uNH: { value: nhTex }, uCol: { value: colTex },
      uSpotPos: { value: S.map((s) => s.pos) },
      uSpotDir: { value: S.map((s) => s.target.clone().sub(s.pos).normalize()) },
      uSpotCone: { value: S.map((s) => new THREE.Vector3(s.cosOuter, s.cosInner, s.intensity)) },
      uSpotColor: { value: inp.spotColor },
      uSkyE: { value: inp.skyE }, uAmb: { value: inp.ambient },
      uBox: { value: new THREE.Vector4(this.minX, this.minZ, this.sx, this.sz) },
      uH: { value: new THREE.Vector3(this.y0, (hf.max - hf.min) * this.vs, hf.min) },
      uRange: { value: hf.max - hf.min },
    };
    const top = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
    const side = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, defines: { SIDE: 1 } });
    this.top = new THREE.Mesh(this.topGeometry(inp.segments), top);
    this.top.name = 'relief';
    const sides = new THREE.Mesh(this.sideGeometry(inp.segments), side);
    this.group.add(this.top, sides);
  }

  /** Model position of a terrain point (lon, lat) on the relief surface. */
  modelPoint(lon: number, lat: number, lift = 0): THREE.Vector3 {
    const [x, z] = lonLatToXZ(lon, lat);
    return new THREE.Vector3(
      this.minX + ((x - WORLD.minX) / WORLD_W) * this.sx,
      this.y0 + (this.inp.hf.heightAt(x, z) - this.inp.hf.min) * this.vs + lift,
      this.minZ + ((z - WORLD.minZ) / WORLD_D) * this.sz,
    );
  }

  private heightAtUV(u: number, v: number): number {
    return this.inp.hf.heightAt(WORLD.minX + u * WORLD_W, WORLD.minZ + v * WORLD_D);
  }

  private topGeometry(n: number): THREE.BufferGeometry {
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    const { hf } = this.inp;
    for (let j = 0, k = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++, k++) {
        const u = i / n, v = j / n;
        pos[k * 3] = this.minX + u * this.sx;
        pos[k * 3 + 1] = this.y0 + (this.heightAtUV(u, v) - hf.min) * this.vs;
        pos[k * 3 + 2] = this.minZ + v * this.sz;
        uv[k * 2] = u; uv[k * 2 + 1] = v;
      }
    }
    const idx = new Uint32Array(n * n * 6);
    for (let j = 0, k = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** The four cut faces of the block, from the terrain edge down to the plinth top. */
  private sideGeometry(n: number): THREE.BufferGeometry {
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    const { hf } = this.inp;
    const yb = RELIEF.plinthH;
    const edges: [number, number, number, number, [number, number, number]][] = [
      [0, 1, 1, 1, [0, 0, 1]],   // south edge v = 1, normal +z
      [1, 0, 0, 0, [0, 0, -1]],  // north edge v = 0
      [0, 0, 0, 1, [-1, 0, 0]],  // west edge u = 0
      [1, 1, 1, 0, [1, 0, 0]],   // east edge u = 1
    ];
    for (const [u0, v0, u1, v1, nrm] of edges) {
      const base = P.length / 3;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
        const x = this.minX + u * this.sx, z = this.minZ + v * this.sz;
        const y = this.y0 + (this.heightAtUV(u, v) - hf.min) * this.vs;
        P.push(x, y, z, x, yb, z);
        N.push(...nrm, ...nrm);
        U.push(u, v, u, v);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        // winding so the face points along nrm
        I.push(a, b, c, c, b, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  }

  /** RGB = model-space normal, A = height (0..1) for shading, self-shadowing and cavity. */
  private normalHeightTexture(): THREE.DataTexture {
    const { hf } = this.inp;
    const n = hf.size;
    const H = hf.heights;
    const data = new Uint8Array(n * n * 4);
    const cx = this.sx / n, cz = this.sz / n, range = hf.max - hf.min;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const l = H[r * n + Math.max(0, c - 1)], rr = H[r * n + Math.min(n - 1, c + 1)];
        const t = H[Math.max(0, r - 1) * n + c], b = H[Math.min(n - 1, r + 1) * n + c];
        const dx = ((rr - l) * this.vs) / (2 * cx), dz = ((b - t) * this.vs) / (2 * cz);
        const len = Math.hypot(dx, 1, dz);
        const k = (r * n + c) * 4;
        data[k] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round(((-dz / len) * 0.5 + 0.5) * 255);
        data[k + 3] = Math.round(((H[r * n + c] - hf.min) / range) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** Land-cover colours with the reserve outline and national borders painted on. */
  private paintTexture(anisotropy: number): THREE.CanvasTexture {
    const N = 2048;
    const lc = this.inp.landcover;
    const src = document.createElement('canvas');
    src.width = lc.width; src.height = lc.height;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(lc.width, lc.height);
    for (let i = 0; i < lc.width * lc.height; i++) {
      const p = PALETTE[lc.data[i * 4]] ?? PALETTE[30];
      img.data[i * 4] = p[0]; img.data[i * 4 + 1] = p[1]; img.data[i * 4 + 2] = p[2]; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(1.2px)';
    ctx.drawImage(src, 0, 0, N, N);
    ctx.filter = 'none';
    const px = (lon: number, lat: number): [number, number] =>
      [((lon - BBOX.west) / (BBOX.east - BBOX.west)) * N, ((BBOX.north - lat) / (BBOX.north - BBOX.south)) * N];
    const path = (ring: [number, number][]) => {
      ring.forEach(([lon, lat], i) => { const [x, y] = px(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    };
    // National borders: thin dashed off-white.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(244, 240, 230, .85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    for (const f of this.inp.borders.features) {
      const g = f.geometry;
      const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates) as [number, number][][];
      ctx.beginPath();
      lines.forEach(path);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Reserve (WDPA): amber outline.
    ctx.strokeStyle = '#D9A53A';
    ctx.lineWidth = 5;
    for (const f of this.inp.reserve.features) {
      const g = f.geometry;
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as [number, number][][][];
      ctx.beginPath();
      for (const poly of polys) for (const ring of poly) { path(ring); ctx.closePath(); }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.flipY = false; // canvas row 0 = north = v 0, like the heightfield
    return tex;
  }

  /** Numbered markers (brass pins with a disc) on the hotspots shown in this gallery. */
  addMarkers(items: { id: string; order: number; lon: number; lat: number }[]): THREE.Object3D[] {
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x7a6440, metalness: 0.9, roughness: 0.35 });
    const stemGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6);
    for (const it of items) {
      const ground = this.modelPoint(it.lon, it.lat);
      const h = 0.11;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.scale.y = h;
      stem.position.copy(ground).add(new THREE.Vector3(0, h / 2, 0));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberDisc(it.order), toneMapped: false, depthTest: true }));
      sprite.scale.setScalar(0.085);
      sprite.position.copy(ground).add(new THREE.Vector3(0, h + 0.03, 0));
      sprite.userData.exhibit = it.id;
      sprite.name = `marker:${it.id}`;
      this.group.add(stem, sprite);
      this.markers.push(sprite);
    }
    return this.markers;
  }
}

function numberDisc(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fillStyle = '#1E2618'; g.fill();
  g.lineWidth = 7; g.strokeStyle = '#E9E2CF'; g.stroke();
  g.fillStyle = '#F3EEDF';
  g.font = '600 64px "Inter Variable", Inter, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = /* glsl */`
varying vec3 vW;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vUv = uv;
  vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
uniform sampler2D uNH, uCol;
uniform vec3 uSpotPos[2], uSpotDir[2], uSpotCone[2];
uniform vec3 uSpotColor, uSkyE, uAmb;
uniform vec4 uBox;   // minX, minZ, sizeX, sizeZ
uniform vec3 uH;     // y of the lowest sample, model height range, terrain min (m)
uniform float uRange; // terrain height range (m)
varying vec3 vW;
varying vec2 vUv;
varying vec3 vN;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float groundY(vec2 xz) {
  vec2 uv = (xz - uBox.xy) / uBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1.0;
  return uH.x + textureLod(uNH, uv, 0.0).a * uH.y;
}

float shadow(vec3 p, vec3 l) {
  float vis = 1.0;
  float t = 0.012;
  for (int i = 0; i < 28; i++) {
    vec3 q = p + l * t;
    if (q.y > uH.x + uH.y + 0.01) break;
    float g = groundY(q.xz);
    if (g < 0.0) break;
    vis = min(vis, clamp(14.0 * (q.y - g) / t + 0.5, 0.0, 1.0));
    t += 0.014 + t * 0.06;
  }
  return vis;
}

void main() {
  vec3 N;
  vec3 albedo;
  float h01;
#ifdef SIDE
  N = normalize(vN);
  h01 = clamp((vW.y - uH.x) / max(uH.y, 1e-3), 0.0, 1.0);
  // Cut face of the block: warm plaster with faint 100 m bands.
  albedo = vec3(0.80, 0.76, 0.68);
  float hm = vW.y < uH.x ? -1.0 : uH.z + h01 * uRange;
  float band = abs(fract(hm / 100.0) - 0.5);
  albedo *= vW.y < uH.x ? 0.93 : 1.0 - 0.05 * smoothstep(0.42, 0.5, band);
#else
  vec4 nh = texture2D(uNH, vUv);
  N = normalize(nh.rgb * 2.0 - 1.0);
  h01 = nh.a;
  albedo = texture2D(uCol, vUv).rgb;
  // 200 m contour lines, painted thin.
  float hm = uH.z + h01 * uRange;
  float f = hm / 200.0;
  float w = fwidth(f);
  float line = 1.0 - smoothstep(0.0, w * 1.3, abs(fract(f - 0.5) - 0.5));
  albedo *= 1.0 - 0.22 * line;
  // Hand-finished surface: a little paint/plaster variation.
  albedo *= 0.94 + 0.12 * vnoise(vUv * 900.0) * vnoise(vUv * 140.0 + 7.0);
#endif
  // Cavity (local hollows darker): compare with the blurred height.
  float avg = textureLod(uNH, vUv, 4.0).a;
  float cavity = clamp(1.0 - (avg - h01) * 3.0, 0.65, 1.08);

  vec3 E = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec3 d = uSpotPos[i] - vW;
    float dist = length(d);
    vec3 l = d / dist;
    float cp = dot(N, l);
    if (cp <= 0.0) continue;
    float cone = smoothstep(uSpotCone[i].x, uSpotCone[i].y, dot(-l, uSpotDir[i]));
#ifdef SIDE
    float vis = 1.0;
#else
    float vis = shadow(vW + N * 0.002, l);
#endif
    E += uSpotColor * uSpotCone[i].z * cone * cp / (dist * dist) * vis;
  }
  E += uSkyE * (0.55 + 0.45 * N.y) * cavity;
  E += uAmb * cavity;
  gl_FragColor = vec4(albedo * E / 3.14159265, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
