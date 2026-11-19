// Encode original generated artwork at its native resolution; no enlargement or claimed scan detail.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
const root = new URL('../', import.meta.url);
const at = (p) => new URL(p, root);
const prompts = JSON.parse(await fs.readFile(at('scripts/realism-prompts.json'), 'utf8'));
await fs.mkdir(at('public/landscape/'), { recursive: true });
const records = [];
for (const p of prompts) {
  const source = `scripts/blender/reference/landscape-art/${p.key}.png`;
  const input = await fs.readFile(at(source));
  const info = await sharp(input).metadata();
  const output = `public/landscape/${p.key}.webp`;
  await sharp(input).webp({ quality: 94, alphaQuality: 100, effort: 6 }).toFile(at(output).pathname);
  records.push({ key: p.key, source, file: output, width: info.width, height: info.height,
    sourceSha256: crypto.createHash('sha256').update(input).digest('hex'),
    outputSha256: crypto.createHash('sha256').update(await fs.readFile(at(output))).digest('hex'),
    method: p.method || 'OpenAI image generation', ...(p.jobId && { jobId: p.jobId, outputUrl: p.outputUrl }), prompt: p.prompt,
    reconstruction: 'Generic illustrative environment; not surveyed imagery or a species identification.' });
}
await fs.writeFile(at('scripts/blender/reference/landscape-art/manifest.json'), JSON.stringify(records, null, 2) + '\n');
const credits = JSON.parse(await fs.readFile(at('public/credits.json'), 'utf8'));
credits.assets = credits.assets.filter((a) => !a.url.startsWith('landscape/'));
for (const p of prompts) credits.assets.push({ name: p.key, author: 'Tech Guinée', license: 'Project reconstruction artwork',
  url: `landscape/${p.key}.webp`, provenance: 'scripts/blender/reference/landscape-art/manifest.json' });
await fs.writeFile(at('public/credits.json'), JSON.stringify(credits, null, 2) + '\n');
console.log(records.map((p) => `${p.key}: ${p.width}×${p.height}`).join('\n'));
