// Terrain surface shading for walk mode: 11 ground layers (texture arrays: drawn or scanned CC0) blended from
// measured and mapped data at every point – canopy height and land cover (Meta/WRI, ESA WorldCover), altitude
// belts, slope, streams and lakes (DEM + OpenStreetMap), roads and paths, mines, fields, rock and sand (OSM).
// Steep rock and mine faces are textured triplanar so cliffs do not stretch. Layer order = LAYERS in textures.ts.
import { LAYERS, LAYER_SCALE } from './textures';

const N = LAYERS.length;

export const TERRAIN_FRAG_GLSL = /* glsl */ `
varying vec3 vWP; varying vec3 vNW; varying float vShell;
uniform highp sampler2DArray uDiff;
uniform highp sampler2DArray uNorm;
uniform vec3 uSoilTint;
const float LSCALE[${N}] = float[${N}](${LAYER_SCALE.map((v) => v.toFixed(2)).join(', ')});
float gW[${N}]; float gRough; float gBare; float gWet; float gSteep;
vec2 gDx; vec2 gDy;

// planar sample with a rotated, larger second sample blended by noise (breaks visible tiling)
vec3 layerColor(int L, vec2 p, float k) {
  float s = LSCALE[L];
  vec2 q = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
  vec3 a = textureGrad(uDiff, vec3(p / s, float(L)), gDx / s, gDy / s).rgb;
  vec3 b = textureGrad(uDiff, vec3(q / (s * 2.7), float(L)), gDx / (s * 2.7), gDy / (s * 2.7)).rgb;
  return mix(a, b, k * 0.55);
}
// triplanar (for cliffs / mine faces): blend of the x–z, x–y and z–y projections by the surface normal
vec3 layerTri(int L, vec3 w, vec3 n) {
  float s = LSCALE[L];
  vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 cy = textureGrad(uDiff, vec3(w.xz / s, float(L)), dFdx(w.xz) / s, dFdy(w.xz) / s).rgb;
  vec3 cz = textureGrad(uDiff, vec3(w.xy / s, float(L)), dFdx(w.xy) / s, dFdy(w.xy) / s).rgb;
  vec3 cx = textureGrad(uDiff, vec3(w.zy / s, float(L)), dFdx(w.zy) / s, dFdy(w.zy) / s).rgb;
  return cx * bw.x + cy * bw.y + cz * bw.z;
}
vec3 layerNormal(int L, vec2 p) {
  float s = LSCALE[L];
  return textureGrad(uNorm, vec3(p / s, float(L)), gDx / s, gDy / s).xyz * 2.0 - 1.0;
}
`;

export const TERRAIN_MAP_GLSL = /* glsl */ `
  vec2 P = vWP.xz;
  gDx = dFdx(P); gDy = dFdy(P);
  vec4 at = attrAt(P);
  float canopy = at.r * 255.0, cls = at.g * 255.0, rockM = at.b;
  vec2 st = streamAt(P);
  float sandA, wetA;
  vec4 ar = areaW(P, sandA, wetA);            // x water, y mine, z field, w rock (OpenStreetMap)
  float forest = smoothstep(3.0, 12.0, canopy);
  float grassy = (abs(cls - 30.0) < 1.0 || abs(cls - 20.0) < 1.0) ? 1.0 : 0.0;
  float woody = (abs(cls - 10.0) < 1.0 || abs(cls - 20.0) < 1.0) ? 1.0 : 0.0;
  float built = abs(cls - 50.0) < 1.0 ? 1.0 : 0.0;
  float bare = abs(cls - 60.0) < 1.0 ? 1.0 : 0.0;
  float waterLC = abs(cls - 80.0) < 1.0 ? 1.0 : 0.0;
  float wetLC = abs(cls - 90.0) < 1.0 ? 1.0 : 0.0;
  float crop = abs(cls - 40.0) < 1.0 ? 1.0 : 0.0;
  float slope = 1.0 - clamp(vNW.y, 0.0, 1.0);
  gSteep = smoothstep(0.3, 0.55, slope);
  float n1 = vnoise(P / 3.1, 81), n2 = vnoise(P / 17.0, 82);
  float high = smoothstep(1150.0, 1350.0, vWP.y);
  float cloudBelt = smoothstep(850.0, 1050.0, vWP.y);
  float bed = bedK(st.x, st.y);
  gWet = 1.0 - smoothstep(st.y * 1.2, st.y * 4.5, st.x);
  vec2 pa = pathAt(P);
  float onPath = 1.0 - smoothstep(0.0, 0.7, pa.x);
  float tr = trailK(P, forest) * (1.0 - onPath);
  float wTurf = clamp(grassy * (1.0 - forest) + woody * (1.0 - forest) * 0.45 - n1 * 0.2, 0.0, 1.0);
  gW[0] = clamp(forest + woody * (1.0 - forest) * 0.55 + n1 * 0.2, 0.0, 1.0) + tr * 0.3;          // leaf litter
  gW[1] = clamp(built * 0.9 + 0.1 + n2 * 0.15 - forest * 0.1, 0.0, 1.0);                          // laterite
  gW[2] = wTurf * (1.0 - high);                                                                    // lowland turf
  gW[3] = clamp(rockM * 1.3 + gSteep + n2 * 0.25 - 0.12 + bare * 0.75 + ar.w, 0.0, 1.0);          // rock
  gW[4] = cloudBelt * (forest * 0.55 + gW[3] * 0.5) * (0.6 + n1 * 0.4);                           // moss
  gW[5] = max(gWet * 0.9, max(max(wetA, wetLC), max(waterLC, ar.x)) * 0.95);                      // mud
  gW[6] = onPath + tr * 0.6;                                                                       // beaten earth
  gW[7] = ar.y * (1.0 - forest * 0.9);                                                             // mine benches / spoil (not where forest still stands)
  gW[8] = wTurf * high;                                                                            // summit grass ground
  gW[9] = max(bed * smoothstep(0.15, 0.6, (st.y - 0.6) / 3.4), sandA);                            // river sand / gravel
  gW[10] = max(ar.z, crop * 0.8);                                                                  // worked fields
  // mapped surfaces win over the generic mix
  float over = clamp(max(max(gW[6], gW[7]), max(gW[9], gW[10])), 0.0, 1.0);
  for (int i = 0; i < 6; i++) if (i != 3 || gW[7] < 0.5) gW[i] *= 1.0 - over * 0.85;
  gW[3] *= 1.0 - gW[5] * 0.6;
  float sum = 1e-3;
  for (int i = 0; i < ${N}; i++) sum += gW[i];
  for (int i = 0; i < ${N}; i++) gW[i] /= sum;
  float kTile = smoothstep(-0.4, 0.4, vnoise(P / 11.0, 71));
  vec3 g = vec3(0.0);
  for (int i = 0; i < ${N}; i++) {
    if (gW[i] < 0.015) continue;
    vec3 c = ((i == 3 || i == 7) && gSteep > 0.05) ? mix(layerColor(i, P, kTile), layerTri(i, vWP, normalize(vNW)), gSteep) : layerColor(i, P, kTile);
    if (i == 1) c *= uSoilTint;
    if (i == 8) c *= vec3(1.08, 1.02, 0.86);
    if (i == 7) c *= mix(0.72, 1.0, smoothstep(0.0, 0.07, fract(vWP.y / 9.0))); // bench lines of an open-pit mine
    g += c * gW[i];
  }
  gBare = gW[6];
  g = mix(g, g * vec3(0.55, 0.52, 0.5), gWet * 0.6);
  // Distant canopy shell: dark crowns with lit tops.
  float lump = 0.5 + 0.5 * vnoise(P / 5.0, 91);
  vec3 crownCol = mix(vec3(0.045, 0.085, 0.03), vec3(0.16, 0.24, 0.07), lump * lump) * mix(vec3(1.0), vec3(0.9, 1.0, 1.08), cloudBelt);
  g = mix(g, crownCol, vShell);
  diffuseColor.rgb *= g;
  gRough = 0.95 - gW[3] * 0.12 - gW[5] * 0.35 - gWet * 0.25 - gW[9] * 0.1;
`;

export const TERRAIN_NORMAL_GLSL = /* glsl */ `
  {
    vec3 t = vec3(0.0, 0.0, 1e-3);
    for (int i = 0; i < ${N}; i++) {
      if (gW[i] < 0.03) continue;
      float k = (i == 2 || i == 4 || i == 8) ? 0.5 : 1.0;
      vec3 nn = layerNormal(i, P);
      t += vec3(nn.xy * k, nn.z) * gW[i];
    }
    t.xy *= (1.0 - vShell) * 1.2 * (1.0 - gSteep * 0.5);
    vec3 N = normalize(vNW);
    vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
    vec3 B = cross(N, T);
    vec3 nw = normalize(T * t.x - B * t.y + N * max(t.z, 0.2));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
`;
