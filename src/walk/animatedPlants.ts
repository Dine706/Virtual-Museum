import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { WalkData } from './data';
import { hash2 } from './noise';
import { walkMaterial } from './env';

/** A few close-up Blender-animated filler saplings. Species identity is deliberately unspecified. */
export class AnimatedPlants {
  readonly group = new THREE.Group();
  private template: THREE.Group | null = null;
  private clip: THREE.AnimationClip | null = null;
  private mixers: THREE.AnimationMixer[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private disposed = false;
  ready = false;

  async init(base: string) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${base}walk/models/generated_sapling.glb`);
    this.template = gltf.scene; this.clip = gltf.animations[0] ?? null;
    if (!this.clip) throw new Error('Sapling has no Blender animation');
    this.template.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const m of materials) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.map && mat.transparent) { mat.transparent = false; mat.alphaTest = 0.45; mat.depthWrite = true; }
        mat.side = THREE.DoubleSide;
        walkMaterial(mat, 'none', undefined, 'blender-animated-sapling');
      }
      object.castShadow = false; object.receiveShadow = true;
    });
    if (this.disposed) { this.release(); return; }
    this.ready = true;
  }

  update(data: WalkData, eye: THREE.Vector3, dt: number, reducedMotion: boolean) {
    if (!this.ready || !this.template || !this.clip) return;
    if (Math.hypot(eye.x - this.lastX, eye.z - this.lastZ) > 18) {
      this.lastX = eye.x; this.lastZ = eye.z;
      for (const mixer of this.mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
      this.group.clear(); this.mixers = [];
      const gx = Math.floor(eye.x / 8), gz = Math.floor(eye.z / 8);
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
        const cx = gx + i, cz = gz + j;
        if (hash2(cx, cz, 601) > 0.20 || this.mixers.length >= 8) continue;
        const x = (cx + 0.2 + hash2(cx, cz, 602) * 0.6) * 8;
        const z = (cz + 0.2 + hash2(cx, cz, 603) * 0.6) * 8;
        const a = data.attrAt(x, z), stream = data.streamAt(x, z);
        if (a.canopy < 6 || Math.hypot(x - eye.x, z - eye.z) < 3 || data.areaAt(x, z) !== 0 || data.pathAt(x, z).dist < 1 || data.buildingAt(x, z, 2) || stream.dist < stream.width * 2) continue;
        const tree = this.template.clone(true);
        tree.position.set(x, data.heightAt(x, z), z); tree.rotation.y = hash2(cx, cz, 604) * Math.PI * 2;
        tree.scale.setScalar(0.8 + hash2(cx, cz, 605) * 0.4);
        this.group.add(tree);
        const mixer = new THREE.AnimationMixer(tree);
        mixer.clipAction(this.clip).play(); mixer.setTime(hash2(cx, cz, 606) * this.clip.duration);
        this.mixers.push(mixer);
      }
    }
    if (!reducedMotion) for (const mixer of this.mixers) mixer.update(dt);
  }

  get stats() { return { ready: this.ready, instances: this.mixers.length, clip: this.clip?.name ?? null, duration: this.clip?.duration ?? 0, animationTime: this.mixers[0]?.time ?? 0 }; }
  private release() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.template?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const v of Object.values(material)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
    this.template = null;
  }
  dispose() {
    this.disposed = true;
    for (const mixer of this.mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    this.group.clear(); this.mixers = []; this.release();
  }
}
