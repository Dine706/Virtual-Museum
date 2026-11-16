// Local metric projection used by the whole scene (scene units = metres).
// x = (lon − lon0)·kx (east +), z = −(lat − lat0)·kz (north = −z), y = elevation · exaggeration.
// Constants come from public/data/terrain_meta.json; they are repeated here so geometry code
// can run before the JSON arrives, and checked against it at load time.

export const LON0 = -8.42;
export const LAT0 = 7.62;
export const KX = 110336.9679982832; // m per degree of longitude at lat0 (111320·cos lat0)
export const KZ = 110574.0; // m per degree of latitude

export const BBOX = { west: -8.56, south: 7.48, east: -8.28, north: 7.76 } as const;

/** World-space extent of the terrain tile (edges of the DEM pixels). */
export const WORLD = {
  minX: (BBOX.west - LON0) * KX,
  maxX: (BBOX.east - LON0) * KX,
  minZ: -(BBOX.north - LAT0) * KZ, // north edge (negative z)
  maxZ: -(BBOX.south - LAT0) * KZ, // south edge
};
export const WORLD_W = WORLD.maxX - WORLD.minX;
export const WORLD_D = WORLD.maxZ - WORLD.minZ;

export function lonLatToXZ(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KX, -(lat - LAT0) * KZ];
}

export function xzToLonLat(x: number, z: number): [number, number] {
  return [x / KX + LON0, -z / KZ + LAT0];
}

/** Clamp a world point to the tile. */
export function clampToWorld(x: number, z: number, margin = 0): [number, number] {
  return [
    Math.min(WORLD.maxX - margin, Math.max(WORLD.minX + margin, x)),
    Math.min(WORLD.maxZ - margin, Math.max(WORLD.minZ + margin, z)),
  ];
}

export interface TerrainMeta {
  source: string;
  bbox_wgs84: { west: number; south: number; east: number; north: number };
  size_px: [number, number];
  extent_m: [number, number];
  elevation_min_m: number;
  elevation_max_m: number;
  local_projection: { lon0: number; lat0: number; x_m_per_deg_lon: number; z_m_per_deg_lat: number };
}

export function checkMeta(meta: TerrainMeta): string[] {
  const issues: string[] = [];
  const p = meta.local_projection;
  if (p.lon0 !== LON0 || p.lat0 !== LAT0) issues.push('projection origin differs from geo.ts');
  if (Math.abs(p.x_m_per_deg_lon - KX) > 1e-3 || Math.abs(p.z_m_per_deg_lat - KZ) > 1e-3) issues.push('projection scale differs from geo.ts');
  const b = meta.bbox_wgs84;
  if (b.west !== BBOX.west || b.east !== BBOX.east || b.south !== BBOX.south || b.north !== BBOX.north) issues.push('bbox differs from geo.ts');
  return issues;
}
