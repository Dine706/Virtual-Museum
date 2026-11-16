# Build notes – Monts Nimba 3D demo

Running log of decisions, measured budgets and issues (CLAUDE.md §15).

## M0 – Scaffold
* Scaffolded **by hand** (package.json, tsconfig, vite.config, index.html, src/) instead of running `npm create vite` in place, so the kit could never be emptied by the scaffolder.
* Versions resolved on 2026-11-16: three 0.187.0, vite 8.3.8, typescript 7.0.2 (native compiler, `moduleResolution: bundler`), vite-plugin-pwa 2.0.0, @fontsource-variable/fraunces + inter 5.3.0.
* `npm audit` reports 6 low/moderate advisories, all in build-time dependencies of vite-plugin-pwa (glob/minimatch via workbox). Nothing ships to the browser; the only "fix" offered is a downgrade to vite-plugin-pwa 1.x. Left as is; re-check at M10.
* Photos copied to `public/photos/` (+ `thumb/`, `credits.json`, `alt_text.json`). URLs are built from the photo id (`photos/<id>.jpg`, `photos/thumb/<id>.jpg`), never from the `file` field. `assets/photos/` stays as the source of truth for `scripts/fetch_photos.py`.
* `vite.config.ts` uses `base: './'`, so the build runs from any folder on any static host. All fetches go through `import.meta.env.BASE_URL`.
* The loading screen is inline in `index.html` (critical CSS, ≈ 2 KB). Its ridge line is the **real skyline seen from the south**: the maximum DEM height per column of `terrarium_504.png`.
* URL flags (`src/flags.ts`): `?skipintro=1`, `?debug=1`, plus `?tier=`, `?mode=`, `?atmo=` for testing.
* `scripts/screens.mjs` now falls back to a global Playwright install, waits for `<body data-ready="1">` (set once the first frame has rendered) and also captures the title card. Use `--atmo=golden|mist`, `--only=phone` and `--prefix=` as needed.
