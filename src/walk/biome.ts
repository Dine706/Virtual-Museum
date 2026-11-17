// Habitat at a point, from measured data only: canopy height (Meta/WRI), land cover (ESA WorldCover),
// altitude (Copernicus DEM) and the DEM-derived streams. Vegetation belts follow content.json:
// montane forest from ≈ 600 m, mossy cloud forest from ≈ 900 m, montane grassland from ≈ 1,200–1,400 m.
import * as THREE from 'three';
import type { WalkData } from './data';

export interface Biome {
  elev: number; canopy: number; cls: number; rock: number;
  forest: number; regrowth: number; grass: number; built: number;
  cloud: number; high: number; wet: number; streamDist: number; streamWidth: number;
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function biomeAt(d: WalkData, x: number, z: number): Biome {
  const a = d.attrAt(x, z);
  const s = d.streamAt(x, z);
  const elev = d.baseHeight(x, z);
  const forest = ss(3, 12, a.canopy);
  const woody = a.cls === 10 || a.cls === 20 ? 1 : 0;
  const regrowth = woody * (1 - forest) * (1 - ss(6, 10, a.canopy));
  const grassy = a.cls === 30 || a.cls === 40 || a.cls === 20 ? 1 : 0;
  const grass = Math.max(0, grassy * (1 - forest) - regrowth * 0.5);
  return {
    elev, canopy: a.canopy, cls: a.cls, rock: a.rock,
    forest, regrowth, grass, built: a.cls === 50 ? 1 : 0,
    cloud: ss(820, 1000, elev), high: ss(1150, 1350, elev),
    wet: 1 - ss(s.width * 1.5, s.width * 5 + 6, s.dist), streamDist: s.dist, streamWidth: s.width,
  };
}

export type HabitatId = 'lowlandForest' | 'cloudForest' | 'montaneGrass' | 'savanna' | 'regrowth' | 'village' | 'gallery';

export function habitatOf(b: Biome): HabitatId {
  if (b.wet > 0.6 && b.forest + b.regrowth > 0.3) return 'gallery';
  if (b.built > 0.5) return 'village';
  if (b.forest > 0.5) return b.cloud > 0.5 ? 'cloudForest' : 'lowlandForest';
  if (b.regrowth > 0.4) return 'regrowth';
  if (b.high > 0.5) return 'montaneGrass';
  return b.grass > 0.3 ? 'savanna' : b.cloud > 0.5 ? 'montaneGrass' : 'regrowth';
}

const FOG: Record<HabitatId, [number, string]> = {
  cloudForest: [0.0105, '#C9D2CC'],
  lowlandForest: [0.0042, '#A9B8A0'],
  gallery: [0.0052, '#AFC0AE'],
  regrowth: [0.0026, '#C9CDBA'],
  village: [0.0022, '#D7CDB4'],
  savanna: [0.0016, '#D2D0BE'],
  montaneGrass: [0.00035, '#D9DCD6'],
};

/** Local fog density and tint for the walker's habitat (cloud forest is in cloud most of the year). */
export function fogFor(h: HabitatId, elev: number, out: THREE.Color): number {
  out.set(FOG[h][1]);
  // Above ~900 m the mountain is in cloud almost all year (UNESCO/Wikipedia): extra mist on the slopes.
  const mist = h === 'montaneGrass' || h === 'savanna' ? 0 : ss(900, 1250, elev) * 0.002;
  return FOG[h][0] + mist;
}
