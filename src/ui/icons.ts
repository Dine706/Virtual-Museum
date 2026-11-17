// Line icons (24×24, 1.75 px stroke, round joins) drawn for this project in the Lucide style,
// plus the six category glyphs (filled, read on light pin fills). Inline SVG – no icon font, no CDN.
import type { Category } from '../data/content';

const stroke = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  sunset: stroke('<path d="M12 9V3M8.5 6.5 12 3l3.5 3.5"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M2.5 18h19M2.5 21.5h19"/>'),
  mist: stroke('<path d="M7 13.5a4.5 4.5 0 0 1 .5-9 5.5 5.5 0 0 1 10 2.5 3.5 3.5 0 0 1 .5 6.5"/><path d="M3 17h18M5 20.5h14"/>'),
  locate: stroke('<path d="M3 11.5 21 3l-8.5 18-2-7.5z"/>'),
  globe: stroke('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  close: stroke('<path d="M6 6l12 12M18 6 6 18"/>'),
  list: stroke('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>'),
  chevronLeft: stroke('<path d="M15 5l-7 7 7 7"/>'),
  chevronRight: stroke('<path d="M9 5l7 7-7 7"/>'),
  share: stroke('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>'),
  external: stroke('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  target: stroke('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>'),
  expand: stroke('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  mountain: stroke('<path d="M2.5 19.5 9 8.5l4 6.5 2.5-4 6 8.5z"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>'),
  walk: stroke('<circle cx="13" cy="4.2" r="1.8"/><path d="M9.5 21l2.2-6.2 2.8 2.7V21M8 11.5l2.5-3.5 3 .5 2 3.5 2.5 1M11.7 14.8 10.5 8"/>'),
  play: stroke('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>'),
};

const fill = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;

export const glyphs: Record<Category, string> = {
  // ▲ twin summits
  peak: fill('<path d="M1.5 20.5 8 10l3.1 4.9L15.6 6l6.9 14.5z"/>'),
  // leaf
  habitat: fill('<path d="M20.5 3.5C11 3.5 4.5 8 4.5 15c0 1.6.4 3 1 4.2L3.6 21l1.1 1.1 1.9-1.9A8 8 0 0 0 10 21c7 0 10.5-7 10.5-17.5zM8.3 17.6l-.9-.9C10 13 13.2 10 16.8 8l.5.6c-3.4 2.3-6.3 5.3-9 9z"/>'),
  // paw
  species: fill('<ellipse cx="7" cy="9" rx="2.1" ry="2.7"/><ellipse cx="12" cy="6.6" rx="2.1" ry="2.7"/><ellipse cx="17" cy="9" rx="2.1" ry="2.7"/><ellipse cx="4.6" cy="14" rx="1.8" ry="2.3"/><ellipse cx="19.4" cy="14" rx="1.8" ry="2.3"/><path d="M12 11.5c-3 0-6 4.6-6 7.2 0 1.7 1.3 2.3 2.6 2.3 1.5 0 2.2-.8 3.4-.8s1.9.8 3.4.8c1.3 0 2.6-.6 2.6-2.3 0-2.6-3-7.2-6-7.2z"/>'),
  // round hut with conical roof
  culture: fill('<path d="M12 2.8 2.5 11.5h2.2L12 5.2l7.3 6.3h2.2z"/><path d="M5.5 12.5h13V21h-4.7v-5h-3.6v5H5.5z"/>'),
  // shield
  conservation: fill('<path d="M12 2.5 4 5.5v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10v-6zm-1.2 13.4L7.2 12.3l1.4-1.4 2.2 2.2 4.8-4.8 1.4 1.4z"/>'),
  // drop
  water: fill('<path d="M12 2.8C9 7 5.5 11 5.5 15a6.5 6.5 0 0 0 13 0c0-4-3.5-8-6.5-12.2z"/>'),
};

export const categoryColor: Record<Category, string> = {
  peak: '#D7B26A',
  habitat: '#7DB26B',
  species: '#E0B04A',
  culture: '#C8683F',
  conservation: '#5C93B5',
  water: '#3FA7B5',
};
