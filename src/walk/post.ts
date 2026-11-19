// High-quality look for walk mode (high tier, ?fx=1): the scene renders into an HDR multisampled target,
// then: ambient occlusion from depth (GTAO: plants sit in the ground, crowns get depth), bloom on the sun and
// bright sky, light shafts through canopy gaps (radial blur of the visible sky toward the sun), and a final
// pass with mild sharpening, colour grading and a vignette before tone mapping.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class PostFX {
  private sceneRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  private raysRT: THREE.WebGLRenderTarget;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private raysQuad: FullScreenQuad;
  private finalQuad: FullScreenQuad;
  private raysMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private w = 1; private h = 1;
  readonly sunScreen = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const mk = (samples = 0, depth = false) => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
      if (depth) { rt.depthTexture = new THREE.DepthTexture(1, 1); rt.depthTexture.type = THREE.UnsignedIntType; }
      return rt;
    };
    this.sceneRT = mk(4, true);
    this.aoRT = mk();
    this.raysRT = mk();
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: this.sceneRT.depthTexture! });
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.5, scale: 1.1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.10, 0.4, 1.6);

    this.raysMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAmt: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth; uniform vec2 uSun; uniform float uAmt; varying vec2 vUv;
        float sky(vec2 uv) {
          // open sky only: nothing in the near pass (depth cleared to 1) and bright
          float d = texture(tDepth, uv).r;
          vec3 c = texture(tColor, uv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          return step(0.99999, d) * smoothstep(0.3, 1.1, l);
        }
        void main() {
          if (uAmt <= 0.001) { gl_FragColor = vec4(0.0); return; }
          vec2 dir = (uSun - vUv) / 56.0;
          vec2 uv = vUv;
          float sum = 0.0, w = 1.0;
          for (int i = 0; i < 56; i++) { sum += sky(uv) * w; w *= 0.965; uv += dir; }
          gl_FragColor = vec4(vec3(sum / 22.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.raysQuad = new FullScreenQuad(this.raysMat);

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tRays: { value: null }, uTexel: { value: new THREE.Vector2() },
        uSunCol: { value: new THREE.Color() }, uRays: { value: 0 }, uSharp: { value: 0.48 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tRays; uniform vec2 uTexel; uniform vec3 uSunCol; uniform float uRays, uSharp;
        varying vec2 vUv;
        void main() {
          vec3 c = texture(tColor, vUv).rgb;
          // contrast-adaptive sharpening (light): crisper bark, leaves and grass without halos
          vec3 n = texture(tColor, vUv + vec2(0.0, uTexel.y)).rgb, s = texture(tColor, vUv - vec2(0.0, uTexel.y)).rgb;
          vec3 e = texture(tColor, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture(tColor, vUv - vec2(uTexel.x, 0.0)).rgb;
          vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
          vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
          vec3 k = -sqrt(amp) * uSharp * 0.2;
          c = max(vec3(0.0), (c + (n + s + e + w) * k) / (1.0 + 4.0 * k));
          // light shafts
          c += uSunCol * texture(tRays, vUv).r * uRays;
          // grade: gentle S-curve in log space, a touch more saturation, warm highlights / cool shadows
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.12);
          // a little more contrast in the mid-tones (filmic toe)
          c *= pow(max(l, 1e-4) / 0.18, 0.12) * 0.98;
          c *= mix(vec3(0.97, 1.0, 1.04), vec3(1.04, 1.0, 0.95), smoothstep(0.05, 0.8, l));
          // vignette
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.42;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
  }

  setSize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.aoRT.setSize(w, h);
    this.raysRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.gtao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.finalMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  /** Render the two scene passes into the HDR target, then post-process to the screen. */
  render(drawScene: () => void, sunDir: THREE.Vector3, sunCol: THREE.Color, raysStrength: number) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
    r.setRenderTarget(this.sceneRT);
    drawScene();
    // AO (reads sceneRT colour + depth, writes aoRT)
    this.gtao.render(r, this.aoRT, this.sceneRT, 0, false);
    // bloom in place on aoRT
    this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, this.aoRT, 0, false);
    // sun position on screen; rays fade when the sun is behind or far off screen
    this.sunScreen.copy(this.camera.position).addScaledVector(sunDir, 5000).project(this.camera);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).dot(sunDir);
    const onScreen = Math.max(0, 1 - Math.max(Math.abs(this.sunScreen.x), Math.abs(this.sunScreen.y)) / 1.6);
    const amt = Math.max(0, facing) * onScreen * raysStrength;
    this.raysMat.uniforms.tColor.value = this.sceneRT.texture;
    this.raysMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
    this.raysMat.uniforms.uSun.value.set(this.sunScreen.x * 0.5 + 0.5, this.sunScreen.y * 0.5 + 0.5);
    this.raysMat.uniforms.uAmt.value = amt;
    r.setRenderTarget(this.raysRT);
    this.raysQuad.render(r);
    this.finalMat.uniforms.tColor.value = this.aoRT.texture;
    this.finalMat.uniforms.tRays.value = this.raysRT.texture;
    this.finalMat.uniforms.uSunCol.value.copy(sunCol);
    this.finalMat.uniforms.uRays.value = amt * 1.3;
    r.setRenderTarget(null);
    this.finalQuad.render(r);
  }

  dispose() {
    this.sceneRT.dispose(); this.aoRT.dispose(); this.raysRT.dispose();
    this.gtao.dispose(); this.bloom.dispose();
    this.raysQuad.dispose(); this.finalQuad.dispose();
    this.raysMat.dispose(); this.finalMat.dispose();
  }
}
