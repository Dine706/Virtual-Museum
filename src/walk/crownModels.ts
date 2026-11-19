// Two Blender-authored broadleaf forms stand in for canopy architecture. The survey
// supplies every instance's position, height and crown spread.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toFloat } from './models';
import { walkMaterial } from './env';

export type CrownPart = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial };
export async function loadCrown(base: string, id: string): Promise<CrownPart[]> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.loadAsync(base + 'walk/models/crown_' + id + '.glb');
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene, true);
  const height = bounds.max.y - bounds.min.y;
  const center = bounds.getCenter(new THREE.Vector3());
  const parts: CrownPart[] = [];
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry as THREE.BufferGeometry;
    toFloat(geometry);
    geometry.applyMatrix4(node.matrixWorld);
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.scale(1 / height, 1 / height, 1 / height);
    const material = node.material as THREE.MeshStandardMaterial;
    const leafy = material.name.includes('leaves');
    material.transparent = false;
    material.alphaTest = leafy ? 0.42 : 0;
    material.depthWrite = true;
    material.roughness = leafy ? 0.8 : 0.96;
    material.side = leafy ? THREE.DoubleSide : THREE.FrontSide;
    walkMaterial(material, leafy ? 'leaf' : 'none');
    parts.push({ geometry, material });
  });
  return parts;
}
