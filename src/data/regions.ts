// Where is a point? Reserve (WDPA, two parts), mining enclave (OSM, approximate) and country.
// borders_clipped.geojson holds *lines* (each country's outline clipped to the 31 km window) that do not
// match each other exactly, so each country polygon is the line closed along the window edge on that
// country's side; a point inside none / several of them, or close to a line, is reported as "near a border".
import { BBOX, lonLatToXZ } from './geo';

type Pt = [number, number]; // lon, lat
type Ring = Pt[];
type Polygon = Ring[]; // outer ring + holes

export type ISO3 = 'GIN' | 'CIV' | 'LBR';

export interface Place {
  reserve: ISO3 | null;
  enclave: boolean;
  country: ISO3 | null;
  nearBorder: boolean;
  nearTripoint: boolean;
}

interface Feature<G> { properties: Record<string, unknown>; geometry: G }
interface FC<G> { features: Feature<G>[] }
type Geom =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }
  | { type: 'LineString'; coordinates: Ring }
  | { type: 'MultiLineString'; coordinates: Ring[] };

const TRIPOINT: Pt = [-8.47222, 7.55556]; // Wikidata (docs/GEO_DATA.md §4)
const NEAR_BORDER_M = 400;
const NEAR_TRIPOINT_M = 2500;

function inRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(p: Pt, poly: Polygon): boolean {
  if (!inRing(p, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(p, poly[k])) return false;
  return true;
}

function polygonsOf(g: Geom): Polygon[] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function linesOf(g: Geom): Ring[] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

/** Distance in metres from p to a polyline (local metric projection). */
function distToLine(p: Pt, line: Ring): number {
  const [px, pz] = lonLatToXZ(p[0], p[1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = lonLatToXZ(line[i - 1][0], line[i - 1][1]);
    const [bx, bz] = lonLatToXZ(line[i][0], line[i][1]);
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), pz - (az + t * dz)));
  }
  return best;
}

const { west: W, east: E, south: S, north: N } = BBOX;

/** Close the clipped outlines along the window edge on each country's side (Guinea N, Liberia W/SW, Côte d'Ivoire SE). */
function countryPolygons(lines: Record<string, Ring[]>): Record<ISO3, Ring> {
  const gin = lines.GIN ?? [];
  const lbr = lines.LBR?.[0] ?? [];
  const civ = lines.CIV?.[0] ?? [];
  // Guinea: southern outline (east → west), the small Liberian notch on the west edge, then round the north.
  const guinea: Ring = [...(gin[0] ?? []), ...(gin[1] ?? []), [W, N], [E, N]];
  // Liberia: outline (NW → bottom edge), then the SW corner.
  const liberia: Ring = [...lbr, [W, S]];
  // Côte d'Ivoire: outline (bottom edge → east edge), then the SE corner.
  const civRing: Ring = [...civ, [E, S]];
  return { GIN: guinea, LBR: liberia, CIV: civRing };
}

export class Regions {
  private constructor(
    private reserve: { iso3: ISO3; polys: Polygon[] }[],
    private enclave: Polygon[],
    private countries: Record<ISO3, Ring>,
    private borderLines: Ring[],
  ) {}

  static async load(base: string): Promise<Regions> {
    const get = async (f: string) => {
      const r = await fetch(`${base}data/${f}`);
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return (await r.json()) as FC<Geom>;
    };
    const [res, enc, bor] = await Promise.all([get('reserve_boundary.geojson'), get('mining_enclave_osm.geojson'), get('borders_clipped.geojson')]);
    const reserve = res.features.map((f) => ({ iso3: f.properties.iso3 as ISO3, polys: polygonsOf(f.geometry) }));
    const enclave = enc.features.flatMap((f) => polygonsOf(f.geometry));
    const lines: Record<string, Ring[]> = {};
    for (const f of bor.features) lines[f.properties.iso3 as string] = linesOf(f.geometry);
    return new Regions(reserve, enclave, countryPolygons(lines), Object.values(lines).flat());
  }

  /** Reserve polygons (for the M6 overlay). */
  get reserveParts() { return this.reserve; }
  get enclavePolygons() { return this.enclave; }
  get borders() { return this.borderLines; }

  classify(lon: number, lat: number): Place {
    const p: Pt = [lon, lat];
    const reserve = this.reserve.find((r) => r.polys.some((poly) => inPolygon(p, poly)))?.iso3 ?? null;
    const enclave = this.enclave.some((poly) => inPolygon(p, poly));
    const hits = (Object.keys(this.countries) as ISO3[]).filter((k) => inRing(p, this.countries[k]));
    const nearBorder = hits.length !== 1 || this.borderLines.some((l) => distToLine(p, l) < NEAR_BORDER_M);
    const [tx, tz] = lonLatToXZ(TRIPOINT[0], TRIPOINT[1]);
    const [px, pz] = lonLatToXZ(lon, lat);
    const nearTripoint = Math.hypot(px - tx, pz - tz) < NEAR_TRIPOINT_M;
    // Inside the reserve the WDPA part tells us the country reliably.
    const country = reserve ?? (hits.length === 1 ? hits[0] : null);
    return { reserve, enclave, country, nearBorder: reserve ? false : nearBorder, nearTripoint };
  }
}
