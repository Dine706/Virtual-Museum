import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Files in public/ that the app never loads: dev references and inputs for GDAL/Python only.
// They stay in the repo (scripts/ rebuild them) but are not shipped (CLAUDE.md M10).
const NOT_SHIPPED = [
  'data/preview.png',
  'data/heightmap_16bit.png',
  'data/heightmap_512_16bit.png',
  'data/hillshade.png',
  'data/albedo_1024.jpg',
  'data/albedo_2048.jpg',
  'data/terrain_lod0.glb',
  'data/terrain_lod1.glb',
  'data/hotspots.geojson',
];

function pruneDist(): Plugin {
  let outDir = 'dist';
  return {
    name: 'nimba-prune-dist',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      for (const f of NOT_SHIPPED) fs.rmSync(path.resolve(outDir, f), { force: true });
    },
  };
}

// Relative base so the build works from any static host or sub-folder (Vercel, GitHub Pages, Hostinger, …).
export default defineConfig({
  base: './',
  plugins: [pruneDist()],
  // Vercel sets VERCEL_ENV: 'preview' for the test area (branch claude/test-area), 'production' for the live site.
  define: { __TEST_AREA__: JSON.stringify(process.env.VERCEL_ENV === 'preview' || process.env.NIMBA_TEST_AREA === '1') },
  server: { port: 5173, strictPort: true, host: true },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
});
