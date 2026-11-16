// Generate WebP and AVIF versions of every photo and thumbnail in public/photos (CLAUDE.md §8:
// "convert to AVIF/WebP at build, keep JPEG fallback"). Run after copying/refreshing the JPEGs:
//   node scripts/make_photo_formats.mjs
// Outputs sit next to the JPEGs (<id>.webp, <id>.avif, thumb/<id>.webp, thumb/<id>.avif) and are committed,
// so the Vercel build does not need to run image encoders. Same pixels as the JPEGs (resized and
// recompressed copies of the Wikimedia Commons originals; attribution unchanged, see credits.json).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dirs = ['public/photos', 'public/photos/thumb'];
let before = 0, webp = 0, avif = 0, n = 0;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jpg'))) {
    const src = path.join(dir, f);
    const base = src.replace(/\.jpg$/, '');
    const img = sharp(src);
    await img.clone().webp({ quality: 72, effort: 6 }).toFile(`${base}.webp`);
    await img.clone().avif({ quality: 50, effort: 6 }).toFile(`${base}.avif`);
    before += fs.statSync(src).size;
    webp += fs.statSync(`${base}.webp`).size;
    avif += fs.statSync(`${base}.avif`).size;
    n++;
  }
}
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
console.log(`${n} images · JPEG ${mb(before)} · WebP ${mb(webp)} (${Math.round((webp / before) * 100)} %) · AVIF ${mb(avif)} (${Math.round((avif / before) * 100)} %)`);
