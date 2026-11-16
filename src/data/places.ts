// Named places shown as terrain labels (DESIGN.md §7). Village positions: docs/GEO_DATA.md §4
// (OSM Nominatim / Wikidata). Country labels sit at points the readout classifies inside each country
// (scripts/check-overlays.mjs verifies this). Lola is outside the 3D window, so it is not shown.
import type { Mode } from './content';

export interface PlaceLabel {
  id: string;
  lon: number;
  lat: number;
  kind: 'village' | 'country';
  /** Fixed name, or an i18n key when `i18n` is true. */
  text: string;
  i18n?: boolean;
  modes: Mode[];
}

export const PLACE_LABELS: PlaceLabel[] = [
  { id: 'bossou', lon: -8.5055, lat: 7.6508, kind: 'village', text: 'Bossou', modes: ['culture'] },
  { id: 'seringbara', lon: -8.4629, lat: 7.6311, kind: 'village', text: 'Séringbara', modes: ['culture'] },
  { id: 'gbakore', lon: -8.4059, lat: 7.7241, kind: 'village', text: 'Gbakoré', modes: ['culture'] },
  { id: 'nzo', lon: -8.3142, lat: 7.6794, kind: 'village', text: "N'Zo", modes: ['culture'] },
  { id: 'yeale', lon: -8.4222, lat: 7.5279, kind: 'village', text: 'Yéalé', modes: ['culture'] },
  { id: 'yekepa', lon: -8.5419, lat: 7.5753, kind: 'village', text: 'Yekepa', modes: ['culture'] },
  { id: 'gin', lon: -8.47, lat: 7.705, kind: 'country', text: 'country.GIN', i18n: true, modes: ['conservation'] },
  { id: 'lbr', lon: -8.535, lat: 7.555, kind: 'country', text: 'country.LBR', i18n: true, modes: ['conservation'] },
  { id: 'civ', lon: -8.34, lat: 7.53, kind: 'country', text: 'country.CIV', i18n: true, modes: ['conservation'] },
];
