// Download CC0 scanned plant/rock models from Poly Haven (polyhaven.com, CC0) and optimise them for the web:
// simplified meshes, WebP textures ≤ 1024 px, meshopt compression → public/walk/models/<id>.glb + credits.json.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/fetch_models.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = 'public/walk/models';
const TMP = '.worldpack-cache/models';
// id → target triangle ratio for simplification
const SET = {
  fern_02: 0.35,               // fern (forest floor, stream banks)
  calathea_orbifolia_01: 0.3,  // broad-leaved forest herb (generic stand-in, not a Nimba species)
  moss_01: 0.5,                // moss cushion (cloud forest)
  rock_moss_set_01: 0.25,      // mossy rocks (cloud forest)
  rock_07: 0.25,               // rock outcrop (summit)
  single_root: 0.3,            // surface root (buttress feet)
};

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const credits = [];
for (const [id, ratio] of Object.entries(SET)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  const g = files.gltf['1k'].gltf;
  const dir = path.join(TMP, id);
  fs.mkdirSync(dir, { recursive: true });
  const gltfPath = path.join(dir, path.basename(new URL(g.url).pathname));
  if (!fs.existsSync(gltfPath)) {
    fs.writeFileSync(gltfPath, Buffer.from(await (await fetch(g.url)).arrayBuffer()));
    for (const [rel, f] of Object.entries(g.include ?? {})) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(await (await fetch(f.url)).arrayBuffer()));
    }
  }
  const out = path.join(OUT, `${id}.glb`);
  execFileSync('npx', ['gltf-transform', 'optimize', gltfPath, out,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
    '--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.002'], { stdio: 'inherit' });
  console.log(out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
  credits.push({ id, name: info.name, authors: Object.keys(info.authors ?? {}), license: 'CC0 1.0', url: `https://polyhaven.com/a/${id}` });
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
