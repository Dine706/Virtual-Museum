// GLSL shared by the terrain, sky and cloud shaders. The fog colour is the sky's horizon colour in the
// view direction, so terrain, cloud and sky all fade into the same haze (no visible tile edge).

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.13; a *= 0.5; }
  return s / 0.875;
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.7; a *= 0.5; }
  return s / 0.96875;
}
`;

export const ATMO_UNIFORMS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyHorizonAway;
uniform vec3 uSkyGlow;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uMistLevel;
uniform float uMistDensity;
uniform float uMistAmount;
uniform vec3 uMistColor;
uniform float uSaturation;
uniform vec3 uGrade;
uniform float uTime;
uniform vec4 uWorld;   // minX, minZ, width, depth (scene units)
uniform float uExag;
`;

export const SKY_FN = /* glsl */ `
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec2 dh = normalize(dir.xz + 1e-5), sh = normalize(uSunDir.xz + 1e-5);
  vec3 horizon = mix(uSkyHorizonAway, uSkyHorizon, smoothstep(-0.6, 1.0, dot(dh, sh)));
  vec3 base = mix(horizon, uSkyZenith, pow(y, 0.42));
  float sd = max(dot(normalize(dir), uSunDir), 0.0);
  float nearHorizon = 1.0 - smoothstep(0.0, 0.5, y);
  vec3 glow = uSkyGlow * (pow(sd, 5.0) * 0.55 * (0.4 + 0.6 * nearHorizon) + pow(sd, 48.0) * 0.8);
  return base + glow;
}
/** Exponential height fog integrated along the view ray (density falls off with altitude). */
float heightFog(vec3 cam, vec3 p) {
  vec3 v = p - cam;
  float dist = length(v);
  float k = uFogFalloff;
  float dy = v.y;
  float a = uFogDensity * exp(-k * cam.y);
  float f = abs(dy * k) > 1e-4 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
  return 1.0 - exp(-a * dist * f);
}
vec3 aerial(vec3 col, vec3 cam, vec3 p) {
  vec3 dir = normalize(p - cam);
  vec3 fogCol = skyColor(normalize(vec3(dir.x, 0.0, dir.z)));
  return mix(col, fogCol, heightFog(cam, p));
}
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, uSaturation) * uGrade;
}
vec2 worldUV(vec2 xz) { return (xz - uWorld.xy) / uWorld.zw; }
float edgeFade(vec2 xz, float width) {
  vec2 d = min(xz - uWorld.xy, uWorld.xy + uWorld.zw - xz);
  return smoothstep(0.0, width, min(d.x, d.y));
}
`;
