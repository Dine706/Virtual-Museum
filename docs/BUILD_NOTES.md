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

## M1 – Terrain
* **Data bug fixed in the kit:** `terrarium_504.png` had ≈ 9,400 spike pixels (up to 233 m off). `build_terrain.py` resized the *encoded* Terrarium RGB image with bilinear filtering. That interpolates R and G separately and breaks every pixel where R rolls over (each 256 m of elevation). Fixed the script (2×2 mean of the heights, then encode) and regenerated `terrarium_504.png` from the lossless `terrarium.png` (round-trip error < 0.003 m, 0 pixels > 50 m from their 3×3 median). The file is now 531 KB instead of 470 KB.
  `heightmap_512_16bit.png` is single-channel, so bilinear resizing it is fine. The GLBs are not used.
* **Base colour from land cover, not `albedo_*.jpg`:** the albedo is `class colour × (0.45 + 0.9·hillshade)` with the hillshade sun fixed in the north-west (see `build_landcover.py`). That baked light would contradict the Clear (SE sun) and Golden-hour (W sun) presets. The terrain is instead coloured from `landcover_classes.png` (76 KB, also needed by the click readout) with a natural palette, softened edges and real lighting. It also saves ≈ 150 KB on mobile.
* Mesh built in code from the heightfield: high 504² (`terrarium.png`), mid 256² and low 160² (`terrarium_504.png`). Normals come from central differences of the heightfield. `Uint32` index.
* Vertical exaggeration 1.8× applied as `y = h · 1.8` (sea-level datum), so the pin and cloud heights follow the same rule.
* **M1 acceptance check** (`?debug=1` shows it): high tier, DEM max **1,755.3 m at x 1303, z −200**; `richard-molard` projects to x 1291, z −210 (16 m away, same summit), DEM there 1,749.5 m. Mid tier (504² data): max 1,747.9 m, 27 m away.
* FPS: the render loop renders on demand, so the debug meter counts rendered frames only. Software GL (SwiftShader) in this container can't say anything about real 60 fps; measure on hardware at M8.

## M2 – Look
* One custom terrain `ShaderMaterial` (`scene/terrainMaterial.ts`) instead of `MeshStandardMaterial`, so there's full control of light, fog and mist:
  * **Per-pixel normals** from a half-float (R16F) height texture, so the mid/low meshes still get 30 m lighting detail.
  * **Soft terrain self-shadows** ray-marched towards the sun through the height texture: 24 steps on high, 12 on mid, off on low. This gives the long golden-hour shadows.
  * Land-cover colour, an altitude grade (montane forest above ≈ 1,000 m, golden grassland above ≈ 1,400 m), slope rock (> ≈ 38° on the *true* surface, `#6E6252`) and 3-scale value noise with a micro-normal to hide the 30 m DEM. Fine detail fades with distance (it aliased into a stipple pattern otherwise).
  * **Exponential height fog** (denser in the valleys) whose colour is the sky's horizon colour in the view direction, so terrain, clouds and sky fade into the same haze.
  * **Edge fade:** the last 4.5 km of the 31 km tile blend into that haze, so no square edge is visible.
  * **Sea of clouds:** the view-ray path length below a noisy mist level, plus 1–3 cloud planes that fade where the ground rises through them (sampled from the height texture). No depth texture and no hard intersection lines. Clouds also fade within ≈ 3–7 km of the camera so they never block the close view.
* Presets (`scene/atmosphere.ts`) follow DESIGN.md §1/§10. Everything is cross-faded over 1.2 s (instant under reduced motion). Golden hour adds an **away-from-sun horizon colour** (dusty blue-grey): with a single orange horizon the whole scene went monochrome brown.
* Cloud drift is 6 m/s rather than the 0.6 m/s in DESIGN.md §10; at 0.6 m/s the motion is invisible from 10+ km away. It animates continuously only on the high tier. On mid/low, time advances only while frames are being rendered (render-on-demand), and nothing drifts under `prefers-reduced-motion`.
* The low tier has no cloud planes, but the Mist preset still shows the sea of clouds through the terrain shader.
* **Screenshots in this container use SwiftShader (CPU)**, so a 1230×1770 frame with the full shader takes seconds. `screens.mjs` now opens a fresh page per shot. Performance has to be judged on real devices (M8).
