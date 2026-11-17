// Download CC0 scanned textures from Poly Haven (polyhaven.com, CC0 – no attribution required, credited anyway)
// for walk mode's high-quality look, and re-encode them as WebP. Generic surfaces, never presented as Nimba.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch_textures.mjs (behind a proxy)   → public/walk/tex/<role>_{diff,nor}.webp + credits.json
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = 'public/walk/tex';
// role → Poly Haven asset id
const SET = {
  litter: 'forest_leaves_02',          // broadleaf leaf litter (forest floor)
  laterite: 'red_laterite_soil_stones', // red iron-rich soil with stones
  turf: 'leafy_grass',                  // grassy ground
  rock: 'rock_boulder_dry',             // dry rock / boulders
  moss: 'mossy_rock',                   // mossy rock (cloud forest)
  bark: 'bark_brown_02',                // brown bark
  barkGrey: 'bark_platanus',            // smooth mottled bark
  palm: 'palm_tree_bark',               // palm trunk
};

fs.mkdirSync(OUT, { recursive: true });
const credits = [];
for (const [role, id] of Object.entries(SET)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  for (const [kind, key, q, size] of [['diff', 'Diffuse', 76, 1024], ['nor', 'nor_gl', 82, 512]]) {
    const url = files[key]['1k'].jpg.url;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const out = path.join(OUT, `${role}_${kind}.webp`);
    await sharp(buf).resize(size, size, { fit: 'fill' }).webp({ quality: q, effort: 5 }).toFile(out);
    console.log(out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
  }
  credits.push({ role, id, name: info.name, authors: Object.keys(info.authors ?? {}), license: 'CC0 1.0', url: `https://polyhaven.com/a/${id}` });
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
