// The gallery's architecture and fittings: floor, walls, ceiling with a daylight slot, the window wall onto the
// summit view, the plinth and bench, spotlight tracks, the doorway to the next gallery. Flat surfaces are
// declared as lightmap planes first (bake.ts fills their lightmaps), then built as meshes that sample them.
import * as THREE from 'three';
import { boxPlanes, plane, setAtlasUv1, type Plane } from './bake';
import { BENCH_BOX, DOOR, HX, HZ, PLINTH_BOX, ROOM, SKYLIGHT, TRACK_X, WINDOW, type Spot } from './layout';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const nX = X.clone().negate(), nZ = Z.clone().negate();

/** All lightmapped planes of the gallery, by name. */
export function galleryPlanes(): Map<string, Plane> {
  const list: Plane[] = [
    plane('floor', new THREE.Vector3(-HX, 0, HZ), X, nZ, ROOM.W, ROOM.L),
    plane('ceiling', new THREE.Vector3(-HX, ROOM.H, -HZ), X, Z, ROOM.W, ROOM.L),
    plane('west', new THREE.Vector3(-HX, 0, HZ), nZ, Y, ROOM.L, ROOM.H),
    plane('east', new THREE.Vector3(HX, 0, -HZ), Z, Y, ROOM.L, ROOM.H),
    plane('north', new THREE.Vector3(-HX, 0, -HZ), X, Y, ROOM.W, ROOM.H),
    plane('south', new THREE.Vector3(HX, 0, HZ), nX, Y, ROOM.W, ROOM.H),
    ...boxPlanes('plinth', PLINTH_BOX),
    ...boxPlanes('bench', BENCH_BOX),
  ];
  return new Map(list.map((p) => [p.name, p]));
}

export interface RoomTextures {
  floor: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture };
  plaster: { map: THREE.Texture; normal: THREE.Texture };
  oak: { map: THREE.Texture; normal: THREE.Texture };
}

/** Materials that read the baked atlas and ignore the environment map for diffuse light (the bake has it). */
export function lightmapped(params: THREE.MeshStandardMaterialParameters, atlas: THREE.Texture, intensity: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ ...params, lightMap: atlas, lightMapIntensity: intensity });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''));
  };
  m.customProgramCacheKey = () => 'lightmapped';
  return m;
}

/** A rectangle (s0..s1, t0..t1 in plane coordinates) of a plane as a mesh with world-metre uv and atlas uv1. */
export function planeRegion(p: Plane, s0: number, t0: number, s1: number, t1: number, tile: number, mat: THREE.Material): THREE.Mesh {
  const corner = (s: number, t: number) => p.origin.clone().addScaledVector(p.u, s * p.w).addScaledVector(p.v, t * p.h);
  const a = corner(s0, t0), b = corner(s1, t0), c = corner(s1, t1), d = corner(s0, t1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()], 3));
  const n = new THREE.Vector3().crossVectors(p.u, p.v).normalize();
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...n.toArray(), ...n.toArray(), ...n.toArray(), ...n.toArray()], 3));
  const uw = p.w / tile, vh = p.h / tile;
  g.setAttribute('uv', new THREE.Float32BufferAttribute([s0 * uw, t0 * vh, s1 * uw, t0 * vh, s1 * uw, t1 * vh, s0 * uw, t1 * vh], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  setAtlasUv1(g, p);
  return new THREE.Mesh(g, mat);
}

export interface RoomBuild {
  group: THREE.Group;
  floor: THREE.Mesh;
  /** materials that should receive the captured environment map */
  envMaterials: THREE.MeshStandardMaterial[];
}

export function buildRoom(planes: Map<string, Plane>, atlas: THREE.Texture, lmScale: number, tex: RoomTextures, spots: Spot[], skyRadiance: THREE.Color): RoomBuild {
  const group = new THREE.Group();
  const P = (n: string) => planes.get(n)!;
  const env: THREE.MeshStandardMaterial[] = [];

  const wallMat = lightmapped({ color: 0xf3f1ec, map: tex.plaster.map, normalMap: tex.plaster.normal, normalScale: new THREE.Vector2(0.1, 0.1), roughness: 0.95 }, atlas, lmScale);
  const floorMat = lightmapped({ map: tex.floor.map, normalMap: tex.floor.normal, roughnessMap: tex.floor.rough, roughness: 0.85, envMapIntensity: 0.9 }, atlas, lmScale);
  const ceilMat = lightmapped({ color: 0xf1f0ec, roughness: 1 }, atlas, lmScale);
  const plinthMat = lightmapped({ color: 0xefeeea, roughness: 0.55, envMapIntensity: 0.5 }, atlas, lmScale);
  const benchMat = lightmapped({ map: tex.oak.map, normalMap: tex.oak.normal, roughness: 0.6, envMapIntensity: 0.5 }, atlas, lmScale);
  env.push(wallMat, floorMat, plinthMat, benchMat);

  // Floor (laminate tile 1.7 m) and ceiling.
  const floor = planeRegion(P('floor'), 0, 0, 1, 1, 1.7, floorMat);
  floor.name = 'floor';
  group.add(floor, planeRegion(P('ceiling'), 0, 0, 1, 1, 1, ceilMat));

  // Side walls (plaster tile 1 m).
  group.add(planeRegion(P('west'), 0, 0, 1, 1, 1, wallMat), planeRegion(P('east'), 0, 0, 1, 1, 1, wallMat));
  // North wall around the window opening.
  const n = P('north');
  const ws0 = (WINDOW.x0 + HX) / ROOM.W, ws1 = (WINDOW.x1 + HX) / ROOM.W, wt1 = WINDOW.y1 / ROOM.H;
  group.add(planeRegion(n, 0, 0, ws0, 1, 1, wallMat), planeRegion(n, ws1, 0, 1, 1, 1, wallMat), planeRegion(n, ws0, wt1, ws1, 1, 1, wallMat));
  // South wall around the doorway (plane runs from x = +HX to −HX).
  const s = P('south');
  const ds0 = (HX - DOOR.x1) / ROOM.W, ds1 = (HX - DOOR.x0) / ROOM.W, dt1 = DOOR.h / ROOM.H;
  group.add(planeRegion(s, 0, 0, ds0, 1, 1, wallMat), planeRegion(s, ds1, 0, 1, 1, 1, wallMat), planeRegion(s, ds0, dt1, ds1, 1, 1, wallMat));

  // Plinth and bench.
  for (const name of ['+x', '-x', '+z', '-z', '+y']) {
    group.add(planeRegion(P(`plinth${name}`), 0, 0, 1, 1, 1, plinthMat));
    group.add(planeRegion(P(`bench${name}`), 0, 0, 1, 1, 0.5, benchMat));
  }

  // Shadow gap: a dark recessed line where the walls meet the floor (modern gallery detail).
  const gapMat = new THREE.MeshBasicMaterial({ color: 0x1b1a17 });
  const gap = (len: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.018), gapMat);
    m.position.set(x, 0.009, z);
    m.rotation.y = ry;
    return m;
  };
  group.add(gap(ROOM.L, -HX + 0.002, 0, Math.PI / 2), gap(ROOM.L, HX - 0.002, 0, -Math.PI / 2));
  group.add(gap(WINDOW.x0 + HX, (-HX + WINDOW.x0) / 2, -HZ + 0.002, 0), gap(HX - WINDOW.x1, (HX + WINDOW.x1) / 2, -HZ + 0.002, 0));
  group.add(gap(HX + DOOR.x0, (-HX + DOOR.x0) / 2, HZ - 0.002, Math.PI), gap(HX - DOOR.x1, (HX + DOOR.x1) / 2, HZ - 0.002, Math.PI));

  // Ceiling daylight slot: a recessed luminous panel (its radiance is the bake's light source).
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(SKYLIGHT.x1 - SKYLIGHT.x0, SKYLIGHT.z1 - SKYLIGHT.z0),
    new THREE.MeshBasicMaterial({ color: skyRadiance.clone().multiplyScalar(0.62) }));
  slot.rotation.x = Math.PI / 2;
  slot.position.set((SKYLIGHT.x0 + SKYLIGHT.x1) / 2, ROOM.H - 0.004, (SKYLIGHT.z0 + SKYLIGHT.z1) / 2);
  group.add(slot);
  // Slot reveal (the shallow light well's sides read as a thin darker frame).
  const reveal = new THREE.MeshBasicMaterial({ color: 0xc9c7c1, side: THREE.DoubleSide });
  for (const sx of [SKYLIGHT.x0, SKYLIGHT.x1]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(SKYLIGHT.z1 - SKYLIGHT.z0, 0.06), reveal);
    r.rotation.y = Math.PI / 2;
    r.position.set(sx, ROOM.H - 0.03, (SKYLIGHT.z0 + SKYLIGHT.z1) / 2);
    group.add(r);
  }

  // Window: bronze mullions, head and threshold.
  const bronze = new THREE.MeshStandardMaterial({ color: 0x2b2620, metalness: 0.6, roughness: 0.45 });
  env.push(bronze);
  const wx = [WINDOW.x0, -1.55, 1.55, WINDOW.x1];
  for (const x of wx) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, WINDOW.y1, 0.14), bronze);
    m.position.set(x, WINDOW.y1 / 2, -HZ + 0.02);
    group.add(m);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(WINDOW.x1 - WINDOW.x0 + 0.09, 0.1, 0.14), bronze);
  head.position.set(0, WINDOW.y1 - 0.05, -HZ + 0.02);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WINDOW.x1 - WINDOW.x0 + 0.09, 0.03, 0.16), bronze);
  sill.position.set(0, 0.015, -HZ + 0.02);
  group.add(head, sill);
  // Faint glass reflection.
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.05, depthWrite: false, envMapIntensity: 1 });
  env.push(glass);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.x1 - WINDOW.x0, WINDOW.y1), glass);
  pane.position.set(0, WINDOW.y1 / 2, -HZ - 0.01);
  pane.renderOrder = 2;
  group.add(pane);

  // Doorway to the next gallery: a short dim passage.
  const dark = new THREE.MeshBasicMaterial({ color: 0x24251f, side: THREE.DoubleSide });
  const darker = new THREE.MeshBasicMaterial({ color: 0x151612 });
  const dw = DOOR.x1 - DOOR.x0, dcx = (DOOR.x0 + DOOR.x1) / 2;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(dw, DOOR.h), darker);
  back.position.set(dcx, DOOR.h / 2, HZ + DOOR.depth);
  back.rotation.y = Math.PI;
  const dfloor = new THREE.Mesh(new THREE.PlaneGeometry(dw, DOOR.depth), dark);
  dfloor.rotation.x = -Math.PI / 2;
  dfloor.position.set(dcx, 0.001, HZ + DOOR.depth / 2);
  const dceil = dfloor.clone();
  dceil.position.y = DOOR.h;
  group.add(back, dfloor, dceil);
  for (const x of [DOOR.x0, DOOR.x1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.depth, DOOR.h), dark);
    side.rotation.y = Math.PI / 2;
    side.position.set(x, DOOR.h / 2, HZ + DOOR.depth / 2);
    group.add(side);
  }

  // Spotlight tracks and fixtures (each fixture aims at its target; the lens glows softly).
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1d1b, metalness: 0.4, roughness: 0.5 });
  env.push(black);
  for (const x of [-TRACK_X, TRACK_X]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, ROOM.L - 2), black);
    rail.position.set(x, ROOM.H - 0.02, 0);
    group.add(rail);
  }
  const can = new THREE.CylinderGeometry(0.055, 0.045, 0.2, 16);
  can.rotateX(Math.PI / 2); // axis along z
  const lensGeo = new THREE.CircleGeometry(0.04, 16);
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.75).multiplyScalar(3) });
  const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
  for (const sp of spots) {
    const f = new THREE.Group();
    f.position.copy(sp.pos);
    // Fixtures on the side tracks hang from the rail; the two over the relief hang from the ceiling on rods.
    const rod = ROOM.H - sp.pos.y;
    const stem = new THREE.Mesh(stemGeo, black);
    stem.scale.y = rod / 0.16;
    stem.position.y = rod / 2;
    const body = new THREE.Group();
    body.quaternion.setFromUnitVectors(Z, new THREE.Vector3().subVectors(sp.target, sp.pos).normalize()); // local +z → target
    const c = new THREE.Mesh(can, black);
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.z = 0.101;
    body.add(c, lens);
    f.add(stem, body);
    group.add(f);
  }

  return { group, floor, envMaterials: env };
}

/** The summit panorama outside the window (equirectangular, same mapping as the bake). */
export function panoSphere(tex: THREE.Texture, gain: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPano: { value: tex }, uGain: { value: gain } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uPano;
      uniform float uGain;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float u = 0.5 + atan(d.x, -d.z) / 6.28318531;
        float v = 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159265;
        gl_FragColor = vec4(texture2D(uPano, vec2(u, v)).rgb * uGain, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), mat);
  m.position.set(0, 1.6, 0);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}
