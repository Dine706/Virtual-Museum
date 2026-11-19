// A continuous forest silhouette across the massif. One instanced draw, with world-fixed positions,
// camera-facing tree cutouts, distance dithering and the same atmosphere as the terrain underneath.
// Individual distant trees are reconstructed filler placed only in mapped closed-canopy forest.
import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';
import { ATMO_UNIFORMS, SKY_FN } from './glsl';

interface ForestOptions {
  atmosphere: 'orbit' | 'walk';
  uniforms: Record<string, THREE.IUniform>;
  inner: number;
  outer: number;
  spacing?: number;
}
const random = (i: number, j: number, salt: number) => {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + salt * 1447;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

export class LandscapeForest {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly count: number;
  constructor(hf: Heightfield, land: THREE.Texture, tree: THREE.Texture, opts: ForestOptions) {
    const image = land.image as { data: Uint8Array; width: number; height: number };
    const centers: number[] = [], shapes: number[] = [];
    const spacing = opts.spacing ?? 38;
    for (let j = 0; j * spacing < WORLD_D; j++) for (let i = 0; i * spacing < WORLD_W; i++) {
      const x = WORLD.minX + (i + 0.15 + random(i, j, 1) * 0.7) * spacing;
      const z = WORLD.minZ + (j + 0.15 + random(i, j, 2) * 0.7) * spacing;
      const col = Math.min(image.width - 1, Math.floor((x - WORLD.minX) / WORLD_W * image.width));
      const row = Math.min(image.height - 1, Math.floor((z - WORLD.minZ) / WORLD_D * image.height));
      const closure = image.data[(row * image.width + col) * 4 + 3] / 255;
      if (closure < 0.82 || random(i, j, 3) > closure * 0.94) continue;
      const y = hf.heightAt(x, z);
      const montane = THREE.MathUtils.smoothstep(y, 900, 1500);
      const h = (23 + random(i, j, 4) * 16) * (1 - montane * 0.35);
      centers.push(x, y - 1.5, z);
      shapes.push(h * (0.68 + random(i, j, 5) * 0.32), h, random(i, j, 6), random(i, j, 7));
    }
    this.count = centers.length / 3;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.index!.clone());
    g.setAttribute('position', quad.attributes.position.clone());
    g.setAttribute('uv', quad.attributes.uv.clone());
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 4));
    g.instanceCount = this.count;
    quad.dispose();
    const orbit = opts.atmosphere === 'orbit';
    const material = new THREE.ShaderMaterial({
      uniforms: { ...opts.uniforms, uTree: { value: tree }, uInner: { value: opts.inner }, uOuter: { value: opts.outer } },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter; attribute vec4 aShape;
        uniform float uInner, uOuter;
        ${orbit ? 'uniform float uExag;' : ''}
        varying vec2 vUV; varying vec3 vW; varying vec3 vView; varying float vTint;
        void main() {
          vec3 center = aCenter;
          ${orbit ? 'center.y *= uExag;' : ''}
          float d = length(center.xz - cameraPosition.xz);
          // Each tree has a different LOD boundary; there is no moving circular forest edge.
          float start = uInner * (0.90 + 0.10 * aShape.z);
          if (d < start || d > uOuter) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec2 right = normalize(vec2(cameraPosition.z - center.z, center.x - cameraPosition.x) + vec2(0.0001));
          vec3 p = center + vec3(right.x, 0.0, right.y) * position.x * aShape.x;
          p.y += (position.y + 0.5) * aShape.y;
          vW = p; vTint = 0.76 + aShape.w * 0.42;
          vUV = vec2(aShape.z > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
          vec4 mv = viewMatrix * vec4(p, 1.0); vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTree;
        varying vec2 vUV; varying vec3 vW; varying vec3 vView; varying float vTint;
        ${orbit ? `${ATMO_UNIFORMS}\n${SKY_FN}` : `
          uniform vec3 uFogColor, uSunColor, uSunView;
          uniform float uFogDensity, uHaze;
        `}
        void main() {
          vec4 tex = texture2D(uTree, vUV);
          if (tex.a < 0.48) discard;
          vec3 col = tex.rgb * vTint;
          ${orbit ? `
            col *= uAmbientSky * 0.65 + uSunColor * (0.22 + max(uSunDir.y, 0.0) * 0.30);
            col = aerial(grade(col), cameraPosition, vW);
            col = mix(skyColor(normalize(vec3(vW.x - cameraPosition.x, 0.0, vW.z - cameraPosition.z))), col, edgeFade(vW.xz, 4500.0));
          ` : `
            col *= uSunColor * 0.52 + vec3(0.24, 0.30, 0.30);
            float d = length(vView);
            float tau = uFogDensity * 350.0 * (1.0 - exp(-d / 350.0)) + d * uHaze;
            float sun = pow(max(dot(normalize(vView), uSunView), 0.0), 6.0);
            col = mix(col, mix(uFogColor, uSunColor * 1.15, sun * 0.55), 1.0 - exp(-tau));
          `}
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  // The caller owns the shared tree texture; this instance owns only its geometry and material.
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
