// Scanned CC0 models (Poly Haven, public/walk/models/, scripts/fetch_models.mjs) for the high-quality look.
// Each GLB holds one mesh; we bake its node transform, convert quantised attributes to floats and normalise
// it (base at y = 0, centred, largest horizontal size 1) so it can be instanced like the procedural cover.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type ModelId = 'fern_02' | 'calathea_orbifolia_01' | 'moss_01' | 'rock_moss_set_01' | 'rock_07' | 'single_root' | 'deadfall';
export interface ScanModel { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; size: THREE.Vector3 }
export type ModelSet = Partial<Record<ModelId, ScanModel>>;

const IDS: ModelId[] = ['fern_02', 'calathea_orbifolia_01', 'moss_01', 'rock_moss_set_01', 'rock_07', 'single_root', 'deadfall'];

export function toFloat(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
}

export async function loadModels(base: string, anisotropy: number, normalise: Partial<Record<ModelId, 'root'>> = {}): Promise<ModelSet> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const out: ModelSet = {};
  await Promise.all(IDS.map(async (id) => {
    try {
      const gltf = await loader.loadAsync(`${base}walk/models/${id}.glb`);
      gltf.scene.updateMatrixWorld(true);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) return;
      const m = mesh as THREE.Mesh;
      const g = m.geometry.clone();
      toFloat(g);
      g.applyMatrix4(m.matrixWorld);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      if (normalise[id] === 'root') {
        // roots: start at the origin and run along +z, length 1
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.min.z);
        g.computeBoundingBox();
        const L = g.boundingBox!.max.z || 1;
        g.scale(1 / L, 1 / L, 1 / L);
      } else {
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        const s = 1 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 1e-3);
        g.scale(s, s, s);
      }
      g.computeBoundingBox();
      if (!g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
      const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({
        map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, roughness: src.roughness, metalness: 0,
        side: THREE.DoubleSide, vertexColors: true,
        alphaTest: src.transparent || src.alphaTest > 0 ? 0.5 : 0,
      });
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = anisotropy;
      const size = new THREE.Vector3();
      g.boundingBox!.getSize(size);
      out[id] = { geometry: g, material: mat, size };
    } catch (e) {
      console.warn(`walk: model ${id} unavailable`, e);
    }
  }));
  return out;
}
