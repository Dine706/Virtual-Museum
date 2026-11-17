// Walk-mode atmosphere: light presets (morning / noon / mist), a sky dome with drifting clouds, and a fog
// with sun scattering that every walk material shares (patched in with walkMaterial()).
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';

export type WalkTime = 'morning' | 'noon' | 'mist';
export const WALK_TIMES: WalkTime[] = ['morning', 'noon', 'mist'];

interface Preset {
  sunAz: number; sunEl: number; sun: number; sunCol: string; sky: string; skyTop: string; ground: string; hemi: number;
  fog: string; fogMul: number; haze: number; exposure: number; cloud: number;
}
const PRESETS: Record<WalkTime, Preset> = {
  morning: { sunAz: 102, sunEl: 24, sun: 3.1, sunCol: '#FFD9A8', sky: '#DCE0DA', skyTop: '#6F95C2', ground: '#4C4128', hemi: 1.05, fog: '#C6CEC6', fogMul: 1.0, haze: 0.000034, exposure: 1.0, cloud: 0.45 },
  noon: { sunAz: 150, sunEl: 62, sun: 3.6, sunCol: '#FFF6E8', sky: '#D6E3EE', skyTop: '#4F82BE', ground: '#4E4A30', hemi: 1.15, fog: '#CDD9DF', fogMul: 0.7, haze: 0.000026, exposure: 0.92, cloud: 0.35 },
  mist: { sunAz: 120, sunEl: 34, sun: 1.25, sunCol: '#F2EEE6', sky: '#D3D7D4', skyTop: '#9BA8B0', ground: '#3F4436', hemi: 1.5, fog: '#C9CEC9', fogMul: 2.4, haze: 0.00011, exposure: 1.06, cloud: 0.9 },
};

/** Uniforms shared by every walk material (fog, wind, time). */
export const shared = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color('#D9CDB8') },
  uFogDensity: { value: 0.004 },
  uHaze: { value: 0.00003 },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color('#FFD9A8') },
  uWind: { value: 1 },
};

const FOG_PARS_VERT = /* glsl */ `varying vec3 vWalkView;`;
const FOG_VERT = /* glsl */ `vWalkView = mvPosition.xyz;`;
const FOG_PARS_FRAG = /* glsl */ `
varying vec3 vWalkView;
uniform vec3 uFogColor; uniform float uFogDensity; uniform float uHaze;
uniform vec3 uSunView; uniform vec3 uSunColor;
vec3 walkFog(vec3 col) {
  float d = length(vWalkView);
  vec3 dir = vWalkView / max(d, 1e-3);
  float f = 1.0 - exp(-d * (uFogDensity + uHaze));
  float sunAmt = pow(max(dot(dir, uSunView), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uSunColor * 1.1, sunAmt * 0.35);
  return mix(col, fc, f);
}`;
const FOG_FRAG = /* glsl */ `gl_FragColor.rgb = walkFog(gl_FragColor.rgb);`;

export type Wind = 'none' | 'leaf' | 'grass' | 'frond';

/** Patch a three.js material: walk fog (+ optional wind sway driven by the vertex height in the model). */
export function walkMaterial<T extends THREE.Material>(mat: T, wind: Wind = 'none', extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void, key = ''): T {
  (mat as unknown as { fog: boolean }).fog = false;
  // three caches programs by onBeforeCompile's source text, which is the same for every walk material:
  // key on what actually differs (wind type, extra patch).
  const src = extra ? extra.toString() : '';
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (Math.imul(h, 31) + src.charCodeAt(i)) | 0;
  mat.customProgramCacheKey = () => `walk:${wind}:${h}:${key}`;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, shared);
    s.vertexShader = s.vertexShader
      .replace('#include <fog_pars_vertex>', `${FOG_PARS_VERT}\nuniform float uTime; uniform float uWind;`)
      .replace('#include <fog_vertex>', FOG_VERT);
    if (wind !== 'none') {
      const amp = wind === 'grass' ? '0.16' : wind === 'frond' ? '0.10' : '0.035';
      s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #else
            vec2 wp = vec2(modelMatrix[3][0], modelMatrix[3][2]);
          #endif
          float ph = wp.x * 0.071 + wp.y * 0.053;
          float h = max(position.y, 0.0);
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.011);
          float k = ${amp} * uWind * gust * h * h;
          transformed.x += k * sin(uTime * 1.7 + ph) + k * 0.3 * sin(uTime * 4.1 + ph * 3.0 + position.z);
          transformed.z += k * 0.8 * cos(uTime * 1.3 + ph * 1.3) + k * 0.3 * sin(uTime * 3.7 + position.x);
        }`);
    }
    if (wind !== 'none') {
      s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
    }
    s.fragmentShader = s.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS_FRAG)
      .replace('#include <fog_fragment>', FOG_FRAG);
    extra?.(s);
  };
  return mat;
}

export class WalkEnv {
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  readonly sky: THREE.Mesh;
  readonly skyUniforms = {
    uSkyTop: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
    uCloud: { value: 0.5 }, uTime: shared.uTime,
  };
  readonly sunDir = new THREE.Vector3();
  time: WalkTime;
  preset: Preset;
  /** Local fog multiplier from the biome (cloud forest ≫ grassland); smoothed. */
  private localFog = -1;
  exposure = 1;

  constructor(time: WalkTime, shadows: number) {
    this.time = time;
    this.preset = PRESETS[time];
    this.sun.castShadow = shadows > 0;
    if (shadows > 0) {
      this.sun.shadow.mapSize.set(shadows, shadows);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -55; c.right = c.top = 55; c.near = 1; c.far = 400;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.06;
      this.sun.shadow.radius = 3;
    }
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunCol; uniform float uCloud, uTime;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 900.0) * 18.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
          // Clouds: fbm on a plane, drifting, fading to the horizon.
          if (d.y > 0.0) {
            vec2 p = d.xz / (d.y + 0.08) * 2.2 + vec2(uTime * 0.004, uTime * 0.0015);
            float c = fbm3(p, 31) * 0.5 + 0.5;
            c = smoothstep(1.0 - uCloud * 0.75, 1.15 - uCloud * 0.5, c) * smoothstep(0.0, 0.25, d.y);
            vec3 cc = mix(vec3(1.0), uSunCol, 0.35) * (0.85 + 0.25 * pow(s, 3.0));
            col = mix(col, cc, c * 0.85);
          }
          col = mix(col, uSkyHorizon * 0.9, smoothstep(0.0, -0.15, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.apply();
  }

  setTime(t: WalkTime) { this.time = t; this.preset = PRESETS[t]; this.apply(); }

  private apply() {
    const p = this.preset;
    const az = THREE.MathUtils.degToRad(p.sunAz), el = THREE.MathUtils.degToRad(p.sunEl);
    // Azimuth clockwise from north; north is −z.
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.set(p.sunCol);
    this.sun.intensity = p.sun;
    this.hemi.color.set(p.sky);
    this.hemi.groundColor.set(p.ground);
    this.hemi.intensity = p.hemi;
    this.skyUniforms.uSkyTop.value.set(p.skyTop);
    this.skyUniforms.uSkyHorizon.value.set(p.sky);
    this.skyUniforms.uSunDir.value.copy(this.sunDir);
    this.skyUniforms.uSunCol.value.set(p.sunCol);
    this.skyUniforms.uCloud.value = p.cloud;
    shared.uSunColor.value.set(p.sunCol);
    shared.uHaze.value = p.haze;
    this.exposure = p.exposure;
  }

  /** Per frame: follow the walker (shadow box), biome fog, view-space sun for scattering. */
  update(camera: THREE.Camera, eye: THREE.Vector3, biomeFog: number, fogTint: THREE.Color, dt: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    if (this.localFog < 0) this.localFog = biomeFog;
    this.localFog += (biomeFog - this.localFog) * k;
    shared.uFogDensity.value = this.localFog * this.preset.fogMul;
    shared.uFogColor.value.set(this.preset.fog).lerp(fogTint, 0.25);
    shared.uSunView.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    // Shadow box centred ahead of the walker, snapped to texels to avoid shimmering.
    const size = this.sun.shadow.mapSize.x || 1024;
    const texel = 110 / size;
    const cx = Math.round(eye.x / texel) * texel, cz = Math.round(eye.z / texel) * texel;
    this.sun.target.position.set(cx, eye.y, cz);
    this.sun.position.set(cx, eye.y, cz).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(camera.position);
  }
}
