// Streams near the walker: ribbons of moving water laid in the carved beds of the DEM-derived stream lines
// (approximate positions; Nimba is a "water tower" with about fifty springs – content.json, cavally).
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { bedDepth, type WalkData } from './data';
import { shared, FOG_TAU_GLSL } from './env';

export class Water {
  readonly mesh: THREE.Mesh;
  private last = new THREE.Vector3(1e9, 0, 1e9);

  constructor(private data: WalkData, sky: THREE.Color) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...shared, uSky: { value: sky } },
      vertexShader: /* glsl */ `
        attribute float aFlow; varying vec2 vUv; varying vec3 vW; varying vec3 vWalkView; varying float vFlow;
        void main() { vUv = uv; vFlow = aFlow; vW = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vWalkView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime; uniform vec3 uSky; uniform vec3 uSunView; uniform vec3 uSunColor; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uHaze;
        ${FOG_TAU_GLSL}
        varying vec2 vUv; varying vec3 vW; varying vec3 vWalkView; varying float vFlow;
        void main() {
          float lake = step(vFlow, 0.05); // still water (lakes, flooded pits) vs stream ribbons
          vec2 q = mix(vec2(vUv.x * 2.0, vUv.y - uTime * 0.9 * vFlow), vUv + vec2(uTime * 0.015, uTime * 0.01), lake);
          float n1 = vnoise(q * vec2(3.0, 1.6), 3), n2 = vnoise(q * vec2(7.0, 4.0) + 3.1, 4);
          vec3 nV = normalize(vec3((n1 * 0.25 + n2 * 0.12) * (1.0 - lake * 0.75), 1.0, (n2 * 0.2 - n1 * 0.1) * (1.0 - lake * 0.75)));
          vec3 V = normalize(-vWalkView);
          vec3 Nv = normalize((viewMatrix * vec4(nV, 0.0)).xyz);
          float fres = pow(1.0 - max(dot(Nv, V), 0.0), 3.0);
          vec3 deep = vec3(0.035, 0.05, 0.03);
          // reflections of the forest more than the sky: streams run under the canopy
          // (open lakes mirror the sky)
          vec3 refl = mix(uSky * 0.75, vec3(0.08, 0.13, 0.06), 0.55 - lake * 0.4);
          vec3 col = mix(deep, refl, 0.15 + fres * 0.6);
          vec3 R = reflect(-V, Nv);
          col += uSunColor * pow(max(dot(R, uSunView), 0.0), 120.0) * 2.0;
          // white water where the bed is steep
          col = mix(col, vec3(0.7), smoothstep(0.7, 0.98, n2 * 0.5 + 0.5) * clamp(vFlow - 1.0, 0.0, 1.0) * 0.35);
          float edge = mix(smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x), 1.0, lake);
          float d = length(vWalkView);
          col = mix(col, uFogColor, 1.0 - exp(-walkTau(d, uFogDensity, uHaze)));
          gl_FragColor = vec4(col, mix(0.42 + fres * 0.4, 0.86 + fres * 0.14, lake) * edge);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  update(eye: THREE.Vector3, radius = 420, force = false): boolean {
    if (!force && this.last.distanceTo(eye) < 120) return false;
    this.last.copy(eye);
    const pos: number[] = [], uv: number[] = [], flow: number[] = [], idx: number[] = [];
    const ribbon = (p: ArrayLike<number>, w: number) => {
      const half = w * 1.2;
      const depth = bedDepth(w);
      let len = 0;
      let started = false;
      let prevY = Infinity;
      const pts: [number, number][] = [];
      // resample every ~2 m
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 2));
        for (let q = 0; q < n; q++) pts.push([ax + (bx - ax) * q / n, az + (bz - az) * q / n]);
      }
      pts.push([p[p.length - 2], p[p.length - 1]]);
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        if (Math.hypot(x - eye.x, z - eye.z) > radius) { started = false; continue; }
        const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)], [px, pz] = pts[Math.max(0, i - 1)];
        let dx = nx - px, dz = nz - pz;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        if (i > 0) len += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
        // water level: smooth DEM bed + a quarter of the bed depth; never flows uphill
        let y = this.data.baseHeight(x, z) - depth * 0.78;
        y = Math.min(y, prevY + 0.05);
        const slope = Number.isFinite(prevY) ? Math.max(0, prevY - y) / 2 : 0;
        prevY = y;
        const b = pos.length / 3;
        pos.push(x - dz * half, y, z + dx * half, x + dz * half, y, z - dx * half);
        uv.push(0, len / (half * 2), 1, len / (half * 2));
        const f = 0.4 + Math.min(1.6, slope * 8);
        flow.push(f, f);
        if (started) idx.push(b - 2, b, b - 1, b - 1, b, b + 1);
        started = true;
      }
    };
    // DEM-derived streams (approximate) …
    for (const s of this.data.streamsNear(eye.x, eye.z, radius)) ribbon(s.p, 0.6 + Math.min(1, Math.sqrt(s.a) / 4) * 3.4);
    // … and the rivers and streams mapped in OpenStreetMap (real courses and widths)
    for (const rv of this.data.riversNear(eye.x, eye.z, radius)) ribbon(rv.p, Math.max(0.6, Math.min(4, rv.w / 2)));
    // Lakes, reservoirs and flooded pits (OSM): flat still water at the surface the DEM measured inside the outline
    for (const lk of this.data.lakesNear(eye.x, eye.z, radius + 400)) {
      const contour: THREE.Vector2[] = [];
      for (let k = 0; k < lk.p.length; k += 2) contour.push(new THREE.Vector2(lk.p[k], lk.p[k + 1]));
      if (contour.length > 3 && contour[0].distanceTo(contour[contour.length - 1]) < 0.01) contour.pop();
      if (contour.length < 3) continue;
      const level = this.lakeLevel(lk.p);
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const b = pos.length / 3;
      for (const v of contour) { pos.push(v.x, level, v.y); uv.push(v.x / 12, v.y / 12); flow.push(0.04); }
      for (const t of tris) idx.push(b + t[0], b + t[2], b + t[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    return true;
  }

  /** Water level of a lake outline: the DEM over water is the water surface, so take the lower quartile of the
   *  heights sampled inside it (robust to shore cells and outliers), less a little so the shore stays dry. */
  private lakeLevel(p: ArrayLike<number>): number {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
    const step = Math.max(4, Math.max(x1 - x0, z1 - z0) / 40);
    const hs: number[] = [];
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inside(p, x, z)) hs.push(this.data.baseHeight(x, z));
    if (!hs.length) { let m = Infinity; for (let k = 0; k < p.length; k += 2) m = Math.min(m, this.data.baseHeight(p[k], p[k + 1])); return m - 0.35; }
    hs.sort((a, b) => a - b);
    return hs[Math.floor((hs.length - 1) * 0.25)] - 0.3;
  }
}

function inside(p: ArrayLike<number>, x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c;
  }
  return c;
}
