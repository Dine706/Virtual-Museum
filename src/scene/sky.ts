// Gradient sky dome with sun disc and glow, plus 1–3 drifting cloud layers.
// Clouds fade out where the terrain rises through them (sampled from the height texture),
// so the summit pokes above the Mist "sea of clouds" without hard intersection lines.
import * as THREE from 'three';
import type { Atmosphere } from './atmosphere';
import { ATMO_UNIFORMS, NOISE, SKY_FN } from './glsl';

export function createSky(atmo: Atmosphere): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmo.uniforms },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      ${ATMO_UNIFORMS}
      varying vec3 vDir;
      ${SKY_FN}
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir);
        float sd = dot(dir, uSunDir);
        col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 2.0;           // sun disc
        col = grade(col);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  // Follow the camera so the dome is always "at infinity".
  sky.onBeforeRender = (_r, _s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  return sky;
}

const cloudFrag = /* glsl */ `
precision highp float;
${ATMO_UNIFORMS}
uniform sampler2D uHeight;
uniform float uLevel;
uniform float uCoverage;
uniform float uOpacity;
uniform float uScale;
uniform float uSeed;
varying vec3 vWorld;
${NOISE}
${SKY_FN}
void main() {
  if (uOpacity <= 0.001 || uCoverage <= 0.001) discard;
  vec2 w = vWorld.xz;
  vec2 drift = vec2(1.0, 0.35) * uTime * 6.0;                 // slow westerly-ish drift (m/s)
  vec2 p = (w + drift) / uScale + uSeed;
  // Stretch fbm (≈ 0.5 ± 0.15) to use the whole 0–1 range so 'coverage' means what it says.
  float d = clamp((fbm5(p) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float d2 = fbm3(p * 3.1 + 4.0);
  float cov = 1.0 - uCoverage;
  float dens = smoothstep(cov - 0.04, cov + 0.22, d * 0.82 + d2 * 0.18);
  if (dens <= 0.002) discard;

  // Fade where the ground reaches the layer, and towards the far haze.
  float ground = texture2D(uHeight, clamp(worldUV(w), 0.0, 1.0)).r * uExag;
  float clearance = vWorld.y - ground;
  dens *= smoothstep(0.0, 160.0 * uExag, clearance);
  float r = length(w - (uWorld.xy + 0.5 * uWorld.zw));
  dens *= 1.0 - smoothstep(16000.0, 30000.0, r);
  // Never let a cloud sit right in front of the lens.
  dens *= smoothstep(2500.0, 7000.0, length(vWorld - cameraPosition));

  // Fake lighting: thick parts are bright on top, thin edges darker/bluer underneath; sun-side rim.
  vec3 shade = vec3(0.6, 0.66, 0.7);
  vec3 top = vec3(1.0);
  float thick = smoothstep(cov, cov + 0.35, d);
  vec3 amb = mix(uAmbientGround, uAmbientSky, 0.85);
  vec3 col = mix(shade, top, thick) * (amb * 1.1 + uSunColor * (0.35 + 0.65 * max(uSunDir.y, 0.0)) * 0.55);
  vec3 V = normalize(vWorld - cameraPosition);
  col += uSkyGlow * pow(max(dot(V, uSunDir), 0.0), 6.0) * (1.0 - thick) * 1.5;
  col = grade(col);
  col = aerial(col, cameraPosition, vWorld);
  gl_FragColor = vec4(col, dens * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Clouds {
  readonly group = new THREE.Group();
  private layers: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];

  constructor(private atmo: Atmosphere, heightTex: THREE.Texture, count: number) {
    const geo = new THREE.PlaneGeometry(64000, 64000, 1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...atmo.uniforms,
          uHeight: { value: heightTex },
          uLevel: { value: 0 }, uCoverage: { value: 0 }, uOpacity: { value: 0 }, uScale: { value: 3000 },
          uSeed: { value: i * 13.7 },
        },
        vertexShader: /* glsl */ `varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: cloudFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 5 + i;
      this.layers.push(m);
      this.group.add(m);
    }
    atmo.subscribe(() => this.sync());
    this.sync();
  }

  sync() {
    const e = this.atmo.uniforms.uExag.value;
    this.layers.forEach((m, i) => {
      const p = this.atmo.state.clouds[i];
      const u = m.material.uniforms;
      u.uLevel.value = p.level * e;
      u.uCoverage.value = p.coverage;
      u.uOpacity.value = p.opacity;
      u.uScale.value = p.scale;
      m.position.y = p.level * e;
      m.visible = p.coverage > 0.01 && p.opacity > 0.01;
    });
  }
}
