// Shared, world-anchored surface detail for the orbit view, walking canopy shell and distant massif.
// These maps illustrate habitat texture; the class map and DEM continue to determine its placement.
import * as THREE from 'three';
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';

export interface LandscapeMaps { relief: THREE.Texture; survey: THREE.Texture; sky: THREE.Texture; canopy: THREE.Texture; ridge: THREE.Texture; rock: THREE.Texture; tree: THREE.Texture; grass: THREE.Texture }
export async function loadLandscape(base: string, anisotropy: number): Promise<LandscapeMaps> {
  const loader = new THREE.TextureLoader();
  const one = async (key: string) => {
    const map = await loader.loadAsync(key === 'rock' ? `${base}walk/art/rock.webp` : `${base}landscape/${key}.webp`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = anisotropy;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const [canopy, ridge, rock, tree, grass, survey, sky] = await Promise.all(['aerial-canopy', 'ridge-surface', 'rock', 'broadleaf-silhouette', 'tussock-grass', 'nimba-sentinel', 'cloud-sky'].map(one));
  tree.wrapS = tree.wrapT = THREE.ClampToEdgeWrapping;
  grass.wrapS = grass.wrapT = THREE.ClampToEdgeWrapping;
  survey.wrapS = survey.wrapT = THREE.ClampToEdgeWrapping;
  sky.wrapT = THREE.ClampToEdgeWrapping;
  const relief = await loader.loadAsync(base + "landscape/ridge-relief.png");
  return { relief, canopy, ridge, rock, tree, grass, survey, sky };
}

export const LANDSCAPE_GLSL = /* glsl */ `
uniform sampler2D uSurvey;
uniform sampler2D uRelief;
uniform vec4 uSurveyBounds;
uniform sampler2D uCanopyMap;
uniform sampler2D uRidgeMap;
uniform sampler2D uCliffMap;
uniform float uLandscape;
// Two rotated scales prevent a photograph-sized repeat from appearing across a whole mountainside.
vec3 landscapeSample(sampler2D tex, vec2 p, float scale) {
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
  vec3 a = texture2D(tex, p / scale).rgb;
  vec3 b = texture2D(tex, q / (scale * 2.37) + vec2(0.37, 0.71)).rgb;
  return a * 0.72 + b * 0.28;
}
vec3 landscapeSurface(vec3 base, vec2 p, float canopy, float slope) {
  if (uLandscape < 0.5) return base;
  vec3 crowns = landscapeSample(uCanopyMap, p + 12.0 * sin(p.yx / 145.0), 210.0);
  vec3 ridge = mix(landscapeSample(uRidgeMap, p, 34.0), landscapeSample(uRidgeMap, p, 320.0), 0.40);
  vec3 cliff = landscapeSample(uCliffMap, p, 90.0);
  // Keep the mapped habitat and regional palette while bringing back visible natural structure.
  vec3 forest = crowns * vec3(0.86, 0.94, 0.82);
  vec3 ground = mix(ridge, cliff * vec3(0.82, 0.86, 0.90), smoothstep(0.25, 0.8, slope));
  vec2 uv = (p - uSurveyBounds.xy) / uSurveyBounds.zw;
  vec3 satellite = texture2D(uSurvey, vec2(uv.x, 1.0-uv.y)).rgb;
  vec3 habitat = mix(ground, forest, smoothstep(0.40, 0.88, canopy));
  // The 10 m survey places ravines, outcrops and grass clearings. Subpixel crowns and
  // blades come from the reconstructive material instead of resizing the satellite pixels.
  vec3 relief = texture2D(uRelief, vec2(uv.x, 1.0-uv.y)).rgb;
  float closure = smoothstep(.35,.85,canopy);
  float crownLight = clamp(dot(crowns, vec3(.24,.63,.13)) * 7.8, .42, 1.85);
  float grassLight = clamp(dot(ridge, vec3(.24,.63,.13)) * 8.0, .65, 1.65);
  float incident = mix(grassLight, crownLight, closure);
  float shelter = mix(.55,1.06,relief.g) * mix(.80,1.16,relief.b);
  vec3 surface = mix(satellite*1.80, habitat, .22) * incident;
  return surface * shelter;

}
`;

export function landscapeUniforms() {
  // A valid, owned placeholder prevents incomplete samplers before the optional High assets arrive.
  const placeholder = new THREE.DataTexture(new Uint8Array([92, 104, 55, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.needsUpdate = true;
  return { uRelief: { value: placeholder as THREE.Texture }, uSurvey: { value: placeholder as THREE.Texture }, uSurveyBounds: { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, WORLD_W, WORLD_D) }, uCanopyMap: { value: placeholder as THREE.Texture }, uRidgeMap: { value: placeholder as THREE.Texture }, uCliffMap: { value: placeholder as THREE.Texture }, uLandscape: { value: 0 } };
}

export function useLandscape(uniforms: ReturnType<typeof landscapeUniforms>, maps: LandscapeMaps) {
  if (uniforms.uLandscape.value === 0) uniforms.uCanopyMap.value.dispose();
  uniforms.uRelief.value = maps.relief;
  uniforms.uSurvey.value = maps.survey;
  uniforms.uCanopyMap.value = maps.canopy;
  uniforms.uRidgeMap.value = maps.ridge;
  uniforms.uCliffMap.value = maps.rock;
  uniforms.uLandscape.value = 1;
}
