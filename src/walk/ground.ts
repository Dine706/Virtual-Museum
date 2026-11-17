// Ground around the walker: one grid, dense at the centre (≈ 0.5 m) and coarse at the rim (≈ 25 m), that
// follows the walker. The vertex shader evaluates the same height function as WalkData.heightAt (DEM +
// micro-relief − stream beds); beyond the tree range it rises to the measured canopy height so distant
// forest reads as forest. The fragment shader blends leaf litter, laterite, turf, rock and moss from the
// measured land cover, canopy, slope, altitude and stream proximity.
// Far away (beyond ~1.4 km), the whole massif (Copernicus DSM, true scale) and a cloud layer fill the view.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { DATA_GLSL, type WalkData } from './data';
import { walkMaterial, shared } from './env';
import { drawnLayers } from './textures';
import { photoLayers, type PhotoSet } from './photo';
import { TERRAIN_FRAG_GLSL, TERRAIN_MAP_GLSL, TERRAIN_NORMAL_GLSL } from './terrainShader';
import type { Heightfield } from '../scene/heightfield';
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';

export interface GroundOpts { segments: number; radius: number; shellStart: number; shellEnd: number; shadows: boolean }

/** Non-uniform grid: fine in the middle, coarse at the edge. */
function patchGeometry(n: number, R: number): THREE.BufferGeometry {
  const a = 0.055;
  const map = (u: number) => R * (a * u + (1 - a) * u * u * u);
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = (j * (n + 1) + i) * 3;
    pos[k] = map(i / n * 2 - 1); pos[k + 1] = 0; pos[k + 2] = map(j / n * 2 - 1);
  }
  const idx = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a0 = j * (n + 1) + i, b = a0 + 1, c = a0 + n + 1, d = c + 1;
    // alternate the diagonal so the mesh has no directional bias
    if ((i + j) % 2) { idx[o++] = a0; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    else { idx[o++] = a0; idx[o++] = c; idx[o++] = d; idx[o++] = a0; idx[o++] = d; idx[o++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
  return g;
}

const SURF_GLSL = /* glsl */ `
uniform vec3 uCam;
uniform vec2 uShell;
float shellAt(vec2 p) {
  float k = smoothstep(uShell.x, uShell.y, length(p - uCam.xz));
  if (k <= 0.0) return 0.0;
  float c = attrAt(p).r * 255.0;
  // lumpy crowns rather than a flat sheet
  return k * c * (0.85 + 0.25 * vnoise(p / 9.0, 61));
}
float surf(vec2 p) { return groundHeight(p) + shellAt(p); }
`;

export class Ground {
  readonly mesh: THREE.Mesh;
  readonly far = new THREE.Group();
  readonly cloudNear: THREE.Mesh;
  readonly cloudFar: THREE.Mesh;
  readonly cloudUniforms = { uCloudH: { value: 1250 }, uCloudAmt: { value: 0 }, uHole: { value: 1300 }, uInner: { value: 1 } };
  private uCam = { value: new THREE.Vector3() };
  private uShell: { value: THREE.Vector2 };
  private snap: number;
  private texU: { uDiff: { value: THREE.DataArrayTexture }; uNorm: { value: THREE.DataArrayTexture } };
  private soilTint = { value: new THREE.Vector3(1, 1, 1) };

  constructor(data: WalkData, hf: Heightfield, lcTex: THREE.Texture, private opts: GroundOpts, sunDir: THREE.Vector3, sky: { hemiSky: THREE.Color; hemiGround: THREE.Color; sun: THREE.Color }) {
    const layers = drawnLayers(opts.segments >= 300 ? 512 : 256);
    this.uShell = { value: new THREE.Vector2(opts.shellStart, opts.shellEnd) };
    this.texU = { uDiff: { value: layers.diff }, uNorm: { value: layers.nor } };
    this.snap = 2 * opts.radius * 0.055 / opts.segments * 2; // a couple of centre cells
    const mat = walkMaterial(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), 'none', (s) => {
      Object.assign(s.uniforms, data.uniforms, { uCam: this.uCam, uShell: this.uShell, uSoilTint: this.soilTint }, this.texU);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${DATA_GLSL}\n${SURF_GLSL}\nvarying vec3 vWP; varying vec3 vNW; varying float vShell;`)
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          vec2 gp = (modelMatrix * vec4(position, 1.0)).xz;
          float dc = length(gp - uCam.xz);
          float gh = surf(gp);
          float e = 0.35 + dc * 0.006;
          vec3 objectNormal = normalize(vec3(gh - surf(gp + vec2(e, 0.0)), e, gh - surf(gp + vec2(0.0, e))));
          vNW = objectNormal;
          vShell = smoothstep(uShell.x, uShell.y, dc) * smoothstep(2.0, 8.0, attrAt(gp).r * 255.0);`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.x, gh, position.z);\nvWP = vec3(gp.x, gh, gp.y);`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${DATA_GLSL}\n${TERRAIN_FRAG_GLSL}`)
        .replace('#include <map_fragment>', TERRAIN_MAP_GLSL)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL_GLSL);
    });
    this.mesh = new THREE.Mesh(patchGeometry(opts.segments, opts.radius), mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = opts.shadows;
    this.mesh.renderOrder = -1;

    // ---- far backdrop (whole massif, Copernicus DSM at true scale) ----
    const n = 300;
    const fg = new THREE.PlaneGeometry(WORLD_W, WORLD_D, n, n);
    fg.rotateX(-Math.PI / 2);
    fg.translate(WORLD.minX + WORLD_W / 2, 0, WORLD.minZ + WORLD_D / 2);
    const fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setY(i, hf.heightAt(fp.getX(i), fp.getZ(i)));
    fg.computeVertexNormals();
    const farU = {
      ...shared, uLc: { value: lcTex }, uHole: this.cloudUniforms.uHole, uCam: this.uCam,
      uSunDir: { value: sunDir }, uSunC: { value: sky.sun }, uSkyC: { value: sky.hemiSky }, uGrC: { value: sky.hemiGround },
      uWorld: { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, WORLD_W, WORLD_D) },
    };
    const farMat = new THREE.ShaderMaterial({
      uniforms: farU,
      vertexShader: /* glsl */ `
        varying vec3 vWalkView; varying vec3 vN; varying vec3 vW;
        void main() { vW = position; vN = normal; vec4 mv = modelViewMatrix * vec4(position, 1.0); vWalkView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform sampler2D uLc; uniform float uHole; uniform vec3 uCam; uniform vec4 uWorld;
        uniform vec3 uSunDir, uSunC, uSkyC, uGrC;
        uniform vec3 uFogColor; uniform float uFogDensity; uniform float uHaze; uniform vec3 uSunView; uniform vec3 uSunColor;
        varying vec3 vWalkView; varying vec3 vN; varying vec3 vW;
        void main() {
          float d = length(vW.xz - uCam.xz);
          if (d < uHole - 60.0 * whash(ivec2(gl_FragCoord.xy), 3)) discard;
          vec3 base = texture(uLc, (vW.xz - uWorld.xy) / uWorld.zw).rgb;
          base *= 0.75 + 0.35 * vnoise(vW.xz / 120.0, 5) + 0.15 * vnoise(vW.xz / 25.0, 6);
          vec3 N = normalize(vN);
          vec3 light = uSunC * max(dot(N, uSunDir), 0.0) * 0.9 + mix(uGrC, uSkyC, N.y * 0.5 + 0.5) * 0.6;
          vec3 col = base * light;
          float dist = length(vWalkView);
          vec3 dir = vWalkView / dist;
          float f = 1.0 - exp(-dist * (uFogDensity * 0.12 + uHaze));
          float sunAmt = pow(max(dot(dir, uSunView), 0.0), 6.0);
          col = mix(col, mix(uFogColor, uSunColor * 1.15, sunAmt * 0.55), f);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const farMesh = new THREE.Mesh(fg, farMat);
    farMesh.frustumCulled = false;
    this.far.add(farMesh);

    // ---- cloud layer (sea of clouds), split between the near and far passes ----
    const cloudMat = (inner: boolean) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, ...this.cloudUniforms, uInner: { value: inner ? 1 : 0 }, uCam: this.uCam, uSunDir: { value: sunDir } },
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vWalkView; uniform vec3 uCam; uniform float uCloudH;
        void main() { vec3 p = position; p.xz += uCam.xz; p.y = uCloudH; vW = p; vec4 mv = viewMatrix * vec4(p, 1.0); vWalkView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uCloudAmt, uHole, uInner, uTime, uCloudH; uniform vec3 uCam, uSunDir, uSunColor, uFogColor; uniform float uHaze;
        varying vec3 vW; varying vec3 vWalkView;
        void main() {
          float d = length(vW.xz - uCam.xz);
          if ((uInner > 0.5) != (d < uHole)) discard;
          vec2 p = vW.xz / 900.0 + vec2(uTime * 0.0035, uTime * 0.0012);
          float c = fbm3(p, 17) * 0.5 + 0.5;
          c = smoothstep(1.0 - uCloudAmt * 0.8, 1.05 - uCloudAmt * 0.35, c + vnoise(vW.xz / 160.0, 19) * 0.12);
          float edge = 1.0 - smoothstep(14000.0, 26000.0, d);
          // fade when the walker is close to the cloud deck
          float near = smoothstep(20.0, 160.0, abs(uCam.y - uCloudH));
          vec3 col = mix(vec3(0.86, 0.88, 0.9), uSunColor, 0.35) * (0.92 + 0.12 * c);
          if (uCam.y < uCloudH) col *= 0.82;
          float dist = length(vWalkView);
          col = mix(col, uFogColor, 1.0 - exp(-dist * uHaze * 0.6));
          gl_FragColor = vec4(col, c * edge * near * 0.95);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const cg = new THREE.PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2);
    this.cloudNear = new THREE.Mesh(cg, cloudMat(true));
    this.cloudFar = new THREE.Mesh(cg, cloudMat(false));
    for (const m of [this.cloudNear, this.cloudFar]) { m.frustumCulled = false; m.renderOrder = 10; }
    this.far.add(this.cloudFar);
  }

  /** Follow the walker: snap the grid so vertices do not swim. */
  update(eye: THREE.Vector3) {
    const s = this.snap;
    this.mesh.position.set(Math.round(eye.x / s) * s, 0, Math.round(eye.z / s) * s);
    this.mesh.updateMatrixWorld();
    this.uCam.value.copy(eye);
  }

  /** Swap the drawn ground layers for scanned ones (high-quality look). */
  usePhotos(p: PhotoSet, anisotropy: number) {
    const { diff, nor } = photoLayers(p, anisotropy);
    this.texU.uDiff.value.dispose(); this.texU.uNorm.value.dispose();
    this.texU.uDiff.value = diff; this.texU.uNorm.value = nor;
    this.soilTint.value.set(1.18, 0.82, 0.68); // Nimba's laterite is redder than the scanned soil
  }

  setClouds(height: number, amount: number) {
    this.cloudUniforms.uCloudH.value = height;
    this.cloudUniforms.uCloudAmt.value = amount;
  }

  get radius() { return this.opts.radius; }
}
