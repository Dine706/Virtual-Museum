import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';

const content = JSON.parse(await fs.readFile('public/data/content.json', 'utf8'));
const credits = JSON.parse(await fs.readFile('public/photos/credits.json', 'utf8'));
const manifest = JSON.parse(await fs.readFile('scripts/blender/reference/world-art/manifest.json', 'utf8'));
assert.equal(content.hotspots.length, 23);
for (const h of content.hotspots) {
  assert.equal(h.photos.length, 1, `${h.id}: one reviewed habitat illustration`);
  for (const id of h.photos) {
    assert.ok(id.startsWith('reconstruction-'));
    const credit = credits.find((p) => p.file === `photos/${id}.jpg`);
    assert.ok(credit?.reconstruction, `${h.id}: reconstruction provenance`);
    assert.match(credit.alt_fr, /reconstitution numérique/);
    assert.match(credit.alt_en, /digital reconstruction/);
    for (const dir of ['public/photos', 'public/photos/thumb']) for (const ext of ['jpg', 'webp', 'avif']) {
      const meta = await sharp(`${dir}/${id}.${ext}`).metadata();
      assert.ok(meta.width > 0 && meta.height > 0);
    }
  }
}
for (const source of manifest) {
  assert.ok(source.prompt?.length > 100, `${source.key}: retained prompt`);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  // Raw source presence is optional for runtime, but when retained its integrity must match.
  const raw = await fs.readFile(source.path).catch(() => null);
  if (raw) assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), source.sha256);
}
for (const name of ['bark', 'litter', 'laterite', 'grass', 'rock', 'moss', 'palm', 'mud', 'sand']) {
  for (const suffix of ['', '_nor']) {
    const meta = await sharp(`public/walk/art/${name}${suffix}.webp`).metadata();
    assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
  }
}
const binary = await fs.readFile('public/walk/models/generated_sapling.glb');
const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
assert.equal(gltf.animations.length, 1);
assert.ok(gltf.animations[0].channels.length >= 9);
assert.ok(gltf.extensionsUsed.includes('EXT_meshopt_compression'));
assert.ok(binary.length < 1024 * 1024, 'animated model stays below 1 MB');
console.log('PASS 23 reconstructed cards, encoded images, provenance hashes, and compressed Blender animation');
const landscape = JSON.parse(await fs.readFile('scripts/blender/reference/landscape-art/manifest.json', 'utf8'));
assert.equal(landscape.length, 5);
for (const asset of landscape) {
  for (const [file, hash] of [[asset.source, asset.sourceSha256], [asset.file, asset.outputSha256]]) {
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash);
  }
  const meta = await sharp(asset.file).metadata();
  assert.equal(meta.width, asset.width); assert.equal(meta.height, asset.height);
  assert.ok(asset.prompt.length > 100);
}
console.log('PASS five native-resolution landscape assets, exact prompts and source/runtime hashes');
