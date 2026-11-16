import { defineConfig } from 'vite';

// Relative base so the build works from any static host or sub-folder (GitHub Pages, Hostinger, …).
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true, host: true },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
});
