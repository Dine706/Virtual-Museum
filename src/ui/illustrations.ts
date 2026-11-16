// Placeholders for hotspots without an openly licensed photo (CLAUDE.md §9/§10.6):
// a monochrome silhouette drawn for this project (never a photo of another species),
// or the category glyph on a neutral block.
import type { Hotspot } from '../data/content';
import { glyphs } from './icons';

const SILHOUETTES: Record<string, { viewBox: string; body: string }> = {
  // Nimba otter shrew: long low body, pointed whiskered snout, small ears, long flattened tail.
  'otter-shrew': {
    viewBox: '0 0 240 100',
    body: `<path d="M8 58Q14 52 26 50Q34 40 52 38Q60 32 66 36Q90 30 120 34Q150 36 166 48Q176 54 186 56Q210 58 236 64Q212 68 186 66Q172 70 160 72Q156 80 148 80L146 72Q120 76 96 74Q92 82 84 82L84 74Q64 72 52 66Q40 66 30 62Q18 62 8 58Z"/>
      <circle cx="58" cy="35" r="5"/>
      <path d="M12 56L-2 50M12 58L-3 58M13 60L-1 66" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  },
  // Lamotte's roundleaf bat, wings spread (generic leaf-nosed bat outline).
  'lamotte-bat': {
    viewBox: '0 0 200 100',
    body: `<path d="M100 34L95 24L92 36Q78 30 62 28Q34 30 6 42Q20 46 24 58Q34 50 44 54Q48 64 56 70Q64 60 74 62Q80 70 88 74Q92 66 95 64L97 74L100 70L103 74L105 64Q108 66 112 74Q120 70 126 62Q136 60 144 70Q152 64 156 54Q166 50 176 58Q180 46 194 42Q166 30 138 28Q122 30 108 36L105 24Z"/>`,
  },
};

export function illustration(h: Hotspot): string {
  const s = SILHOUETTES[h.id];
  const art = s
    ? `<svg class="silhouette" viewBox="${s.viewBox}" fill="currentColor" aria-hidden="true" focusable="false" overflow="visible">${s.body}</svg>`
    : `<span class="placeholder-glyph" aria-hidden="true">${glyphs[h.category]}</span>`;
  return art;
}
