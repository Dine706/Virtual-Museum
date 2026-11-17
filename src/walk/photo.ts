// Scanned CC0 textures (Poly Haven, public/walk/tex/, scripts/fetch_textures.mjs) for the high-quality look:
// leaf litter, red laterite, grassy ground, rock, mossy rock, and three barks. Generic surfaces, not Nimba photos.
import * as THREE from 'three';

export type PhotoRole = 'litter' | 'laterite' | 'turf' | 'rock' | 'moss' | 'bark' | 'barkGrey' | 'palm';
export type PhotoSet = Record<PhotoRole, { map: THREE.Texture; normal: THREE.Texture }>;

const ROLES: PhotoRole[] = ['litter', 'laterite', 'turf', 'rock', 'moss', 'bark', 'barkGrey', 'palm'];

export async function loadPhotos(base: string, anisotropy: number): Promise<PhotoSet> {
  const loader = new THREE.TextureLoader();
  const one = (url: string, srgb: boolean) => loader.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    return t;
  });
  const entries = await Promise.all(ROLES.map(async (r) => {
    const [map, normal] = await Promise.all([one(`${base}walk/tex/${r}_diff.webp`, true), one(`${base}walk/tex/${r}_nor.webp`, false)]);
    return [r, { map, normal }] as const;
  }));
  return Object.fromEntries(entries) as PhotoSet;
}
