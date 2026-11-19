// Terrain shader: land-cover base colour + slope rock + altitude tints + procedural detail (hides the 30 m DEM),
// per-pixel normals from a half-float height texture, soft self-shadows ray-marched towards the sun,
// hemisphere + sun lighting, height fog, "sea of clouds" mist below a level, and an edge fade into the haze.
import * as THREE from 'three';
import type { Heightfield } from './heightfield';
import type { Atmosphere } from './atmosphere';
import { ATMO_UNIFORMS, NOISE, SKY_FN } from './glsl';
import { LANDSCAPE_GLSL, landscapeUniforms } from './landscape';

export function heightTexture(hf: Heightfield): THREE.DataTexture {
  const n = hf.size;
  const data = new Uint16Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(hf.heights[i]);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.internalFormat = 'R16F';
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
precision highp float;
${ATMO_UNIFORMS}
uniform sampler2D uHeight;
uniform sampler2D uLand;
uniform vec2 uTexel;
uniform vec3 uRock;
uniform vec3 uTint;        // mode tint (M6)
uniform float uTintAmount;
uniform float uDetail;
uniform float uHabitat;     // Nature mode: indicative elevation bands (DESIGN.md §7)
uniform float uModeSat;     // Conservation mode: slightly muted terrain so overlays read
varying vec3 vWorld;
${NOISE}
${SKY_FN}
${LANDSCAPE_GLSL}

float H(vec2 uv) { return texture2D(uHeight, uv).r; }

float terrainShadow(vec3 p) {
#if SHADOW_STEPS > 0
  float res = 1.0;
  for (int i = 1; i <= SHADOW_STEPS; i++) {
    float t = 25.0 * pow(480.0, float(i) / float(SHADOW_STEPS)); // 25 m … 12 km, denser near the surface
    vec3 q = p + uSunDir * t;
    vec2 quv = worldUV(q.xz);
    if (quv.x < 0.0 || quv.y < 0.0 || quv.x > 1.0 || quv.y > 1.0) break;
    float d = q.y - H(quv) * uExag;
    res = min(res, clamp(6.0 * d / t + 0.5, 0.0, 1.0));
    if (res <= 0.0) break;
  }
  return res * res * (3.0 - 2.0 * res);
#else
  return 1.0;
#endif
}

void main() {
  vec2 uv = worldUV(vWorld.xz);
  float elev = vWorld.y / uExag; // true metres

  // Per-pixel normal from the height texture (finer than the mesh on mid/low tiers).
  vec2 tx = uTexel;
  float hL = H(uv - vec2(tx.x, 0.0)), hR = H(uv + vec2(tx.x, 0.0));
  float hU = H(uv - vec2(0.0, tx.y)), hD = H(uv + vec2(0.0, tx.y));
  float sx = 2.0 * uWorld.z * tx.x, sz = 2.0 * uWorld.w * tx.y;
  vec3 n = normalize(vec3((hL - hR) * uExag / sx, 1.0, (hU - hD) * uExag / sz));
  float trueSlope = 1.0 - normalize(vec3((hL - hR) / sx, 1.0, (hU - hD) / sz)).y;

  // Base colour from land cover (alpha = canopy closure).
  vec4 land = texture2D(uLand, uv);
  vec3 base = land.rgb;
  float canopy = land.a;

  // Procedural detail at three scales (world metres).
  vec2 w = vWorld.xz;
  // Fade fine detail with distance so it never aliases into a stipple pattern.
  float camDist = length(vWorld - cameraPosition);
  float detail = uDetail * (1.0 - smoothstep(5000.0, 16000.0, camDist));
  float macro = fbm3(w / 2600.0);
  float meso = fbm3(w / 420.0 + 3.1);
  float micro = vnoise(w / 46.0) * 0.6 + vnoise(w / 19.0) * 0.4;

  // Altitude: lowland forest is warmer; montane/cloud forest (1,000–1,400 m) darker & bluer;
  // above ≈ 1,400 m the grassland turns golden-olive (DESIGN.md §7 bands).
  float montane = smoothstep(950.0, 1250.0, elev) * canopy;
  base = mix(base, base * vec3(0.82, 0.92, 0.95), montane);
  float highGrass = smoothstep(1300.0, 1520.0, elev) * (1.0 - canopy);
  base = mix(base, vec3(0.30, 0.28, 0.12), highGrass * 0.55);
  base *= mix(vec3(1.0), vec3(1.06, 1.02, 0.92), (1.0 - canopy) * (1.0 - smoothstep(500.0, 900.0, elev)));

  base *= 0.78 + 0.42 * macro;
  base *= 0.86 + 0.28 * meso;
  base *= mix(1.0, 0.66 + 0.68 * micro, canopy * detail);   // tree-crown clumps
  base *= mix(1.0, 0.93 + 0.14 * micro, (1.0 - canopy) * detail);

  // Steep slopes and ridge crests show rock (≈ > 38° on the true surface).
  float rock = smoothstep(0.17, 0.32, trueSlope + (meso - 0.5) * 0.12) * (1.0 - canopy * 0.65);
  base = mix(base, uRock * (0.8 + 0.4 * micro), clamp(rock, 0.0, 1.0));
  base = landscapeSurface(base, w, canopy, rock);

  // Crown-scale shading survives kilometre-long views, where individual leaf cards are sub-pixel.
  if (uLandscape > 0.5) {
    float cl = dot(landscapeSample(uCanopyMap, w - vec2(2.0, 0.0), 115.0), vec3(0.333));
    float cr = dot(landscapeSample(uCanopyMap, w + vec2(2.0, 0.0), 115.0), vec3(0.333));
    float cu = dot(landscapeSample(uCanopyMap, w - vec2(0.0, 2.0), 115.0), vec3(0.333));
    float cd = dot(landscapeSample(uCanopyMap, w + vec2(0.0, 2.0), 115.0), vec3(0.333));
    n = normalize(n + vec3(cl - cr, 0.0, cu - cd) * canopy * 1.8 * detail);
  }

  // Micro relief: perturb the normal with noise gradients so close views are not glassy.
  float e = 22.0;
  float nx = vnoise((w + vec2(e, 0.0)) / 46.0) - vnoise((w - vec2(e, 0.0)) / 46.0);
  float nz = vnoise((w + vec2(0.0, e)) / 46.0) - vnoise((w - vec2(0.0, e)) / 46.0);
  n = normalize(n + vec3(-nx, 0.0, -nz) * 0.35 * detail);

  // Mode tint (habitat bands / warm culture grade).
  base = mix(base, base * uTint, uTintAmount);
  // Nature: lowland (≲ 1,000 m) greener, montane (≈ 1,000–1,400 m) cooler teal, ridge (≳ 1,400 m) golden.
  if (uHabitat > 0.001) {
    float m1 = smoothstep(950.0, 1050.0, elev), m2 = smoothstep(1350.0, 1450.0, elev);
    vec3 band = mix(mix(vec3(0.88, 1.12, 0.82), vec3(0.80, 1.0, 1.10), m1), vec3(1.22, 1.08, 0.70), m2);
    base = mix(base, base * band, uHabitat);
  }

  // Lighting.
  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = terrainShadow(vWorld + n * 15.0);
  vec3 amb = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  float ao = mix(0.75, 1.0, smoothstep(0.0, 0.6, n.y));          // cheap cavity darkening on steep faces
  // Physical sun intensities require Lambert's 1/pi; otherwise the surface maps wash out.
  vec3 col = base * (amb * ao + uSunColor * ndl * sh * mix(1.0, 0.3183099, uLandscape));
  // Soft forward-scatter rim when the sun is low (golden hour).
  col += base * uSunColor * 0.12 * pow(1.0 - max(dot(n, normalize(cameraPosition - vWorld)), 0.0), 3.0) * (1.0 - uSunDir.y);

  // Sea of clouds / valley mist: path length of the view ray inside the layer below uMistLevel.
  vec3 V = vWorld - cameraPosition;
  vec3 dir = normalize(V);
  float level = uMistLevel + (fbm3(w / 1800.0 + uTime * 0.004) - 0.5) * 120.0 * uExag;
  float below = max(level - vWorld.y, 0.0);
  float path = below / max(abs(dir.y), 0.08);
  float mist = (1.0 - exp(-path * uMistDensity)) * uMistAmount;
  vec3 mistLit = uMistColor * (amb * 0.9 + uSunColor * max(uSunDir.y, 0.15) * 0.55);
  col = mix(col, mistLit, mist);

  col = grade(col);
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uModeSat);
  col = aerial(col, cameraPosition, vWorld);

  // Fade the 31 km square into the horizon haze.
  vec3 haze = skyColor(normalize(vec3(dir.x, 0.0, dir.z)));
  col = mix(haze, col, edgeFade(w, 4500.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createTerrainMaterial(atmo: Atmosphere, hf: Heightfield, landTex: THREE.Texture, shadowSteps: number) {
  const hTex = heightTexture(hf);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmo.uniforms,
      ...landscapeUniforms(),
      uHeight: { value: hTex },
      uLand: { value: landTex },
      uTexel: { value: new THREE.Vector2(1 / hf.size, 1 / hf.size) },
      uRock: { value: new THREE.Color('#6E6252') },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTintAmount: { value: 0 },
      uHabitat: { value: 0 },
      uModeSat: { value: 1 },
      uDetail: { value: 1 },
    },
    defines: { SHADOW_STEPS: shadowSteps },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}
