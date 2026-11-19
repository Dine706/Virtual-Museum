// Shared, world-anchored surface detail for the orbit view, walking canopy shell and distant massif.
// These maps illustrate habitat texture; the class map and DEM continue to determine its placement.
import * as THREE from 'three';

export interface LandscapeMaps { canopy: THREE.Texture; ridge: THREE.Texture; rock: THREE.Texture; tree: THREE.Texture; grass: THREE.Texture }
export async function loadLandscape(base: string, anisotropy: number): Promise<LandscapeMaps> {
  const loader = new THREE.TextureLoader();
  const one = async (key: string) => {
    const map = await loader.loadAsync(key === 'rock' ? `${base}walk/art/rock.webp` : `${base}landscape/${key}.webp`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = anisotropy;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const [canopy, ridge, rock, tree, grass] = await Promise.all(['aerial-canopy', 'ridge-surface', 'rock', 'broadleaf-silhouette', 'tussock-grass'].map(one));
  tree.wrapS = tree.wrapT = THREE.ClampToEdgeWrapping;
  grass.wrapS = grass.wrapT = THREE.ClampToEdgeWrapping;
  return { canopy, ridge, rock, tree, grass };
}

export const LANDSCAPE_GLSL = /* glsl */ `
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
  vec3 crowns = landscapeSample(uCanopyMap, p, 115.0);
  vec3 ridge = mix(landscapeSample(uRidgeMap, p, 34.0), landscapeSample(uRidgeMap, p, 320.0), 0.40);
  vec3 cliff = landscapeSample(uCliffMap, p, 90.0);
  // Keep the mapped habitat and regional palette while bringing back visible natural structure.
  vec3 forest = crowns * vec3(0.86, 0.94, 0.82);
  vec3 ground = mix(ridge, cliff * vec3(0.82, 0.86, 0.90), smoothstep(0.25, 0.8, slope));
  return mix(base, mix(ground, forest, smoothstep(0.40, 0.88, canopy)), uLandscape * 0.90);
}
`;

export function landscapeUniforms() {
  // A valid, owned placeholder prevents incomplete samplers before the optional High assets arrive.
  const placeholder = new THREE.DataTexture(new Uint8Array([92, 104, 55, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.needsUpdate = true;
  return { uCanopyMap: { value: placeholder as THREE.Texture }, uRidgeMap: { value: placeholder as THREE.Texture }, uCliffMap: { value: placeholder as THREE.Texture }, uLandscape: { value: 0 } };
}

export function useLandscape(uniforms: ReturnType<typeof landscapeUniforms>, maps: LandscapeMaps) {
  if (uniforms.uLandscape.value === 0) uniforms.uCanopyMap.value.dispose();
  uniforms.uCanopyMap.value = maps.canopy;
  uniforms.uRidgeMap.value = maps.ridge;
  uniforms.uCliffMap.value = maps.rock;
  uniforms.uLandscape.value = 1;
}
