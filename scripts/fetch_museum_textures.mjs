// Download CC0 scanned building-material textures from Poly Haven (polyhaven.com) for the virtual museum
// (floor, wall plaster, oak for benches/frames), re-encoded as WebP. Generic materials, never presented as Nimba.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch_museum_textures.mjs  → public/musee/tex/<role>_{diff,nor,rough}.webp + credits.json
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = 'public/musee/tex';
// role → [Poly Haven asset id, diffuse size, maps]
const SET = {
  floor: ['laminate_floor_02', 1024, ['nor_gl', 'Rough']], // light oak planks, 1.7 m tile
  plaster: ['white_plaster_02', 512, ['nor_gl']],          // wall plaster, 1 m tile
  oak: ['white_oak_veneer', 512, ['nor_gl']],               // benches, plinth tops, frames
};
const KIND = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };

fs.mkdirSync(OUT, { recursive: true });
const credits = [];
for (const [role, [id, size, extra]] of Object.entries(SET)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  for (const key of ['Diffuse', ...extra]) {
    const url = files[key]['1k'].jpg.url;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const out = path.join(OUT, `${role}_${KIND[key]}.webp`);
    const s = key === 'Diffuse' ? size : 512;
    let img = sharp(buf).resize(s, s, { fit: 'fill' });
    if (key === 'Rough') img = img.greyscale();
    // Wall plaster: keep only its fine variation around a near-white tone (the scanned plaster is mid-grey).
    if (role === 'plaster' && key === 'Diffuse') img = img.greyscale().linear(0.32, 197);
    await img.webp({ quality: key === 'Diffuse' ? 80 : 84, effort: 5 }).toFile(out);
    console.log(out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
  }
  credits.push({ role, id, name: info.name, authors: Object.keys(info.authors ?? {}), size_m: (info.dimensions?.[0] ?? 1000) / 1000, license: 'CC0 1.0', url: `https://polyhaven.com/a/${id}` });
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
