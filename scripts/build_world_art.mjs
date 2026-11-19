// Compress generated source art for runtime use; retain source hashes and generation provenance.
// Raw PNGs live outside Git. Committed WebP/JPEG/AVIF outputs are the portable runtime assets.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
sharp.concurrency(2);
const force = process.argv.includes('--force');
const exists = async (path) => { try { await fs.access(at(path)); return true; } catch { return false; } };
const root = new URL('../', import.meta.url);
const at = (p) => new URL(p, root);
const read = async (p) => JSON.parse(await fs.readFile(at(p), 'utf8'));
const write = (p, data) => fs.writeFile(at(p), JSON.stringify(data, null, p === 'public/data/content.json' ? 1 : 2) + '\n');
const manifest = await read('scripts/blender/reference/world-art/manifest.json');
await fs.mkdir(at('public/walk/art'), { recursive: true });
const content = await read('public/data/content.json');
const contentSource = await fs.readFile(at('public/data/content.json'), 'utf8');
const credits = await read('public/photos/credits.json');
const original = credits.filter((p) => !p.file.includes('reconstruction-'));
const originalMap = Object.fromEntries(content.hotspots.map((h) => [h.id, h.photos]));
try { await fs.access(at('scripts/blender/reference/world-art/documentary-map.json')); }
catch { await write('scripts/blender/reference/world-art/documentary-map.json', originalMap); }
await write('public/photos/documentary-credits.json', original);
const assetRecords = [];
try {
  await fs.access(at('public/walk/models/generated_sapling.glb'));
  assetRecords.push({ name: 'Animated generic sapling', author: 'Tech Guinée', license: 'Project reconstruction artwork', url: 'walk/models/generated_sapling.glb', provenance: 'scripts/blender/build_animated_sapling.py; Blender 5.3, looping branch animation' });
} catch { /* The Blender build may run after the first art preparation. */ }

for (const item of manifest) {
  const bytes = await fs.readFile(item.path);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const unchanged = item.sha256 === digest;
  item.sha256 = digest;
  item.method = 'OpenAI image generation';
  if (item.kind === 'material') {
    assetRecords.push({ name: item.key, author: 'Tech Guinée', license: 'Project reconstruction artwork', url: `walk/art/${item.key}.webp`, provenance: 'scripts/blender/reference/world-art/manifest.json' });
    const opaque = !['foliage', 'canopy'].includes(item.key);
    if (!force && unchanged && await exists(`public/walk/art/${item.key}.webp`) && (!opaque || await exists(`public/walk/art/${item.key}_nor.webp`))) continue;
    const size = item.key === 'foliage' || item.key === 'canopy' ? 1024 : 1024;
    const img = sharp(bytes).resize(size, size, { fit: 'fill' }).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    // Pad RGB into transparent pixels for clean alpha-tested mipmaps. Alpha itself is unchanged.
    const valid = new Uint8Array(size * size);
    for (let i = 0; i < valid.length; i++) valid[i] = data[i * 4 + 3] > 30 ? 1 : 0;
    for (let pass = 0; pass < 16 && ['foliage', 'canopy'].includes(item.key); pass++) {
      const next = valid.slice();
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (valid[i]) continue;
        const neighbor = [i - 1, i + 1, i - size, i + size].find((j) => valid[j]);
        if (neighbor === undefined) continue;
        for (let c = 0; c < 3; c++) data[i * 4 + c] = data[neighbor * 4 + c];
        next[i] = 1;
      }
      valid.set(next);
    }
    await sharp(data, { raw: info }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(at(`public/walk/art/${item.key}.webp`).pathname);
    if (opaque) {
      // Subtle illustrative bump only: colour is not a measured height map.
      const normal = Buffer.alloc(size * size * 3);
      const lum = (x, y) => { const i = (((y + size) % size) * size + (x + size) % size) * 4; return (data[i] + data[i + 1] + data[i + 2]) / 765; };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (lum(x - 1, y) - lum(x + 1, y)) * 0.8, dy = (lum(x, y - 1) - lum(x, y + 1)) * 0.8;
        const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 3;
        normal[i] = Math.round((dx / length * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      }
      await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90 }).toFile(at(`public/walk/art/${item.key}_nor.webp`).pathname);
    }
    continue;
  }
  const id = `reconstruction-${item.key}`;
  for (const [dir, width] of [['public/photos', 1536], ['public/photos/thumb', 480]]) {
    if (!force && unchanged && (await Promise.all(['jpg', 'webp', 'avif'].map((ext) => exists(`${dir}/${id}.${ext}`)))).every(Boolean)) continue;
    const image = sharp(bytes).resize({ width, withoutEnlargement: true });
    await Promise.all([
      image.clone().jpeg({ quality: 86 }).toFile(at(`${dir}/${id}.jpg`).pathname),
      image.clone().webp({ quality: 80, effort: 6 }).toFile(at(`${dir}/${id}.webp`).pathname),
      image.clone().avif({ quality: 54, effort: 4 }).toFile(at(`${dir}/${id}.avif`).pathname),
    ]);
  }
  const meta = await sharp(at(`public/photos/${id}.jpg`).pathname).metadata();
  const descriptions = {
    summit: ['Crête de prairie au-dessus des brumes', 'Grass-covered ridge above the mist'],
    cloudforest: ['Sous-bois humide avec mousse et brume', 'Moist forest understorey with moss and mist'],
    lowland: ['Forêt de piémont, racines et jeunes arbres', 'Foothill forest, roots and saplings'],
    stream: ['Ruisseau peu profond sous la forêt', 'Shallow stream beneath the forest canopy'],
    village: ['Maisons et cultures dans un village fictif', 'Houses and crops in a fictional village'],
    savanna: ['Prairies et arbres épars sous un ciel voilé', 'Grassland and scattered trees under a hazy sky'],
    lamco: ['Évocation d’un ancien lac de carrière et de ses pentes végétalisées', 'Illustration of a former quarry lake and revegetated slopes'],
    ridge: ['Crête, affleurements rocheux et ravins forestiers', 'Ridge, rock outcrops and forested ravines'],
  };
  const altFr = `${descriptions[item.key][0]} — reconstitution numérique, point de vue indicatif.`;
  const altEn = `${descriptions[item.key][1]} — digital reconstruction, illustrative viewpoint.`;
  assetRecords.push({ name: item.key, author: 'Tech Guinée', license: 'Project reconstruction artwork', url: `photos/${id}.jpg`, provenance: 'scripts/blender/reference/world-art/manifest.json' });
  credits.push({ file: `photos/${id}.jpg`, thumb: `photos/thumb/${id}.jpg`, width: meta.width, height: meta.height,
    commons_title: `Digital reconstruction: ${item.key}`, source_url: './credits.html', author: 'Tech Guinée',
    license: 'Reconstitution numérique / Digital reconstruction', license_url: './credits.html',
    attribution: 'Tech Guinée — digital reconstruction; illustrative viewpoint, not a documentary photograph.',
    alt_fr: altFr, alt_en: altEn, hotspots: [], reconstruction: true });
}

const themes = {
  'richard-molard': 'summit', 'grands-rochers': 'ridge', 'pierre-richaud': 'ridge', 'montane-grassland': 'summit',
  'cloud-forest': 'cloudforest', 'lowland-forest': 'lowland', 'savanna-fire': 'savanna', cavally: 'stream',
  'viviparous-toad': 'summit', 'otter-shrew': 'stream', 'lamotte-bat': 'ridge', 'bossou-chimpanzees': 'lowland',
  'ireb-bossou': 'village', 'green-corridor': 'lowland', 'cultural-landscape': 'village', 'cegens-gbakore': 'village',
  nzo: 'village', yeale: 'village', 'yekepa-lamco': 'lamco', 'mining-enclave': 'ridge', tripoint: 'ridge',
  'unesco-inscription': 'summit', 'danger-list': 'cloudforest',
};
const generated = credits.filter((p) => p.file.includes('reconstruction-'));
// Re-running the pipeline is idempotent, including the credit registry.
const unique = [...new Map([...original, ...generated].map((p) => [p.file, p])).values()];
for (const h of content.hotspots) {
  const key = themes[h.id];
  if (!key) throw new Error(`Missing reconstruction theme for ${h.id}`);
  h.photos = [`reconstruction-${key}`];
  unique.find((p) => p.file === `photos/reconstruction-${key}.jpg`).hotspots.push(h.id);
}
let photoIndex = 0;
const nextContent = contentSource.replace(/"photos": \[[\s\S]*?\]/g, (_match, offset) => {
  const indent = contentSource.slice(contentSource.lastIndexOf('\n', offset) + 1, offset);
  const photos = content.hotspots[photoIndex++].photos;
  return `"photos": [\n${indent} ${JSON.stringify(photos[0])}\n${indent}]`;
});
if (photoIndex !== content.hotspots.length) throw new Error('Unexpected card-image source layout');
await fs.writeFile(at('public/data/content.json'), nextContent);
await write('public/photos/credits.json', unique);
await write('scripts/blender/reference/world-art/manifest.json', manifest);
await write('public/credits.json', {
  project: 'Monts Nimba — Tech Guinée', disclosure_fr: 'Reconstitution numérique : les images sont illustratives ; les textes gardent leurs sources documentaires.',
  disclosure_en: 'Digital reconstruction: images are illustrative; text retains its documentary sources.',
  assets: assetRecords,
  data: [
    { name: 'Copernicus DEM', author: 'DLR / Airbus / EU / ESA', license: 'Copernicus DEM licence', url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM', attribution: 'Contains modified Copernicus DEM GLO-30 data © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.' },
    { name: 'ESA WorldCover', author: 'ESA WorldCover consortium', license: 'CC BY 4.0', url: 'https://esa-worldcover.org', attribution: 'Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).' },
    { name: 'Canopy height', author: 'Meta / WRI; Tolan et al. (2024)', license: 'CC BY 4.0', url: 'https://registry.opendata.aws/dataforgood-fb-forests/' },
    { name: 'OpenStreetMap', author: '© OpenStreetMap contributors', license: 'ODbL', url: 'https://www.openstreetmap.org/copyright' },
    { name: 'WDPA', author: 'UNEP-WCMC and IUCN (2026), Protected Planet', license: 'Non-commercial terms', url: 'https://www.protectedplanet.net' },
    { name: 'geoBoundaries', author: 'William & Mary geoLab', license: 'Guinea CC BY-SA 2.0; Liberia CC BY 3.0 IGO; Côte d’Ivoire public domain', url: 'https://www.geoboundaries.org' },
    { name: 'Species records', author: 'GBIF contributors', license: 'Per-dataset; see worldpack/species/gbif_datasets.json', url: 'https://www.gbif.org' },
    { name: 'Wikidata', author: 'Wikidata contributors', license: 'CC0', url: 'https://www.wikidata.org' },
    { name: 'Fonts', author: 'Inter / Fraunces contributors', license: 'SIL OFL 1.1', url: 'https://fonts.google.com' },
    { name: 'three.js', author: 'three.js contributors', license: 'MIT', url: 'https://threejs.org' },
  ],
  libraryAssets: [...await read('public/walk/tex/credits.json'), ...await read('public/walk/models/credits.json')],
  documentaryReferences: original,
});
const registry = await read('public/credits.json');
await fs.writeFile(at('CREDITS.md'), '# Monts Nimba — credits\n\nDigital reconstruction by Tech Guinée. Images illustrate habitats and scenery; they are not documentary photographs or exact surveyed viewpoints. Original licensed photographs remain in assets/photos/ and public/photos/documentary-credits.json as references.\n\n' +
  [...registry.assets, ...registry.data, ...registry.libraryAssets].map((r) => `- ${r.name} — ${r.author ?? r.authors?.join(', ') ?? ''} — ${r.license}. ${r.url}${r.attribution ? `\n  ${r.attribution}` : ''}`).join('\n') + '\n\nPer-record species dataset citations: worldpack/species/gbif_datasets.json. Per-image documentary reference credits: public/photos/documentary-credits.json. Detailed generation records and prompts: scripts/blender/reference/world-art/manifest.json.\n');
console.log(`Prepared ${manifest.length} generated assets; all ${content.hotspots.length} cards use reconstructed landscapes.`);
