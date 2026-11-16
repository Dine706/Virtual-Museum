// Types for public/data/content.json (schema: CLAUDE.md §9) and photo credits.

export type Lang = 'fr' | 'en';
export type Category = 'peak' | 'habitat' | 'species' | 'culture' | 'conservation' | 'water';
export type Mode = 'nature' | 'culture' | 'conservation';
export type Precision = 'exact' | 'approximate' | 'area' | 'symbolic';

export interface Bilingual { fr: string; en: string }

export interface Fact { label_fr: string; label_en: string; value_fr: string; value_en: string }
export interface Source { label: string; url: string }

export interface Hotspot {
  id: string;
  order: number;
  category: Category;
  modes: Mode[];
  lon: number;
  lat: number;
  elevation_m: number;
  elevation_source?: string;
  dem_m: number;
  location_precision: Precision;
  coord_confidence: string;
  coord_source: string;
  title_fr: string; title_en: string;
  short_fr: string; short_en: string;
  long_fr: string; long_en: string;
  facts: Fact[];
  sources: Source[];
  uncertain: string[];
  photos: string[];
  camera: { distance_m: number; azimuth_deg: number; elevation_deg: number };
}

export interface ContentMeta {
  title_fr: string; title_en: string;
  intro_fr: string; intro_en: string;
  stats: { value: string; label_fr: string; label_en: string }[];
  modes: Record<Mode, Bilingual>;
  categories: Record<Category, Bilingual>;
}

export interface Content { meta: ContentMeta; hotspots: Hotspot[] }

export interface PhotoCredit {
  id: string;
  width: number; height: number;
  commons_title: string;
  source_url: string;
  author: string;
  license: string;
  license_url: string;
  attribution: string;
  alt_en: string; alt_fr: string;
  hotspots: string[];
}

/** Pick the FR or EN variant of a `*_fr` / `*_en` field pair. */
export function loc<T extends object>(obj: T, key: string, lang: Lang): string {
  const rec = obj as Record<string, unknown>;
  return String(rec[`${key}_${lang}`] ?? rec[`${key}_fr`] ?? '');
}

export async function loadContent(base: string): Promise<Content> {
  const res = await fetch(`${base}data/content.json`);
  if (!res.ok) throw new Error(`content.json: HTTP ${res.status}`);
  const c = (await res.json()) as Content;
  c.hotspots.sort((a, b) => a.order - b.order);
  return c;
}

/** Credits are keyed by photo id; the id is the file's basename (CLAUDE.md M0: build URLs from the id). */
export async function loadCredits(base: string): Promise<Map<string, PhotoCredit>> {
  const res = await fetch(`${base}photos/credits.json`);
  if (!res.ok) throw new Error(`credits.json: HTTP ${res.status}`);
  const list = (await res.json()) as (Omit<PhotoCredit, 'id'> & { file: string })[];
  const map = new Map<string, PhotoCredit>();
  for (const p of list) {
    const id = p.file.split('/').pop()!.replace(/\.jpe?g$/i, '');
    map.set(id, { ...p, id });
  }
  return map;
}

export const photoUrl = (base: string, id: string) => `${base}photos/${id}.jpg`;
export const thumbUrl = (base: string, id: string) => `${base}photos/thumb/${id}.jpg`;

/** <picture> sources: AVIF, then WebP, JPEG fallback (scripts/make_photo_formats.mjs). */
export function fillPicture(picture: HTMLPictureElement, img: HTMLImageElement, base: string, id: string, thumb: boolean) {
  const stem = `${base}photos/${thumb ? 'thumb/' : ''}${id}`;
  picture.querySelectorAll('source').forEach((s) => s.remove());
  for (const [type, ext] of [['image/avif', 'avif'], ['image/webp', 'webp']] as const) {
    const s = document.createElement('source');
    s.type = type;
    s.srcset = `${stem}.${ext}`;
    picture.insertBefore(s, img);
  }
  img.src = `${stem}.jpg`;
}

export function pictureFor(base: string, id: string, thumb: boolean): { picture: HTMLPictureElement; img: HTMLImageElement } {
  const picture = document.createElement('picture');
  const img = document.createElement('img');
  picture.append(img);
  fillPicture(picture, img, base, id, thumb);
  return { picture, img };
}
