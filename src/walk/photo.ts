// Generated surface materials for the High look (public/walk/art/, scripts/build_world_art.mjs).
// Generic reconstructed surfaces, not photographs or physical scans of Nimba.
import * as THREE from 'three';
import { LAYERS, packArray } from './textures';

export type PhotoRole = 'litter' | 'laterite' | 'turf' | 'rock' | 'moss' | 'bark' | 'barkGrey' | 'palm' | 'mud' | 'road' | 'mine' | 'highgrass' | 'sand' | 'field';
export type PhotoSet = Record<PhotoRole, { map: THREE.Texture; normal: THREE.Texture }>;

const ROLES: PhotoRole[] = ['litter', 'laterite', 'turf', 'rock', 'moss', 'bark', 'barkGrey', 'palm', 'mud', 'road', 'mine', 'highgrass', 'sand', 'field'];
const GENERATED: Record<PhotoRole, string> = {
  litter: 'litter', laterite: 'laterite', turf: 'grass', rock: 'rock', moss: 'moss', bark: 'bark', barkGrey: 'bark',
  palm: 'palm', mud: 'mud', road: 'laterite', mine: 'laterite', highgrass: 'grass', sand: 'sand', field: 'laterite',
};

export async function loadPhotos(base: string, anisotropy: number): Promise<PhotoSet> {
  const loader = new THREE.TextureLoader();
  const one = (url: string, srgb: boolean) => loader.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    return t;
  });
  const entries = await Promise.all(ROLES.map(async (r) => {
    const stem = `${base}walk/art/${GENERATED[r]}`;
    const [map, normal] = await Promise.all([one(`${stem}.webp`, true), one(`${stem}_nor.webp`, false)]);
    return [r, { map, normal }] as const;
  }));
  return Object.fromEntries(entries) as PhotoSet;
}

/** The scanned ground layers as texture arrays (same order as LAYERS). */
export function photoLayers(p: PhotoSet, anisotropy: number) {
  const diff = packArray(LAYERS.map((l) => p[l].map.image as CanvasImageSource), 1024, true, anisotropy);
  const nor = packArray(LAYERS.map((l) => p[l].normal.image as CanvasImageSource), 512, false, anisotropy);
  return { diff, nor };
}
