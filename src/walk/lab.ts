// Dev-only lab (walk-lab.html, not part of the build): every plant type next to its impostor, and the
// ground-cover types, on a flat lit ground — for checking geometry, textures and lighting quickly.
import * as THREE from 'three';
import { buildPlant, buildCover, PLANT_TYPES, type CoverType } from './plants';
import { WalkEnv, walkMaterial, shared } from './env';
import { leafCluster, LEAVES, bark, frond, mossStrands, grassBlades, groundTextures, bigLeaf } from './textures';
import { depthFor } from './forest';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b8c6c0');
const env = new WalkEnv('morning', 2048);
env.sun.shadow.camera.left = env.sun.shadow.camera.bottom = -80;
env.sun.shadow.camera.right = env.sun.shadow.camera.top = 80;
scene.add(env.hemi, env.sun, env.sun.target);
shared.uFogDensity.value = 0.002;
const g = groundTextures(512);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), walkMaterial(new THREE.MeshStandardMaterial({ map: g.maps[0], normalMap: g.normals[0], roughness: 1 })));
(ground.material as THREE.MeshStandardMaterial).map!.repeat.set(150, 150);
ground.receiveShadow = true;
scene.add(ground);

const mats = {
  leaf: Object.fromEntries(Object.entries(LEAVES).map(([k, v]) => [k, walkMaterial(new THREE.MeshStandardMaterial({ map: leafCluster(v, k.length * 13 + 5), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }), 'leaf')])),
  bark: Object.fromEntries((['brown', 'grey', 'mossy', 'palm', 'fern'] as const).map((k) => { const t = bark(k, k.length * 17 + 3); return [k, walkMaterial(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, vertexColors: true }))]; })),
  frond: Object.fromEntries((['fern', 'oilpalm', 'raphia'] as const).map((k) => [k, walkMaterial(new THREE.MeshStandardMaterial({ map: frond(k, k.length * 23 + 1), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'frond')])),
  moss: walkMaterial(new THREE.MeshStandardMaterial({ map: mossStrands(9), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true })),
};
const H: Record<string, number> = { emergent: 30, canopy: 18, understory: 8, montane: 14, treefern: 5, oilpalm: 12, raphia: 9, protea: 3, savanna: 7, regrowth: 4 };
let x = -PLANT_TYPES.length * 7;
for (const type of PLANT_TYPES) {
  const p = buildPlant(type, Number(q.get('v') ?? 1));
  const grp = new THREE.Group();
  if (p.trunk) grp.add(new THREE.Mesh(p.trunk, mats.bark[p.barkKind]));
  if (p.leaves) grp.add(new THREE.Mesh(p.leaves, mats.leaf[p.leafKind!]));
  if (p.fronds) grp.add(new THREE.Mesh(p.fronds, mats.frond[p.frondKind!]));
  if (p.moss) grp.add(new THREE.Mesh(p.moss, mats.moss));
  grp.traverse((o) => { o.castShadow = true; o.receiveShadow = true; const m = o as THREE.Mesh; if (m.material) { const d = depthFor(m.material as THREE.Material); if (d) m.customDepthMaterial = d; } });
  grp.scale.setScalar(H[type]);
  grp.position.set(x, 0, 0);
  scene.add(grp);
  x += 14;
}
const covers: CoverType[] = ['grassGolden', 'grassGreen', 'grassTall', 'fern', 'herb', 'stick', 'stone'];
const coverMat: Record<CoverType, THREE.Material> = {
  grassGolden: walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('golden', 3), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'grass'),
  grassGreen: walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('green', 4), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'grass'),
  grassTall: walkMaterial(new THREE.MeshStandardMaterial({ map: grassBlades('tall', 5), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'grass'),
  fern: walkMaterial(new THREE.MeshStandardMaterial({ map: frond('fern', 6), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'frond'),
  herb: walkMaterial(new THREE.MeshStandardMaterial({ map: bigLeaf(8), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true }), 'frond'),
  stick: mats.bark.brown,
  stone: walkMaterial(new THREE.MeshStandardMaterial({ map: g.maps[3], normalMap: g.normals[3], vertexColors: true })),
};
covers.forEach((c, i) => {
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(buildCover(c, k + 1), coverMat[c]);
    m.scale.setScalar(c === 'grassTall' ? 1.5 : c === 'stick' ? 2 : 0.8);
    m.position.set(-12 + i * 4 + (k % 2) * 1.2, 0, 12 + Math.floor(k / 2) * 1.2);
    m.castShadow = m.receiveShadow = true;
    const d = depthFor(coverMat[c]); if (d) m.customDepthMaterial = d;
    scene.add(m);
  }
});
const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
const view = q.get('view') ?? 'row';
if (view === 'cover') { cam.position.set(0, 3, 22); cam.lookAt(0, 0.4, 12); }
else { cam.position.set(0, 14, 75); cam.lookAt(0, 9, 0); }
env.update(cam, cam.position, 0.002, new THREE.Color('#c6cec6'), 1);
env.sun.target.position.set(0, 0, 0);
env.sun.position.copy(env.sunDir).multiplyScalar(200);
env.sun.target.updateMatrixWorld();
renderer.render(scene, cam);
document.body.dataset.ready = '1';
