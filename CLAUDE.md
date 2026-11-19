# CLAUDE.md – Monts Nimba interactive 3D demo (Phase 0)

You are building a **beautiful, realistic, interactive 3D web demo of the Monts Nimba massif** (Guinea / Côte d'Ivoire / Liberia). People rotate a real terrain model, click parts of the mountain, and get sourced information. This file is the single brief. Read it fully, then read `DESIGN.md`, `docs/GEO_DATA.md` and `docs/DATA_LICENCES.md`. Everything you need (terrain, land cover, 23 hotspots in FR/EN, 32 licensed photos) is already in this folder: **do not invent data, coordinates, photos or facts.**

## 1. Why this exists
* **Project:** Phase 0 pilot for fiche **P19 – "Musée virtuel et patrimoines UNESCO"** of the **CSIG** (Cité des Sciences et de l'Innovation de Guinée, Conakry, csig.edu.gn). P19 budgets 1,500,000 USD as one lump sum, and names the Monts Nimba as the pilot.
* **Author / owner:** Dean Diallo, building under **Tech Guinée**. This demo is **an unofficial prototype** shown to CSIG to win approval of a funded pilot. It must look like a finished product in 60 seconds.
* **Web-first** on purpose: most Guinean users are on mid/low-end Android phones on 3G/4G with data costs. No app store, no install, works as a link shared on WhatsApp.
* **Bilingual FR (default) / EN** with an instant toggle. French is the primary audience language; check accents.
* **Credit footer (plain text, no logos):** "Prototype non officiel – Phase 0 · Un projet Tech Guinée pour le CSIG, fiche P19" / "Unofficial prototype – Phase 0 · A Tech Guinée project for CSIG, fiche P19". Never draw UNESCO/CSIG/OIPR logos.

## 2. Audience and user flows
| Persona | Device | Goal |
|---|---|---|
| CSIG decision-maker / jury | laptop, projector, tablet | "Wow" in 10 s, credible science, clear path to full museum |
| Student / teacher in Guinea | Android phone, 3G/4G, 2–3 GB RAM | Explore, learn, read in French |
| Diaspora / international visitor | any | English, share link |

Flows (all must work with touch, mouse and keyboard):
1. **Arrival** → logo-less title card + "Explorer / Explore" → cinematic flyover (≈ 12 s, skippable, skipped if `prefers-reduced-motion`) → free orbit.
2. **Click a pin** → camera glides to the spot (≤ 1.2 s) → info panel opens (bottom-sheet on phone, side panel on tablet/desktop) → read, swipe photo gallery, see sources, "Next/Previous hotspot".
3. **Click anywhere on the terrain** → small readout: elevation, land-cover class, country/inside reserve?, nearest hotspot (tap to open). This is what makes "click parts of the massif" feel real.
4. **Mode toggle** Nature / Culture / Conservation: filters pins and switches overlays (see DESIGN.md §7).
5. **Language toggle** FR/EN (persist in localStorage, update `<html lang>`).
6. **Time/atmosphere toggle**: Clear / Golden hour / Mist (cloud sea).
7. **List view** (a real `<ul>` of hotspots): accessible alternative, WebGL-failure fallback and navigation aid.
8. **About / Credits** sheet: photo credits (`assets/photos/credits.json`), data licences (`docs/DATA_LICENCES.md`), "how to correct us" contact placeholder.

## 3. Features
**MVP (must ship):** 3D terrain from the real DEM, baked land-cover colouring, sky + fog + cloud layer, 23 hotspot pins with bilingual panels + photos + sources, free-click readout, reserve boundary (WDPA derivative) and approximate mining enclave overlay, modes, language toggle, flyover, responsive layouts, loading screen with progress, list-view fallback, credits, offline PWA shell.
**Stretch (only after MVP passes the checklist in §14):** guided "Tour" (ordered hotspots 1→23 with auto-camera), day/night, subtle bird/ambient audio with mute default, share-this-hotspot deep links (`#/h/viviparous-toad`), WebXR (`immersive-vr` on phones with Cardboard-like viewer) – **do not start before MVP is accepted**, ridge elevation profile chart, vertical-exaggeration slider.
**Out of scope:** user accounts, backend, analytics that track people, drone/photogrammetry, anything needing a login, any real-time external API.

## 4. Stack decision (final – do not re-litigate)
**Vite + TypeScript + three.js (vanilla, tree-shaken) + hand-written DOM/CSS UI. No React, no R3F, no CesiumJS, no MapLibre.**

| Option | Verdict | Why |
|---|---|---|
| **three.js vanilla + Vite** | **Chosen** | Full control of shaders, camera and fog for a cinematic mountain; smallest bundle (~150–200 KB gz tree-shaken); our terrain is a bounded 31 × 31 km tile so we don't need streaming; everything works offline; the UI is just ~25 pins and one panel, so a framework adds weight without value. |
| React Three Fiber | Rejected | Adds React + reconciler (~+45 KB gz), and our scene is imperative (camera tweens, custom shader, raycast on a heightfield). Fine tool, wrong cost/benefit here. |
| CesiumJS | Rejected | ~3–4 MB core, wants tiles/imagery streamed from a server, great for globes, wrong for 3G and offline; Guinea-quality imagery is poor at this zoom; no cinematic control. |
| MapLibre GL (terrain) | Rejected for the main view | Excellent 2.5D maps and tiny, but hard to get a "wow" 3D mountain (no custom sky/cloud/mist, limited camera). Keep in mind for a future 2D "plan" tab. |
| Babylon / PlayCanvas | Rejected | Larger, no benefit here. |

Versions known to exist on 2026-11-15 (check with `npm view`): `three@0.187`, `vite@8`, `typescript@7`, `vite-plugin-pwa@2`, `@types/three@0.187`. If a newer major breaks the API, pin to what `npm create vite@latest` + `npm i three` resolves and move on. Optional: `gltfpack`/`meshoptimizer` for mesh compression, `@fontsource-variable/fraunces` + `@fontsource-variable/inter` for self-hosted Google Fonts.

## 5. Data inventory (all under `public/data/`, already generated)
| File | Size | Use |
|---|---|---|
| `terrarium.png` (1008²) / `terrarium_504.png` (504²) | 2.0 MB / 0.47 MB | **Browser heightmap.** Decode `h = R*256 + G + B/256 − 32768` (metres). Use 8-bit RGB: **browsers decode 16-bit PNG to 8-bit in canvas, so do NOT load `heightmap_16bit.png` in the browser** – it is for GDAL/Python only. |
| `albedo_2048.jpg` / `albedo_1024.jpg` | 0.65 MB / 0.22 MB | Baked base colour (WorldCover colours × hillshade). Tier: desktop 2048, others 1024. Add procedural detail in the shader. |
| `landcover_classes.png` | 76 KB | 8-bit class code (10 tree, 20 shrub, 30 grass, 40 crop, 50 built, 60 bare, 80 water, 90 wetland) for the click readout and for habitat tinting. |
| `hillshade.png` | 0.8 MB | Optional (AO-like multiply, or 2D minimap). |
| `terrain_lod0.glb` (257²) / `terrain_lod1.glb` (129²) | 3.7 MB / 0.9 MB | Ready-made meshes (uncompressed). **Optional** – prefer building the mesh from `terrarium*.png` in code (smaller download). Use the GLBs if you want a zero-code first render. |
| `terrain_meta.json` | 1 KB | bbox, pixel size, extent in metres, projection formula, min/max. |
| `reserve_boundary.geojson` | 13 KB | Two simplified WDPA polygons (Guinea, Côte d'Ivoire). Non-commercial licence, see `docs/DATA_LICENCES.md`. |
| `borders_clipped.geojson` | 4 KB | National outlines clipped to the window (approximate). |
| `mining_enclave_osm.geojson` | 1 KB | **Approximate** OSM polygon of the Guinean mining enclave (≈ 269 ha). Always label "approximate / OSM". |
| `hotspots.geojson` | 8 KB | Derived from content.json with DEM-sampled elevation and local x,z. |
| `content.json` | 74 KB | **All text content.** Schema in §9. |
| `preview.png` | 1.5 MB | Quick look; **not shipped in the app** (dev reference only). Delete from production build. |
| `../assets/photos/*.jpg`, `thumb/*.jpg`, `credits.json`, `alt_text.json` | 32 photos ≈ 13 MB total | 1600 px originals (≈ 250–600 KB each) and 480 px thumbs. Copy to `public/photos/` at M0. |

**World coordinates (scene units = metres):** `x = (lon − lon0)·111320·cos(lat0)` (east +), `z = −(lat − lat0)·110574` (north = −z), `y = elevation`. `lon0 = −8.42`, `lat0 = 7.62` exactly as in `terrain_meta.json`. Terrain extent ≈ 30.9 km × 31.0 km, relief 353–1755 m. At true scale the massif looks flat: **default vertical exaggeration 1.8× (slider 1×–3×)**; remember to scale hotspot y too.

Regenerate anything with `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt && .venv/bin/python scripts/build_terrain.py` (also `fetch_dem.sh` with GDAL, `build_landcover.py`, `fetch_boundaries.py`, `fetch_photos.py` – note: `fetch_photos.py` overwrites `credits.json` and thus the alt text; `alt_text.json` is the backup).

## 6. Rendering plan
1. **Terrain mesh** built once in a Web Worker (or main thread with a progress bar): decode `terrarium*.png` via `createImageBitmap` + `OffscreenCanvas` → `Float32Array` heights → `BufferGeometry` grid. Tiers: **high** 504 × 504 segments (252k verts), **mid** 256 × 256, **low** 160 × 160. Compute normals from the heightfield (central differences), not `computeVertexNormals`, for speed. Index buffer `Uint32`.
2. **Material:** `MeshStandardMaterial` + `onBeforeCompile`, or a small `ShaderMaterial`: base = `albedo` texture; add slope-based rock (steep > 38° → grey-brown `#6E6252`), altitude-based grass/forest tint, **high-frequency noise** (triplanar or 2-octave value noise) to hide the 30 m DEM resolution at close range; hemisphere light + one directional sun; fog.
3. **Honest resolution:** the DEM is 30 m, so extreme close-ups look smooth. Keep minimum camera distance ≈ 700 m above terrain, use fog/mist to hide it, and let **photos** in the panel carry the close-up realism.
4. **Sky & atmosphere:** gradient sky dome (three `Sky` addon or custom shader), exponential fog tinted by time-of-day, **cloud layer** = 2–3 large alpha-noise planes (or a single noise-displaced plane) at ≈ 1,250–1,500 m drifting slowly, thickest in valleys (Mist preset = "sea of clouds" below the ridge, summit pokes above). No post-processing on low tier; optional bloom/SSAO only on high.
5. **Overlays (draped lines):** sample height per vertex of the GeoJSON ring, offset +15 m, `Line2`/thick lines or thin `LineLoop` with `depthTest` on. Boundary = amber `#E3B04B`, enclave = dashed terracotta `#C8553D` with label "approximate", borders = thin white 40 % dashed.
6. **Pins:** 23 DOM buttons positioned each frame from `project()` (fast, crisp text, accessible, no sprites/atlas). Hide those behind the terrain by comparing against a **heightfield ray-march** from camera to pin (cheap, 64 steps) or by sampling a depth buffer once per second. Pin style in DESIGN.md §6.
7. **Picking:** do NOT raycast the 250k-triangle mesh. Ray-march the heightmap array analytically (step 20–40 m, then bisection). Returns world point → lon/lat → elevation, land-cover class, inside-reserve test (point-in-polygon on the two WDPA rings), country (nearest/inside outline; if uncertain say "near the tri-border").
8. **Camera:** custom orbit (OrbitControls is fine) with damping, `minPolarAngle 15°`, `maxPolarAngle 80°` (never below horizon), `minDistance 700 m`, `maxDistance 38 km`, pan limited to the window, pinch/rotate on touch, double-tap = fly-to. Camera tweens for hotspots use `camera` hints in `content.json` (`distance_m`, `azimuth_deg`, `elevation_deg`) with ease-in-out (cubic), 1.0–1.4 s.
9. **Flyover:** waypoints (lon, lat, height above terrain m, look-at): start NE high (-8.30, 7.74, 6000) looking SW along the ridge → low pass over Pierre Richaud/Grands Rochers (-8.37, 7.67, 2200) → summit Richard-Molard (-8.4083, 7.6219, 1800) → pull back to the default orbit (azimuth 215°, elevation 38°, distance 14 km). CatmullRom spline, 12 s, ease-in-out. Skip with any tap/Esc.
10. **Render loop:** render on demand when idle (no animation, no input → no frames) to save phone battery; 60 fps target desktop, ≥ 30 fps mid-range phone. Cap DPR: high 2, mid 1.5, low 1.

## 7. Device tiers and auto-quality
Detect once (`navigator.deviceMemory`, `hardwareConcurrency`, `matchMedia('(pointer:coarse)')`, screen width, `renderer.capabilities`), then **measure FPS for the first 2 s after the flyover starts and step down one tier if < 28 fps** (reduce segments → DPR → clouds → shadows/AO). Persist the result. A visible "Quality: Auto / High / Low" control lives in the About sheet.

| Tier | Typical device | Terrain | Textures | Extras |
|---|---|---|---|---|
| High | desktop/laptop, new iPad/iPhone | 504² mesh, `terrarium.png`, `albedo_2048` | DPR ≤ 2 | clouds + soft fog + noise detail, optional bloom |
| Mid | 2–4 GB Android, older iPad | 256² mesh, `terrarium_504.png`, `albedo_1024` | DPR ≤ 1.5 | clouds simplified |
| Low | ≤ 2 GB RAM or < 28 fps | 160² mesh, `terrarium_504.png`, `albedo_1024` | DPR 1 | no clouds layer, fog only |

## 8. Performance budget (hard limits – fail the milestone if exceeded)
* **First meaningful render (title card with terrain):** ≤ **3 MB** transferred on mobile (JS ≤ 250 KB gz + `terrarium_504.png` 0.47 MB + `albedo_1024.jpg` 0.22 MB + 2 font files ≤ 80 KB + `content.json` gzip ≈ 20 KB), **≤ 5 MB on desktop**. Everything else (photos, 2048 albedo, 1008 terrarium) is lazy.
* Photos: show **thumbs (≈ 30–70 KB) first**, load the 1600 px version only when the user opens the full-size viewer; convert to **AVIF/WebP** at build (`vite-imagetools` or `sharp`), keep JPEG fallback; `loading="lazy"`, explicit width/height, `decoding="async"`.
* Total **initial** bytes on 3G (400 kbps) ≈ ≤ 60 s to interactive on low tier; show a loading screen with real progress and a "text-only list" button appearing after 6 s.
* Lighthouse mobile (throttled): Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 90. LCP ≤ 4 s on the title card.
* Memory: ≤ 250 MB GPU+JS on low tier. Dispose geometries/textures when switching tiers.
* **Compression:** serve with brotli/gzip. If you use the GLBs: `npx gltfpack -i public/data/terrain_lod0.glb -o public/data/terrain_lod0.opt.glb -cc` (meshopt; ~4× smaller) and load with `MeshoptDecoder`. KTX2/Basis for albedo is optional (saves GPU memory, not bytes; use `toktx`/`basisu` only if profiling shows texture memory pressure). Draco is not needed for a heightfield; building from the PNG is smaller than any mesh.

## 9. Content model (`public/data/content.json`)
`{ meta, hotspots[] }`. `meta` has bilingual title/intro, `stats[]`, `modes`, `categories`, bbox. Each hotspot:
`id, order, category (peak|habitat|species|culture|conservation|water), modes[] (nature|culture|conservation), lon, lat, elevation_m, elevation_source, dem_m, location_precision (exact|approximate|area|symbolic), coord_confidence, coord_source, title_fr/en, short_fr/en, long_fr/en, facts[{label_fr,label_en,value_fr,value_en}], sources[{label,url}], uncertain[] (strings, English, for the team), photos[] (ids → credits.json), camera{distance_m,azimuth_deg,elevation_deg}`.

Panel anatomy (see DESIGN.md §8): category chip · title · short text · photo carousel (with caption = alt + author/licence) · long text · key-facts grid · "Sources" list (links open in new tab, `rel="noopener"`) · prev/next. **Never show the `uncertain` array to the public**; it drives a small "ⓘ À vérifier / To verify" badge in a hidden `?debug=1` mode and tells you to use ranges ("≈ 1 610–1 670 m").
Hotspots with `photos: []` (otter shrew, bat, N'Zo, Yéalé) show a tasteful illustration placeholder (monochrome silhouette drawn by you in SVG, not a stock photo) – **never use a photo of another species**.

## 10. Content rules (non-negotiable)
1. **Only sourced facts.** If you want to add a fact, find a source and put it in `content.json`'s `sources`; otherwise do not add it.
2. **Never publish precise locations of threatened species** (toad, otter shrew, bat). Markers are deliberately generalised.
3. **Sacred sites and cultural practices:** only what the cited UNESCO Tentative List says; do not map sacred sites; consult communities before adding detail.
4. **Chimpanzees:** write with respect and caution – do not present them as tame/approachable. (Context: in September 2024 residents ransacked the Bossou research centre after a chimpanzee reportedly killed a child; the IREB hotspot says "verify current status". Keep the tone factual; don't add tourism "visit the chimps" calls to action.)
5. **Mining:** report the UNESCO Committee's words (decision 48 COM 7A.46, 2026) neutrally; no accusations against companies beyond what the decision states. The enclave polygon is labelled approximate.
6. **Always show attribution** for photos, assets, sounds and data (§12). **No fake logos or stock photos passed off as Nimba.** Dean permits generated modelling references, textures, image-to-3D inputs and reconstructed card imagery for the open world. Keep prompts, source references and generation provenance in the asset records. Public card captions use **“Reconstitution numérique / Digital reconstruction”**, without an “AI” badge; never present a generated image as a documentary photograph of Nimba or as proof of an exact location, animal or building. Retain the original licensed photographs as references. The About screen distinguishes measured/model-derived data from reconstructed detail (`worldpack/REPORT.md`). Generated animal references still require sourced species sheets and comparison with real photos. These permissions do not change any other content rule.
7. Dates/units: FR uses `1 752 m` (narrow no-break space), EN `1,752 m`; use `Intl.NumberFormat`.

## 11. Accessibility
* WCAG 2.2 AA: contrast ≥ 4.5:1 for text (the panel text is on opaque surfaces), visible `:focus-visible` rings, touch targets ≥ 44 × 44 px, no information by colour alone (pins also carry an icon + label on focus/hover).
* Keyboard: `Tab` through pins in `order`, `Enter` opens, `Esc` closes, arrows orbit, `+/−` zoom, `L` toggles list view; `aria-live="polite"` announces opened hotspot; panel is `role="dialog"` (modal on phones) with focus trap and return focus.
* The canvas is `aria-hidden`; **all information is available in the DOM list view**. Alt text from `assets/photos/alt_text.json` (FR/EN).
* `prefers-reduced-motion`: no flyover, instant camera cuts, no cloud animation. `prefers-color-scheme` is ignored (the scene is its own theme) but the About sheet respects it.
* Language: `<html lang>` follows toggle; FR/EN strings for every UI label live in `src/i18n/{fr,en}.json`.

## 12. Attribution (footer / About sheet must include)
* Copernicus DEM, ESA WorldCover, WDPA, OSM, geoBoundaries texts exactly as in `docs/DATA_LICENCES.md`.
* Per photo: `"title" by author, licence, via Wikimedia Commons` + link (field `attribution` in `credits.json`).
* Credit line "Prototype non officiel …" from §1.

## 13. Offline / PWA
`vite-plugin-pwa` (Workbox `generateSW`): precache the app shell + `content.json` + `terrarium_504.png` + `albedo_1024.jpg` + fonts + the 480 px thumbs (≈ 1.3 MB total); runtime-cache full photos with `CacheFirst` (max 40 entries, 30 days) and the high-tier assets with `StaleWhileRevalidate`. Manifest: name "Nimba 3D", FR default, theme colour `#16210F`, icons = a simple generated mountain glyph (no logos). Add an "Enregistrer pour hors-ligne / Save for offline" button that fetches the remaining assets after the user confirms (show size). Test with DevTools → Offline.

## 14. Milestones (do them in order; after each: run, screenshot at 390 × 844, 820 × 1180 and 1440 × 900, verify acceptance, commit)
**M0 – Scaffold (30 min).** ⚠️ **DATA-LOSS WARNING: never let the Vite scaffolder empty this folder.** Safest: `npm create vite@latest ../nimba-scaffold -- --template vanilla-ts`, then copy `package.json`, `tsconfig*.json`, `index.html`, `src/` and `vite.config.ts` into this folder (merge `.gitignore`). If you scaffold in place (`npm create vite@latest .`), answer **"Ignore files and continue"** and never "Remove existing files". Then `npm i three`, `npm i -D @types/three vite-plugin-pwa playwright` and `npx playwright install chromium`. Copy `assets/photos` → `public/photos` **and strip the `assets/` prefix everywhere**: `credits.json`/`alt_text.json` say `assets/photos/<id>.jpg`; in the app these are served as `/photos/<id>.jpg` and thumbs `/photos/thumb/<id>.jpg` (build the URL from the id, not from the `file` field). Create `scripts/screens.mjs` (already provided in `scripts/screens.mjs`; Playwright: open `http://localhost:5173/?debug=1`, wait for the title card, screenshot at 390×844 (mobile emulation, touch), 820×1180 and 1440×900 into `docs/screens/`; also screenshot after opening one hotspot) – (the app must honour `?skipintro=1` and `?debug=1` from the first milestone) – this is how you do the "check at 3 sizes" step in every milestone (run `node scripts/screens.mjs`, then open the PNGs). Create `src/{main.ts,scene/,ui/,i18n/,data/}`. Add `npm run dev/build/preview`. *Accept:* dev server runs, blank page shows the title card.
**M1 – Terrain.** Load `terrain_meta.json` + `terrarium_504.png`, build mesh (tier mid), basic lighting, orbit controls, fog. Add `albedo_1024.jpg`. *Accept:* the massif is clearly recognisable (long NE–SW ridge, highest point of the whole tile at x ≈ 1291 m, z ≈ -210 m, y ≈ 1,755 m), correct scale (summit 1,752 m at the right place: place a test marker at `richard-molard` and check it sits on the highest peak), 60 fps on desktop.
**M2 – Look.** Slope/altitude shading + noise detail, sky, fog, cloud layer, time-of-day presets (Clear / Golden hour / Mist). *Accept:* screenshot looks "National-Geographic-ish", no banding on the albedo, horizon fades into haze not into a visible tile edge (vignette/fog hides the 31 km square edge; add a soft radial fade of terrain alpha or a skirt).
**M3 – Content & pins.** Load `content.json`, render 23 DOM pins, project each frame, occlusion test, category colours/icons, mode filter. *Accept:* pins stay glued to terrain while orbiting, none float in the sky, no overlap clutter on phone (reduce to number badges below 600 px width until zoomed in).
**M4 – Panel.** Bottom-sheet (phone, 3 snap points 18/55/92 vh, swipe) / side panel (≥ 768 px) with all anatomy from §9, FR/EN, photo carousel with attribution, prev/next, deep link `#/h/<id>`. *Accept:* all 23 hotspots open, nothing overflows at 320 px width, text readable, links work.
**M5 – Camera & picking.** Fly-to on pin open using `camera` hints, heightfield picking, free-click readout (elevation, class, inside reserve, nearest hotspot), double-tap to fly. *Accept:* readout of the summit click shows ≈ 1,750 m ± 25 m; clicking in the Liberia lowland says outside the reserve.
**M6 – Overlays & modes.** Boundary lines, approximate enclave polygon, border lines, mode toggle effects (Nature: habitat tint bands & species pins; Culture: villages + warm tint; Conservation: boundary glow + enclave). *Accept:* each mode visibly different within 300 ms, legend explains overlays.
**M7 – Flyover & polish.** (The app must honour the URL flags `?skipintro=1` (no title card/flyover, used by `scripts/screens.mjs`) and `?debug=1` (show `uncertain` badges, FPS meter).) Intro flyover + skip, loading screen, title card, micro-interactions, haptics (`navigator.vibrate(8)` on pin tap, mobile only), About/Credits. *Accept:* flyover smooth (no camera inside terrain: clamp to terrain height + 150 m).
**M8 – Performance.** Tiering, FPS watchdog, DPR cap, lazy photos (AVIF/WebP), code-splitting (panel & PWA lazy), render-on-demand. *Accept:* budget in §8 met on throttled Slow 4G + 4× CPU slowdown; Lighthouse targets.
**M9 – Accessibility & i18n.** Keyboard, screen-reader pass (VoiceOver/TalkBack), list view, reduced motion, FR/EN completeness (no hard-coded strings). *Accept:* axe DevTools 0 serious/critical.
**M10 – PWA & ship.** Manifest, service worker, offline test, `npm run build`, deploy preview to any static host (Cloudflare Pages / Netlify / GitHub Pages; or Hostinger via `dist/`). Delete `preview.png` and raw data from the build. *Accept:* installable, works offline after first visit, final checklist below.

### Final acceptance checklist
- [ ] 23/23 hotspots open with correct FR and EN text, photos with attribution, sources.
- [ ] Summit is 1,752 m (source) and the readout ≈ 1,755 m (DEM) – both explained in the panel (do not "fix" one to match the other).
- [ ] Phone 390 × 844: no horizontal scroll, bottom-sheet usable one-handed, ≥ 30 fps on a mid-range Android (or tier auto-drops).
- [ ] Tablet 820 × 1180 and desktop 1440 × 900 layouts per DESIGN.md.
- [ ] Footer credits + About lists every licence in `docs/DATA_LICENCES.md`.
- [ ] No console errors/warnings; no network request except same-origin assets (fonts self-hosted, no CDN).
- [ ] No copyrighted images, no logos, no invented facts; species locations generalised.
- [ ] README of the final app explains how to rebuild data (`scripts/`).

## 15. Working style
* Make decisions yourself using this brief; ask Dean only for things that need his input (hosting domain, CSIG wording changes, extra photos he owns).
* Keep commits small, one per milestone. Keep `src/` readable: `scene/terrain.ts`, `scene/sky.ts`, `scene/overlays.ts`, `scene/camera.ts`, `scene/picking.ts`, `ui/panel.ts`, `ui/pins.ts`, `ui/list.ts`, `i18n/`, `data/content.ts` (types generated from the schema above).
* Write a short `docs/BUILD_NOTES.md` as you go (decisions, budgets measured, issues).
* If a source fact seems wrong, **flag it in `BUILD_NOTES.md`** and keep the cautious wording; do not silently "correct" it.

## 16. Quick reference – hotspots (id · category · lat, lon · elevation m)
1. `richard-molard` · peak · 7.6219, -8.4083 · 1752 m · Mount Richard-Molard – the roof of Guinea
2. `grands-rochers` · peak · 7.6567, -8.3797 · 1694 m · The Grands Rochers (Great Rocks)
3. `pierre-richaud` · peak · 7.6739, -8.3636 · 1670 m · Mont Pierre Richaud – next to the mining enclave
4. `montane-grassland` · habitat · 7.6397, -8.3958 · 1660 m · The high-altitude grasslands
5. `cloud-forest` · habitat · 7.6700, -8.4000 · 1120 m · The cloud forest
6. `lowland-forest` · habitat · 7.6750, -8.4400 · 580 m · Foothill forest and gallery forests
7. `savanna-fire` · habitat · 7.7100, -8.3400 · 540 m · Savanna and bushfires
8. `cavally` · water · 7.7153, -8.4419 · 520 m · The water tower: sources of the Cavally
9. `viviparous-toad` · species · 7.6486, -8.3880 · 1550 m · The Nimba viviparous toad
10. `otter-shrew` · species · 7.6550, -8.4400 · 630 m · The Nimba otter shrew
11. `lamotte-bat` · species · 7.6640, -8.3770 · 1540 m · Lamotte's roundleaf bat
12. `bossou-chimpanzees` · species · 7.6487, -8.5054 · 540 m · The Bossou chimpanzees and their tools
13. `ireb-bossou` · culture · 7.6445, -8.5030 · 560 m · IREB – research at Bossou
14. `green-corridor` · conservation · 7.6370, -8.4870 · 550 m · The Bossou–Nimba Green Corridor
15. `cultural-landscape` · culture · 7.6311, -8.4629 · 570 m · The Nimba cultural landscape
16. `cegens-gbakore` · conservation · 7.7241, -8.4059 · 490 m · Gbakoré – the reserve's management base
17. `nzo` · culture · 7.6794, -8.3142 · 450 m · N'Zo – the eastern gateway
18. `yeale` · culture · 7.5279, -8.4222 · 370 m · Yéalé – the Ivorian side
19. `yekepa-lamco` · conservation · 7.5753, -8.5419 · 510 m · Yekepa and the LAMCO mining legacy (Liberia)
20. `mining-enclave` · conservation · 7.6700, -8.3743 · 1310 m · The Guinean mining enclave
21. `tripoint` · conservation · 7.5556, -8.4722 · 1230 m · Three countries, one mountain
22. `unesco-inscription` · conservation · 7.6032, -8.3910 · 790 m · A World Heritage Site since 1981
23. `danger-list` · conservation · 7.6447, -8.4231 · 740 m · On the Danger List – decision 48 COM 7A.46
