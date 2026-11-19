// The forest around the walker. Trees live in 32 m cells, generated on demand:
// • in the four hero zones, the dominant crowns sit at their measured positions and heights (1 m canopy model);
// • everywhere, canopy, understorey, regrowth, palms, tree ferns and Protea are placed from the local canopy
//   height, land cover, altitude belt and stream proximity (biome.ts) – deterministic, so the same place
//   always looks the same.
// Near trees are full geometry; distant ones are camera-facing impostors rendered from the same models.
import * as THREE from 'three';
import { hash2 } from './noise';
import type { WalkData, Crown, ZoneInfo } from './data';
import { biomeAt, type Biome } from './biome';
import { buildPlant, PLANT_TYPES, type PlantGeo, type PlantType, type LeafKind, type BarkKind, type FrondKind } from './plants';
import { LEAVES, leafCluster, bark, frond, mossStrands, singleLeaf } from './textures';
import { trailK, AREA } from './data';
import { walkMaterial, shared } from './env';
import type { PhotoSet } from './photo';
import type { ModelSet } from './models';

export interface TreeInst {
  type: PlantType; variant: number;
  x: number; y: number; z: number; h: number; crown: number; rot: number; tint: number;
  measured: boolean; zone: string | null;
}

export interface ForestOpts { range: number; near: number; variants: number; impostorRes: number; shadows: boolean }

const CELL = 32;
const VARIANTS = 3;

interface Kind {
  geo: PlantGeo;
  trunk?: THREE.InstancedMesh; leaves?: THREE.InstancedMesh; fronds?: THREE.InstancedMesh; moss?: THREE.InstancedMesh;
  imp: THREE.InstancedMesh;
  impW: number; // impostor half width (model units)
  capNear: number; capFar: number;
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

function translucency(s: THREE.WebGLProgramParametersWithUniforms) {
  // Foliage right in front of the eye dissolves (dithered) instead of filling the screen.
  s.fragmentShader = s.fragmentShader.replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
    { float dn = length(vViewPosition); float th = 0.9 + 0.9 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      if (dn < th) discard; }`);
  s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
    { vec3 Vv = normalize(-vViewPosition); float bl = pow(max(dot(-Vv, uSunView), 0.0), 3.0);
      outgoingLight += diffuseColor.rgb * uSunColor * bl * 0.55; }
    #include <opaque_fragment>`);
}

const depthCache = new WeakMap<THREE.Material, THREE.MeshDepthMaterial>();
/** Shadow-casting with the leaf / frond alpha (cut-out shadows, not solid cards). */
export function depthFor(mat: THREE.Material): THREE.MeshDepthMaterial | undefined {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.map || !(m.alphaTest > 0)) return undefined;
  let d = depthCache.get(mat);
  if (!d) {
    d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide });
    depthCache.set(mat, d);
  }
  return d;
}

/** Smoother cut-out edges with MSAA (alpha to coverage). */
export function foliage<T extends THREE.Material>(mat: T, msaa: boolean): T {
  if (msaa) { mat.alphaToCoverage = true; }
  return mat;
}

export class Forest {
  readonly group = new THREE.Group();
  private kinds = new Map<string, Kind>();
  private cells = new Map<string, TreeInst[]>();
  private crownCells = new Map<string, Crown[]>();
  private zonesLoaded = new Set<string>();
  private pending: string[] = [];
  private lastBuild = new THREE.Vector3(1e9, 0, 1e9);
  /** Trees within ~90 m, for picking and collision. */
  nearTrees: TreeInst[] = [];
  private leafMats = new Map<LeafKind, THREE.Material>();
  private barkMats = new Map<BarkKind, THREE.Material>();
  private frondMats = new Map<FrondKind, THREE.Material>();
  private mossMat: THREE.Material | null = null;
  private impMats: THREE.MeshBasicMaterial[] = [];
  private impostorTargets: THREE.WebGLRenderTarget[] = [];
  dirty = true;

  constructor(private data: WalkData, private opts: ForestOpts) {}

  /** Build plant variants, materials and impostor textures (needs the renderer). */
  init(renderer: THREE.WebGLRenderer, generatedFoliage?: THREE.Texture) {
    const msaa = !!renderer.getContext().getContextAttributes()?.antialias;
    const leafTex = (k: keyof typeof LEAVES) => leafCluster(LEAVES[k], k.length * 13 + 5, this.opts.impostorRes >= 512 ? 512 : 256);
    this.leafMats.set('single', foliage(walkMaterial(new THREE.MeshStandardMaterial({ map: singleLeaf(3), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.45 }), 'leaf', translucency), msaa));
    for (const k of Object.keys(LEAVES) as (keyof typeof LEAVES)[]) {
      this.leafMats.set(k, foliage(walkMaterial(new THREE.MeshStandardMaterial({ map: leafTex(k), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78 }), 'leaf', translucency), msaa));
    }
    for (const k of ['brown', 'grey', 'mossy', 'palm', 'fern', 'lichen'] as BarkKind[]) {
      const t = bark(k, k.length * 17 + 3);
      this.barkMats.set(k, walkMaterial(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.95, vertexColors: true }), 'leaf'));
    }
    for (const k of ['fern', 'oilpalm', 'raphia'] as FrondKind[]) {
      this.frondMats.set(k, foliage(walkMaterial(new THREE.MeshStandardMaterial({ map: frond(k, k.length * 23 + 1), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.7 }), 'frond', translucency), msaa));
    }
    this.mossMat = walkMaterial(new THREE.MeshStandardMaterial({ map: mossStrands(9), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9 }), 'leaf');

    // Bake distant impostors from the same foliage used nearby, so the LOD boundary keeps its look.
    if (generatedFoliage) this.useFoliage(generatedFoliage);

    for (const type of PLANT_TYPES) {
      for (let v = 0; v < Math.min(VARIANTS, this.opts.variants); v++) {
        const geo = buildPlant(type, v + 1);
        const kind: Kind = { geo, imp: null as unknown as THREE.InstancedMesh, impW: 0.5, capNear: 0, capFar: 0 };
        this.kinds.set(`${type}:${v}`, kind);
        this.makeImpostor(renderer, kind);
      }
    }
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, cast: boolean) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    const depth = depthFor(mat);
    if (depth) m.customDepthMaterial = depth;
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = cast && this.opts.shadows;
    m.receiveShadow = this.opts.shadows;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    return m;
  }

  private ensureCapacity(kind: Kind, near: number, far: number) {
    if (near > kind.capNear) {
      const cap = Math.ceil(near * 1.5) + 16;
      for (const key of ['trunk', 'leaves', 'fronds', 'moss'] as const) { const m = kind[key]; if (m) { this.group.remove(m); m.dispose(); } }
      const g = kind.geo;
      const first = g.trunk ? this.mesh(g.trunk, this.barkMats.get(g.barkKind)!, cap, true) : undefined;
      kind.trunk = first;
      kind.leaves = g.leaves ? this.mesh(g.leaves, this.leafMats.get(g.leafKind!)!, cap, true) : undefined;
      kind.fronds = g.fronds ? this.mesh(g.fronds, this.frondMats.get(g.frondKind!)!, cap, true) : undefined;
      kind.moss = g.moss ? this.mesh(g.moss, this.mossMat!, cap, false) : undefined;
      // Share one instance buffer (and colour) across the parts of the same plant.
      const src = kind.trunk ?? kind.leaves ?? kind.fronds;
      if (src) {
        src.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        src.instanceColor.setUsage(THREE.DynamicDrawUsage);
        for (const m of [kind.trunk, kind.leaves, kind.fronds, kind.moss]) {
          if (m && m !== src) { m.instanceMatrix = src.instanceMatrix; m.instanceColor = src.instanceColor; }
        }
      }
      kind.capNear = cap;
    }
    if (far > kind.capFar) {
      const cap = Math.ceil(far * 1.4) + 64;
      const old = kind.imp;
      kind.imp = this.mesh(old.geometry, old.material as THREE.Material, cap, true);
      kind.imp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      kind.imp.receiveShadow = false;
      this.group.remove(old);
      old.dispose();
      kind.capFar = cap;
    }
  }

  /** Render the plant from two sides into one texture; distant instances are two crossed quads. */
  private makeImpostor(renderer: THREE.WebGLRenderer, kind: Kind) {
    const g = kind.geo;
    const box = new THREE.Box3();
    for (const geo of [g.trunk, g.leaves, g.fronds]) if (geo) { geo.computeBoundingBox(); box.union(geo.boundingBox!); }
    const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), 0.1) * 1.02;
    const top = Math.max(box.max.y, 0.2) * 1.02;
    kind.impW = halfW;
    const res = this.opts.impostorRes;
    const rt = new THREE.WebGLRenderTarget(res * 2, res, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.impostorTargets.push(rt);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight('#E9E4D2', '#4B4630', 1.6);
    const sun = new THREE.DirectionalLight('#FFF2DE', 2.4);
    sun.position.set(0.6, 1, 1);
    scene.add(hemi, sun);
    const parts: [THREE.BufferGeometry | null, THREE.Material | undefined][] = [
      [g.trunk, this.barkMats.get(g.barkKind)], [g.leaves, g.leafKind ? this.leafMats.get(g.leafKind) : undefined],
      [g.fronds, g.frondKind ? this.frondMats.get(g.frondKind) : undefined], [g.moss, this.mossMat ?? undefined],
    ];
    const holder = new THREE.Group();
    for (const [geo, mat] of parts) if (geo && mat) holder.add(new THREE.Mesh(geo, mat));
    scene.add(holder);
    const cam = new THREE.OrthographicCamera(-halfW, halfW, top, 0, -10, 10);
    const prevTarget = renderer.getRenderTarget();
    const prevFog = shared.uFogDensity.value, prevHaze = shared.uHaze.value;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    shared.uFogDensity.value = 0; shared.uHaze.value = 0;
    renderer.setRenderTarget(rt);
    renderer.setClearColor('#3c4a2c', 0);
    renderer.clear();
    for (let side = 0; side < 2; side++) {
      holder.rotation.y = side * Math.PI / 2;
      cam.position.set(0, 0, 5);
      cam.lookAt(0, 0, 0);
      rt.viewport.set(side * res, 0, res, res);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    shared.uFogDensity.value = prevFog; shared.uHaze.value = prevHaze;
    rt.viewport.set(0, 0, res * 2, res);
    // Crossed quads.
    const geo = new THREE.BufferGeometry();
    const p: number[] = [], uv: number[] = [], n: number[] = [], idx: number[] = [];
    const quad = (ax: THREE.Vector3, u0: number) => {
      const b0 = p.length / 3;
      for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        p.push(ax.x * sx * halfW, sy * top, ax.z * sx * halfW);
        uv.push(u0 + (sx > 0 ? 0.5 : 0), sy);
        n.push(0, 1, 0);
      }
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    };
    quad(new THREE.Vector3(1, 0, 0), 0);
    quad(new THREE.Vector3(0, 0, -1), 0.5);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setIndex(idx);
    const mat = walkMaterial(new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide }));
    this.impMats.push(mat);
    kind.imp = this.mesh(geo, mat, 1, true);
    kind.imp.receiveShadow = false;
    kind.capFar = 1;
    holder.clear();
  }

  /** Generated bark for trunks (high-quality look). */
  usePhotos(p: PhotoSet) {
    const set = (k: BarkKind, t: { map: THREE.Texture; normal: THREE.Texture }, rx: number, ry: number) => {
      const m = this.barkMats.get(k) as THREE.MeshStandardMaterial | undefined;
      if (!m) return;
      t.map.repeat.set(rx, ry); t.normal.repeat.set(rx, ry);
      m.map = t.map; m.normalMap = t.normal; m.normalScale.set(1.2, 1.2);
      m.needsUpdate = true;
    };
    set('brown', p.bark, 2, 3);
    set('grey', p.barkGrey, 2, 3);
    set('mossy', p.barkGrey, 2, 3);
    set('lichen', p.barkGrey, 2, 3);
    set('palm', p.palm, 1, 2);
  }

  /** Generated generic broadleaf texture; specialised palms/ferns/Protea keep their own silhouettes. */
  useFoliage(texture: THREE.Texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    for (const key of ['lowland', 'montane', 'regrowth', 'bigleaf'] as LeafKind[]) {
      const material = this.leafMats.get(key) as THREE.MeshStandardMaterial | undefined;
      if (!material) continue;
      material.map?.dispose(); material.map = texture; material.needsUpdate = true;
      material.roughness = 0.68;
    }
  }

  /** Scanned surface roots at the feet of the big trees near the walker (high-quality look). */
  private roots: THREE.InstancedMesh | null = null;
  useModels(m: ModelSet) {
    const r = m.single_root;
    if (!r) return;
    this.roots = new THREE.InstancedMesh(r.geometry, walkMaterial(r.material, 'none', undefined, 'scan-root'), 900);
    this.roots.count = 0; this.roots.castShadow = this.opts.shadows; this.roots.receiveShadow = this.opts.shadows; this.roots.frustumCulled = false;
    this.group.add(this.roots);
    this.dirty = true;
  }

  /** Brightness of the baked impostors under the current light (they are unlit). */
  setImpostorLight(k: number) { for (const m of this.impMats) m.color.setScalar(k); }

  // ---------------------------------------------------------------- placement

  private async zonesNear(x: number, z: number) {
    for (const zone of this.data.index.zones) {
      if (this.zonesLoaded.has(zone.id)) continue;
      if (Math.abs(x - zone.cx) > zone.half + this.opts.range + 200 || Math.abs(z - zone.cz) > zone.half + this.opts.range + 200) continue;
      this.zonesLoaded.add(zone.id);
      const crowns = await this.data.loadCrowns(zone);
      for (const c of crowns) {
        const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
        let l = this.crownCells.get(key);
        if (!l) this.crownCells.set(key, (l = []));
        l.push(c);
      }
      // Cells already generated in this zone must be redone with the measured crowns.
      for (const key of [...this.cells.keys()]) {
        const [ci, cj] = key.split(',').map(Number);
        if (this.zoneOfCell(ci, cj)?.id === zone.id) this.cells.delete(key);
      }
      this.dirty = true;
    }
  }

  private zoneOfCell(ci: number, cj: number): ZoneInfo | null {
    return this.data.zoneAt((ci + 0.5) * CELL, (cj + 0.5) * CELL, -CELL);
  }

  private pickType(b: Biome, h: number, u: number, layer: 'top' | 'under', zone: ZoneInfo | null): PlantType {
    const lowland = b.cloud < 0.5;
    if (b.wet > 0.55) {
      if (!lowland || b.elev > 650) return u < 0.55 ? 'treefern' : layer === 'top' ? 'montane' : 'understory';
      if (u < 0.3) return 'raphia';
      if (u < 0.42) return 'treefern';
    }
    if (b.forest > 0.45) {
      if (!lowland) {
        if (layer === 'under') return u < 0.22 ? 'treefern' : u < 0.4 ? 'montane' : 'understory';
        return 'montane';
      }
      if (layer === 'under') return zone?.id === 'z3-bossou' && u < 0.12 ? 'oilpalm' : 'understory';
      if (h >= 28) return 'emergent';
      if (h >= 12) return zone?.id === 'z3-bossou' && u < 0.1 ? 'oilpalm' : 'canopy';
      return 'understory';
    }
    if (b.high > 0.5 || (b.cloud > 0.5 && b.grass > 0.3)) return h > 6 ? 'montane' : 'protea';
    if (b.regrowth > 0.3) {
      const palm = zone?.id === 'z3-bossou' ? 0.25 : 0.1;
      return u < palm && lowland ? 'oilpalm' : u < palm + 0.12 ? 'understory' : 'regrowth';
    }
    if (b.built > 0.5) return u < 0.6 ? 'oilpalm' : 'savanna';
    return lowland ? 'savanna' : 'protea';
  }

  private genCell(ci: number, cj: number): TreeInst[] {
    const out: TreeInst[] = [];
    const zone = this.zoneOfCell(ci, cj);
    const crowns = this.crownCells.get(`${ci},${cj}`);
    const add = (type: PlantType, x: number, z: number, h: number, crownR: number, seed: number, measured: boolean) => {
      const s = this.data.streamAt(x, z);
      if (s.dist < s.width * 1.3 && type !== 'raphia' && type !== 'treefern') return;
      // terrain type: no trees in water or on sand, sparse regrowth on old mine ground, crops only in fields,
      // only low growth on bare rock, none in open water of the land-cover map
      const ac = this.data.areaAt(x, z);
      if (ac === AREA.water || ac === AREA.sand || this.data.attrAt(x, z).cls === 80) return;
      if (ac === AREA.mine && this.data.attrAt(x, z).canopy < 6 && (h > 5 || hash2(Math.floor(x * 3), Math.floor(z * 3), 71) > 0.3)) return;
      if (ac === AREA.field && type !== 'oilpalm' && h > 3) return;
      if (ac === AREA.rock && h > 6) return;
      // keep roads, paths, trails and houses clear (OpenStreetMap + forest trails)
      if (this.data.pathAt(x, z).dist < 0.6 + (h > 8 ? 1 : 0)) return;
      if (this.data.buildingAt(x, z, 1.5)) return;
      if (h > 1.5 && trailK(x, z, 1) > 0.25) return;
      const geoCrown = type === 'emergent' ? 0.36 : type === 'montane' ? 0.42 : type === 'protea' ? 0.45 : type === 'oilpalm' ? 0.45 : type === 'raphia' ? 0.55 : type === 'treefern' ? 0.42 : type === 'savanna' ? 0.4 : 0.3;
      const crown = Math.min(1.45, Math.max(0.7, crownR / Math.max(1, h) / geoCrown));
      out.push({
        type, variant: Math.floor(hash2(Math.floor(x * 10), Math.floor(z * 10), seed + 3) * VARIANTS) % Math.min(VARIANTS, this.opts.variants),
        x, z, y: this.data.heightAt(x, z) - 0.12, h, crown, rot: hash2(Math.floor(x * 7), Math.floor(z * 7), seed + 5) * Math.PI * 2,
        tint: 0.82 + hash2(Math.floor(x * 3), Math.floor(z * 3), seed + 9) * 0.3, measured, zone: zone?.id ?? null,
      });
    };
    const x0 = ci * CELL, z0 = cj * CELL;
    const H = (i: number, j: number, s: number) => hash2(ci * 64 + i, cj * 64 + j, s);
    // 1. Measured dominant crowns (hero zones).
    if (crowns) {
      for (const c of crowns) {
        const b = biomeAt(this.data, c.x, c.z);
        add(this.pickType(b, c.h, hash2(Math.floor(c.x), Math.floor(c.z), 77), 'top', zone), c.x, c.z, c.h, Math.max(c.r, 0.26 * c.h), 1, true);
      }
    }
    // 2. Canopy layer (8 m sub-grid), lighter where measured crowns already stand.
    const canopyP = crowns ? 0.3 : 0.8;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = x0 + (i + 0.15 + H(i, j, 1) * 0.7) * 8, z = z0 + (j + 0.15 + H(i, j, 2) * 0.7) * 8;
      const b = biomeAt(this.data, x, z);
      if (H(i, j, 3) > b.forest * canopyP) continue;
      const h = Math.max(6, b.canopy * (0.95 + H(i, j, 4) * 0.55));
      add(this.pickType(b, h, H(i, j, 5), 'top', zone), x, z, h, h * (0.26 + H(i, j, 6) * 0.12), 11, false);
    }
    // 3. Understorey (5.3 m sub-grid).
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const x = x0 + (i + 0.1 + H(i, j, 21) * 0.8) * (CELL / 6), z = z0 + (j + 0.1 + H(i, j, 22) * 0.8) * (CELL / 6);
      const b = biomeAt(this.data, x, z);
      const u = H(i, j, 23);
      const pForest = b.forest * 0.3, pRegrowth = b.regrowth * 0.55, pWet = b.wet * 0.45 * (b.forest + b.regrowth > 0.2 ? 1 : 0.4);
      const pProtea = (b.high > 0.3 || b.cloud > 0.6) && b.forest < 0.4 ? b.grass * 0.16 * (1 - b.rock) * (1 - Math.max(0, (b.elev - 1700) / 60)) : 0;
      const pSavanna = b.cloud < 0.5 ? b.grass * 0.04 : 0;
      const pPalm = b.built * 0.08;
      const p = pForest + pRegrowth + pWet + pProtea + pSavanna + pPalm;
      if (u > Math.min(0.92, p)) continue;
      let h: number, type: PlantType;
      if (u < pWet) { type = this.pickType({ ...b, wet: 1 }, 6, H(i, j, 24), 'under', zone); h = type === 'raphia' ? 7 + H(i, j, 25) * 5 : 2.5 + H(i, j, 25) * 5; }
      else if (u < pWet + pForest) { type = this.pickType(b, 8, H(i, j, 24), 'under', zone); h = type === 'treefern' ? 3 + H(i, j, 25) * 5 : type === 'oilpalm' ? 9 + H(i, j, 25) * 6 : Math.min(b.canopy * 0.7, 4 + H(i, j, 25) * 8); }
      else if (u < pWet + pForest + pRegrowth) { type = this.pickType(b, 5, H(i, j, 24), 'under', zone); h = type === 'oilpalm' ? 8 + H(i, j, 25) * 7 : 2 + H(i, j, 25) * Math.max(3, b.canopy + 2); }
      else if (u < pWet + pForest + pRegrowth + pProtea) { type = 'protea'; h = 1.4 + H(i, j, 25) * 3; }
      else if (u < pWet + pForest + pRegrowth + pProtea + pSavanna) { type = 'savanna'; h = 4 + H(i, j, 25) * 6; }
      else { type = 'oilpalm'; h = 8 + H(i, j, 25) * 7; }
      add(type, x, z, Math.max(1.2, h), (type === 'treefern' ? 0.45 : 0.3) * h + 0.5, 21, false);
    }
    // 5. Poles: thin straight young trees (5–15 cm) everywhere under closed forest (4 m sub-grid).
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = x0 + (i + 0.1 + H(i, j, 61) * 0.8) * 4, z = z0 + (j + 0.1 + H(i, j, 62) * 0.8) * 4;
      const b = biomeAt(this.data, x, z);
      if (H(i, j, 63) > b.forest * (b.cloud > 0.5 ? 0.3 : 0.5)) continue;
      const h = Math.max(4, Math.min(b.canopy * 0.85, 5 + H(i, j, 64) * 10));
      add('pole', x, z, h, h * 0.1, 61, false);
    }
    // 4. Shrub layer (3.2 m sub-grid): young trees and bushes that close the view under the canopy.
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
      const x = x0 + (i + 0.1 + H(i, j, 41) * 0.8) * 3.2, z = z0 + (j + 0.1 + H(i, j, 42) * 0.8) * 3.2;
      const b = biomeAt(this.data, x, z);
      const p = b.forest * (b.cloud > 0.5 ? 0.24 : 0.2) + b.regrowth * 0.3;
      if (H(i, j, 43) > p) continue;
      const fern = b.cloud > 0.5 && H(i, j, 44) < 0.35;
      const hs = fern ? 2 + H(i, j, 45) * 3 : 1.5 + H(i, j, 45) * 3.5;
      add(fern ? 'treefern' : H(i, j, 44) < 0.5 ? 'regrowth' : 'understory', x, z, hs, hs * 0.45, 51, false);
    }
    return out;
  }

  /** Generate missing cells within range (a few per call, nearest first). Returns true if anything changed. */
  update(eye: THREE.Vector3, budget = 24): boolean {
    void this.zonesNear(eye.x, eye.z);
    const R = this.opts.range;
    const c0 = Math.floor((eye.x - R) / CELL), c1 = Math.floor((eye.x + R) / CELL);
    const r0 = Math.floor((eye.z - R) / CELL), r1 = Math.floor((eye.z + R) / CELL);
    if (this.pending.length === 0 || this.lastBuild.distanceTo(eye) > 6) {
      const want: [number, string][] = [];
      for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
        const cx = (i + 0.5) * CELL - eye.x, cz = (j + 0.5) * CELL - eye.z;
        const d = Math.hypot(cx, cz);
        if (d > R + CELL) continue;
        const key = `${i},${j}`;
        if (!this.cells.has(key)) want.push([d, key]);
      }
      want.sort((a, b) => a[0] - b[0]);
      this.pending = want.map((w) => w[1]);
    }
    let made = 0;
    while (this.pending.length && made < budget) {
      const key = this.pending.shift()!;
      if (this.cells.has(key)) continue;
      const [i, j] = key.split(',').map(Number);
      this.cells.set(key, this.genCell(i, j));
      made++;
    }
    // Forget cells far behind.
    if (this.cells.size > 4000) {
      for (const key of this.cells.keys()) {
        const [i, j] = key.split(',').map(Number);
        if (Math.hypot((i + 0.5) * CELL - eye.x, (j + 0.5) * CELL - eye.z) > R * 1.6) this.cells.delete(key);
      }
    }
    const moved = this.lastBuild.distanceTo(eye) > 3;
    if (made || moved || this.dirty) { this.rebuild(eye); return true; }
    return false;
  }

  /** Regenerate everything (e.g. after the data window changed). */
  reset() { this.cells.clear(); this.pending = []; this.dirty = true; }

  private rebuild(eye: THREE.Vector3) {
    this.lastBuild.copy(eye);
    this.dirty = false;
    const R = this.opts.range, NEAR = this.opts.near;
    const near = new Map<string, TreeInst[]>(), far = new Map<string, TreeInst[]>();
    const close: TreeInst[] = [];
    for (const [key, list] of this.cells) {
      const [i, j] = key.split(',').map(Number);
      const cd = Math.hypot((i + 0.5) * CELL - eye.x, (j + 0.5) * CELL - eye.z);
      if (cd > R + CELL) continue;
      for (const t of list) {
        const d = Math.hypot(t.x - eye.x, t.z - eye.z);
        // ragged outer edge: each tree has its own cut-off in the last 15 % of the range (no visible circle)
        if (d > R * (0.85 + 0.15 * hash2(Math.floor(t.x * 7), Math.floor(t.z * 7), 5))) continue;
        const k = `${t.type}:${t.variant}`;
        // Tall trees stay detailed a little further (their crowns are big on screen).
        const lim = NEAR * (t.h > 20 ? 1.35 : t.h < 4 ? 0.6 : 1);
        const target = d < lim ? near : far;
        let l = target.get(k);
        if (!l) target.set(k, (l = []));
        l.push(t);
        if (d < 90) close.push(t);
      }
    }
    this.nearTrees = close;
    if (this.roots) {
      let n = 0;
      for (const t of close) {
        if (n > 880) break;
        if (t.h < 14 || !(t.type === 'emergent' || t.type === 'canopy' || t.type === 'montane')) continue;
        if (Math.hypot(t.x - eye.x, t.z - eye.z) > NEAR * 1.4) continue;
        const rt = t.h * t.crown * (t.type === 'montane' ? 0.04 : 0.024);
        const k = 3 + Math.floor(t.tint * 10) % 3;
        for (let q = 0; q < k; q++) {
          const th = t.rot + q * (Math.PI * 2 / k) + (q % 2) * 0.3;
          const L = t.h * (0.08 + 0.04 * ((q * 7 + Math.floor(t.h)) % 3) / 2);
          tmpQ.setFromAxisAngle(Y, Math.PI / 2 - th);
          tmpP.set(t.x + Math.cos(th) * rt * 0.5, t.y + 0.05, t.z + Math.sin(th) * rt * 0.5);
          tmpS.setScalar(L);
          this.roots.setMatrixAt(n++, tmpM.compose(tmpP, tmpQ, tmpS));
        }
      }
      this.roots.count = n;
      this.roots.instanceMatrix.needsUpdate = true;
    }
    for (const [k, kind] of this.kinds) {
      const nl = near.get(k) ?? [], fl = far.get(k) ?? [];
      this.ensureCapacity(kind, nl.length, fl.length);
      const src = kind.trunk ?? kind.leaves ?? kind.fronds;
      if (src) {
        nl.forEach((t, n) => {
          tmpQ.setFromAxisAngle(Y, t.rot);
          tmpS.set(t.h * t.crown, t.h, t.h * t.crown);
          tmpP.set(t.x, t.y, t.z);
          tmpM.compose(tmpP, tmpQ, tmpS);
          src.setMatrixAt(n, tmpM);
          src.setColorAt(n, tmpC.setScalar(t.tint));
        });
        for (const m of [kind.trunk, kind.leaves, kind.fronds, kind.moss]) if (m) m.count = nl.length;
        src.instanceMatrix.needsUpdate = true;
        if (src.instanceColor) src.instanceColor.needsUpdate = true;
      }
      fl.forEach((t, n) => {
        // Impostors face the walker (yaw only); the two quads keep some volume from the side.
        tmpQ.setFromAxisAngle(Y, Math.atan2(eye.x - t.x, eye.z - t.z));
        tmpS.set(t.h * t.crown, t.h, t.h * t.crown);
        tmpP.set(t.x, t.y, t.z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        kind.imp.setMatrixAt(n, tmpM);
        kind.imp.setColorAt(n, tmpC.setScalar(t.tint));
      });
      kind.imp.count = fl.length;
      kind.imp.instanceMatrix.needsUpdate = true;
      if (kind.imp.instanceColor) kind.imp.instanceColor.needsUpdate = true;
    }
  }

  /** Collision: push the walker out of trunks. */
  collide(p: THREE.Vector3, radius: number) {
    for (const t of this.nearTrees) {
      const tr = (t.type === 'raphia' || t.type === 'oilpalm' ? 0.035 : t.type === 'protea' || t.type === 'regrowth' ? 0.01 : 0.03) * t.h * t.crown + radius;
      const dx = p.x - t.x, dz = p.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < tr && d > 1e-4) { p.x = t.x + dx / d * tr; p.z = t.z + dz / d * tr; }
    }
  }

  get stats() {
    let n = 0, f = 0;
    for (const k of this.kinds.values()) { n += (k.trunk ?? k.leaves ?? k.fronds)?.count ?? 0; f += k.imp.count; }
    return { near: n, far: f, cells: this.cells.size };
  }

  dispose() {
    // Disposing only the material's texture leaves the off-screen framebuffer/depth attachment alive.
    for (const target of this.impostorTargets) target.dispose();
    this.impostorTargets = [];
  }
}
