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

## M3 – Content & pins
* 23 pins are real `<button>`s in a `#pins` layer, in `order` (Tab order = hotspot order), moved with `translate3d` after every rendered frame. Pins anchor on the **DEM surface** at the hotspot's lon/lat, not at `elevation_m`. Otherwise Pierre Richaud (1,670 m published, 1,609 m DEM) would float 110 m (×1.8) above the ground.
* **Occlusion:** a 64-step segment march from the camera to the pin through the CPU heightfield (no depth read-back). Occluded pins fade to 25 % and ignore clicks.
* **Declutter:** greedy by priority (selected, then `order`). A pin whose head lands within 34 px (phone) / 40 px (desktop) of an already-placed one collapses to a small dot. Collapsed pins stay keyboard-focusable and re-expand on focus.
* **Phones (< 600 px):** pins show their `order` number instead of the glyph while the camera is more than 9 km from its target (DESIGN.md §6 badge variant).
* `area` / `symbolic` hotspots draw a dashed ellipse of ≈ 600 m projected radius instead of a ground dot. The species pins are therefore visibly "zones", never points.
* **Modes:** pins filter by `modes[]` (Nature 13, Culture 6, Conservation 14 pins). The state is in `?mode=` and the default (Nature) is omitted from the URL. A selected pin stays visible across modes; switching to a mode it isn't in clears the selection.
* **Deep links:** `#/h/<id>` selects the hotspot and glides the camera (1.2 s cubic) to its `camera` hint (distance, azimuth, elevation clamped 15–80°). The panel arrives in M4. The hash is kept in sync with `replaceState`.
* `?debug=1`: an orange "!" dot on hotspots with `uncertain` notes; the notes show as the button's tooltip. Never shown without the flag.
* Portrait screens use a steeper, slightly farther home view (+14°, ×1.25), so the ridge fills the frame instead of the sky.

## M4 – Panel
* `ui/panel.ts`, one component with two layouts:
  * **Side panel** (glass, 20 px radius, inset 16 px) on desktop (440 px, max 36 vw) and landscape tablets (380 px).
  * **Bottom sheet** on phones and portrait tablets, following DESIGN.md §3 ("bottom sheet in portrait ≤ 820 px wide"), where CLAUDE.md M4 says "≥ 768 px = side panel". A 380 px panel on an 820 px portrait tablet would hide half the mountain. The sheet is capped at 640 px and centred on tablets, so the 480 px thumbs don't blow up.
* **Sheet:** snap points 18 / 55 / 92 % of the viewport height. Drag the header (flick = one snap in that direction, otherwise nearest snap; dragging well below the peek closes it). Tap the handle to cycle, or press Enter/Space on it. Opens at 55 %. At the 18 % peek it shows the chips and title only. On phones it's `aria-modal` with a Tab focus trap; the side panel is non-modal so the map stays usable.
* **Camera framing:** the panel reports the pixels it covers. The stage animates `camera.setViewOffset` so the hotspot is centred in the visible part of the canvas (half the panel width, or half the sheet height). Pins use the same projection, so they stay glued.
* **Anatomy** (DESIGN.md §8): category chip (colour + glyph + label), elevation chip, precision chip (area / approximate / symbolic), Fraunces title, short text, photo carousel, long text (max 62 ch), key facts grid (an odd last cell spans both columns), Sources accordion (open by default ≥ 1024 px; label + hostname + external icon, `target=_blank rel=noopener`, "(new tab)" for screen readers), footer Previous · Share · Show on map · Next.
* **Elevation chip rule:** for a surveyed peak, the published height, or a **range** when it differs from the DEM by more than 25 m (Pierre Richaud: "≈ 1 610–1 670 m"; Richard-Molard: "1 752 m"). DEM-sampled markers show "≈" rounded to 10 m. The symbolic Danger List anchor has no elevation chip.
* **Photos:** 480 px thumbs in a scroll-snap carousel (swipe, arrow keys, dots, hover arrows for mouse). The caption is the FR/EN alt text plus "© author · licence" linking to the Commons page. Tapping opens `ui/viewer.ts`, a native `<dialog>` (top layer, Esc, focus) that loads the **1600 px original only there**, with pinch / wheel / double-tap zoom and drag-to-pan. Thumbs at 2–3× DPR are soft; AVIF/WebP and a mid size are M8.
* **No photo** (otter shrew, Lamotte's bat, N'Zo, Yéalé): monochrome silhouettes drawn for this project for the two species (never a photo of another species); the villages get the category glyph on a neutral block. Caption: "Illustration – no openly licensed photo available".
* Prev/next walk **all 23 hotspots in `order`** and wrap around. They don't switch the mode: the selected pin stays visible in any mode. Changing mode closes the panel only if its hotspot isn't in the new mode (DESIGN.md §7).
* Share: Web Share API on touch devices, otherwise the clean link (`#/h/<id>`, no debug flags) is copied, with "Link copied" shown and announced.
* Language switch re-renders the open panel in place and re-announces the title. Esc closes (unless the photo viewer is open) and focus returns to the pin that opened it. A deep link on page load opens the panel without stealing focus.
* `?debug=1` adds a dashed "To verify" box listing the hotspot's `uncertain` notes (English, for the team).
* **`scripts/check-panel.mjs`** (M4 acceptance): opens all 23 hotspots in FR and EN at 320 px and 1440 px and checks title/short/long text, the photo count (or placeholder), "©" attribution on every caption, facts and sources counts, link attributes, no horizontal overflow, prev/next wrap, language switch keeping the panel open, keyboard Enter on a pin, and Esc + focus return. **All pass.**
* JS bundle: 160 KB gz (budget 250 KB). Code-splitting the panel is planned for M8.

## M5 – Camera & picking
* **Fly-to on open** uses each hotspot's `camera` hint (since M3). **Picking** (`scene/picking.ts`) turns the click into a camera ray (it honours the panel's view offset) and ray-marches the CPU heightfield: 25 m steps growing with distance, then 12 bisection steps. The 250k-triangle mesh is never raycast.
* **Tap / double-tap** on the canvas (8 px / 450 ms tap threshold, so orbit drags never trigger it). One tap shows the readout. A second tap within 330 ms and 30 px flies there: target = the ground point, current azimuth, elevation ≥ 30°, distance 45 % of the current one (1.5–8 km). Mouse double-click does the same.
* **Readout** (`ui/readout.ts`, DESIGN.md §9): `▲ 1 747 m · Prairie d'altitude · Dans la réserve (Guinée)` plus a "Nearest: … (50 m)" button that opens that hotspot.
  * Placed *below* the tapped point, because pins rise above their ground point and the card would otherwise hide the pin you just tapped next to.
  * Dismissed by the next tap, any drag/pinch/wheel (`controls` `start`), a fly-to, opening a hotspot, or Esc.
  * Announced via `aria-live`. The card has no keyboard path of its own; the same information lives in the panels and the M9 list view.
  * Elevation is the DEM at the hit point (DSM: canopy included).
  * Land cover comes from WorldCover. Grass/shrub above **1,200 m** is labelled "Prairie d'altitude / Montane grassland", following the `montane-grassland` hotspot text ("between about 1,200 and 1,400 m and up to the highest crests").
* **Where is it?** (`data/regions.ts`):
  * Reserve = point-in-polygon on the two WDPA parts. Their `iso3` gives the country inside the reserve.
  * Outside, "strict reserve" is worded carefully ("Hors réserve intégrale / Outside the strict reserve"), because the Liberian East Nimba Nature Reserve exists but is not in our data.
  * Countries: `borders_clipped.geojson` holds *lines*, so each country polygon is its line closed along the window edge on that country's side (Guinea N, Liberia W/SW, Côte d'Ivoire SE). Inside 0 or 2 polygons, or within 400 m of any outline, reads "near a border". Within 2.5 km of the Wikidata tripoint reads "near the tri-border point".
  * Inside the OSM polygon the readout adds "Mining enclave (approx., OSM)".
* **Flag for the content team:** the `mining-enclave` hotspot sits on the *area centroid* of the OSM polygon, which lies **outside** the polygon (it's concave; the nearest inside point is ≈ 165 m away). Harmless for a marker labelled "approximate", but the readout at the pin itself says "not in the enclave". Left unchanged (CLAUDE.md §15: flag, don't silently correct).
* **`scripts/check-picking.mjs`** (M5 acceptance), all pass on desktop and phone (touch):
  * 11 classification checks: summit in the Guinea part; Bossou, N'Zo and Gbakoré in Guinea; Yekepa and the Liberian lowland in Liberia; Yéalé and the Ivorian lowland in Côte d'Ivoire; the Côte d'Ivoire reserve part; tripoint; inside the enclave.
  * **A real click on the summit reads 1,740 m (mid tier, 504² DEM) / 1,747 m (high tier, 1008² DEM).** The target is ≈ 1,750 ± 25 m ✓.
  * A click in the Liberian lowland (503 m) reads "Hors réserve intégrale · Liberia" ✓.
  * The "nearest" button opens Yekepa. A double click / double tap moves the orbit target to within 60–120 m of the point.
* `?debug=1` exposes `window.__nimba` (`project`, `view`, `target`, `describe`) for these scripts only.

## Hosting – Vercel
* Project **`nimba-3d`** in the "dine706's projects" team, imported from `Dine706/Virtual-Museum`. The production branch is `claude/new-session-96lrge` (the repo's only and default branch), so **every push redeploys production**.
* Live at **https://nimba-3d.vercel.app** (public; checked from outside: HTTP 200, no login wall). Vercel "Standard Protection" stays on: per-deployment and branch URLs (`nimba-3d-<hash>-dine706s-projects.vercel.app`) ask for a Vercel login, while the production domain is public.
* `vercel.json`: Vite preset, `npm ci`, `npm run build` → `dist`. Hashed `/assets/*` are cached for a year (immutable); `/data/*` and `/photos/*` for 7 days with stale-while-revalidate (these names aren't hashed, so a data fix reaches visitors within a week, or immediately after a hard reload). Adds `nosniff` and `Referrer-Policy`.
* The build prunes files the app never loads (`preview.png`, 16-bit heightmaps, hillshade, albedo, GLBs, `hotspots.geojson`), so `dist` is ≈ 16 MB, mostly the photos. CLAUDE.md M10 asks for this; it's done early because hosting started early.
* `engines.node` pinned to `22.x`. With `>=20`, Vercel picked Node 26 and warned it would auto-upgrade on every new major.
* The Vercel connector in Claude sessions can read this team (deployments, logs) but is **not allowed to create projects or deployments** (403). Deployments therefore come from Git pushes, not from the connector.
* The cloud container's network policy blocks `*.vercel.app`, so live checks from here go through an external fetch or the Vercel API. `scripts/check-*.mjs` accept `BASE_URL=…` to run against any reachable host.

## M6 – Overlays & modes
* **Draped lines** (`scene/overlays.ts`, three's `Line2`/`LineMaterial`, constant CSS-pixel width, dashes in metres): each ring is densified to a vertex every 40 m and lifted 25 m (true) above the DEM, so it follows the relief and never sinks into the mesh; depth-tested, so ridges hide lines behind them.
  * Reserve: amber `#E3B04B`, 2.6 px, plus a 7 px glow line in Conservation.
  * Enclave: terracotta `#C8553D`, dashed 200/90 m. Shorter dashes broke the many-vertex OSM polygon into scattered dots.
  * Borders: white 40 %, dashed 260/170 m, clipped 2.6 km inside the tile so they stop before the hazy edge.
  * Widths ×0.65 on screens narrower than 600 px.
* **Modes** (DESIGN.md §7), all cross-faded in 250 ms (instant with reduced motion):
  * **Nature:** terrain tinted by indicative elevation bands (≲ 1,000 m greener, ≈ 1,000–1,400 m cooler, ≳ 1,400 m golden), from the content's own figures (UNESCO lowland forest "up to 1,000 m"; grassland from "≈ 1,200–1,400 m"). The legend calls them *indicative elevation bands (Copernicus DEM)*, not mapped habitats. Reserve boundary at 55 %. "Water glints": no river data exists in the kit (GEO_DATA §4), so none are drawn.
  * **Culture:** warm grade on the terrain (×(1.3, 1.0, 0.68) at 80 %). Six village labels with laterite dots: Bossou, Séringbara, Gbakoré, N'Zo, Yéalé, Yekepa, at the GEO_DATA §4 positions; Lola is outside the window. Reserve 35 %, borders 30 %.
  * **Conservation:** terrain desaturated to 70 % so the overlays read, the reserve glows, the enclave is dashed with a hatched "Mining enclave (approx.)" label, borders at 40 %, country labels (GUINÉE / LIBERIA / CÔTE D'IVOIRE). The legend chip "On the List of World Heritage in Danger since 1992" comes from the `danger-list` hotspot's fact and opens that hotspot.
* The **enclave label** is anchored inside the polygon's northern end and drawn above its point. The polygon's centroid lies outside it (M5 note), and the enclave / bat / peak pins cluster to the south.
* **Legend** (`ui/legend.ts`): a `<details>` whose content follows the mode. Open on desktop (bottom-left above the credit line); a "Legend" pill bottom-right on phones and tablets.
* Terrain labels are `aria-hidden` DOM elements (same projection + occlusion test as the pins). The information they carry is in the hotspot panels and the legend.
* **Shader stall fixed:** the dashed `LineMaterial` programs only compiled the first time those lines became visible, so the first switch to Conservation could stall (2.2 s once under software GL). `Overlays.precompile()` compiles all line materials as soon as the overlays are added.
* **`scripts/check-overlays.mjs`** (M6 acceptance), all pass:
  * The 3 country label anchors classify inside their country; the enclave label anchor is inside the polygon.
  * **Each mode reaches its target look in 239–260 ms** after the click (≤ 300 ms).
  * Mean pixel difference between modes: 8.7 (Nature/Culture), 12.4 (Culture/Conservation), 11.7 (Nature/Conservation) / 255.
  * The legend text matches each mode; the Danger List chip opens the `danger-list` panel.
  * The M4 panel and M5 picking checks still pass.
* JS bundle: 174 KB gz (adds `Line2`; budget 250 KB).

## M7 – Flyover & polish
* **Title card** over the live terrain, seen from the flyover's start point (NE, 6,000 m above the terrain), drifting slowly (`autoRotate` 0.15, none under reduced motion). Chrome, pins and overlay lines stay hidden (`body.flying`, set before the first frame) until the intro ends.
* **Flyover** (`scene/flyover.ts`): centripetal Catmull-Rom splines through the CLAUDE.md §6.9 waypoints. Title view → low pass over Pierre Richaud / Grands Rochers (2,200 m above) → Richard-Molard (1,800 m above) → the default orbit (az 215°, el 38°, 14 km).
  * The look-at spline runs ridge → summit → on down the ridge towards the tripoint → home target.
  * Arc-length parametrised (even speed), cubic ease-in-out, 12 s.
  * Every frame the camera is clamped to ≥ 150 m (true) above the DEM.
  * Subtitles (DESIGN.md §5): "Trois pays, une montagne" → "1 752 m au-dessus des nuages" → "Un château d'eau pour la région", in FR/EN, Fraunces, fading in and out.
* **Skip:** "Passer l'introduction" button, any tap/click, or Esc; each glides to the default orbit in 0.9 s. "Passer" on the title card glides straight there (1.2 s). Under `prefers-reduced-motion`, "Explorer" cuts straight to the orbit. **A `#/h/<id>` deep link skips the title card and flyover** and opens the hotspot, which is what a link shared on WhatsApp should do.
* After the intro the pins arrive in a 40 ms stagger, then the one-time "Touchez un repère" hint shows.
* **Bug fixed** (found by the new check): animators compare the rAF timestamp with a `performance.now()` start, and the first rAF time can be a few ms *earlier*. A slightly negative progress made `CatmullRomCurve3.getPointAt` index −1 and throw. Progress is now clamped to [0, 1] in the flyover, overlay fades, atmosphere cross-fade and mode looks.
* **About / Credits** (`ui/about.ts`, native `<dialog>`; info button in the desktop rail / phone top bar, plus "Photos : voir Crédits" on the credit line and the title card):
  * Project note (unofficial prototype, no UNESCO/CSIG/OIPR logos), how-to, and "no accounts, no cookies, no analytics" (true: the app has none).
  * Settings: **graphics quality Auto / High / Medium / Low** (saved, applies on next load; shows the current level) and atmosphere.
  * Every entry of `docs/DATA_LICENCES.md` with its attribution text verbatim: Copernicus DEM, ESA WorldCover, WDPA (non-commercial), geoBoundaries (per-country licences), OSM (ODbL), Wikidata (CC0).
  * All **32 photo credits** from `credits.json` (thumbnail, alt text, attribution linking to Commons, "resized and recompressed for the web").
  * Texts note, software licences (three.js MIT, Vite MIT, fonts SIL OFL 1.1), and "how to correct us".
  * The "correct us" text says a contact will be published with the pilot. **Dean: add the real contact (email or form) when you have one.** I did not invent one, and I removed a draft line claiming the code is public on GitHub, because I don't know the repo's visibility.
  * The only surface that follows `prefers-color-scheme`: light theme `#F4F1E8` / `#1B2314` / `#C9C0AA` (DESIGN.md §1).
* The credit line is split into the fixed credit text plus a "Photos : voir Crédits" button. On phones the full credit line is inside the About sheet (DESIGN.md §12).
* The "Switch to English?" suggestion disappears as soon as any language is chosen. The loading bar reads 100 % as it fades.
* Haptics: `navigator.vibrate(8)` on pin tap on touch devices (since M3). FPS meter and `uncertain` badges under `?debug=1` (since M1/M3).
* **Not done here:** the loading screen's "text-only list" button after 6 s needs the list view (M9).
* **`scripts/check-flyover.mjs`** (M7 acceptance), all pass:
  * Planned path minimum clearance **922 m**; rendered frames minimum **972–991 m** (≥ 150).
  * Ends exactly on the default orbit target with chrome back and subtitles gone.
  * Esc, tap and "Passer" all land on the default orbit.
  * Reduced motion: no flyover. A deep link opens without the title card.
  * The M4/M5/M6 checks still pass.
* JS bundle: 180.6 KB gz (budget 250 KB). Code-splitting the About sheet and panel is M8.

## Simplification for the prototype (Dean's request, after M7)
* **Removed:** the legend (with its Danger List chip), the amber reserve-boundary lines and glow, the terracotta mining-enclave outline and its label, both on-screen credit lines ("Prototype non officiel – Phase 0 · …" on the map and the title card, with the "Photos : voir Crédits" link), and the ⓘ About / Credits sheet with its settings (quality tier, atmosphere). `ui/legend.ts`, `ui/about.ts`, their CSS and strings were deleted; git history keeps them (`f515a4a`).
* **Kept:** the white dashed national borders and the GUINÉE / LIBERIA / CÔTE D'IVOIRE labels (Conservation), the village labels (Culture), the mode looks, and **the "© author · licence" caption under every photo** in the panels and the viewer (required by the photos' CC BY / BY-SA licences). The readout still *says* "in the reserve" and "mining enclave (approx., OSM)"; only the drawn lines are gone.
* **Added:** a ✕ close button on the free-click readout card (44 px target, `aria-label` "Fermer / Close"), like the panel's.
* **Before any public or official launch, restore the data attributions somewhere visible.** Copernicus DEM, ESA WorldCover (CC BY 4.0), WDPA (non-commercial terms), geoBoundaries (CC BY-SA for Guinea) and OSM (ODbL) all require them (`docs/DATA_LICENCES.md`). The removed About sheet held them verbatim and can be brought back from git. This conflicts with CLAUDE.md §12 / the final checklist ("Footer credits + About lists every licence"), and was done knowingly for the prototype.
* Quality tier: with the About setting gone, the tier is auto-detected (and `?tier=high|mid|low` still overrides it). The M8 FPS watchdog will handle step-downs.
* Checks updated: `check-overlays.mjs` now expects border-only overlays, 3 Conservation labels, no legend and no credit line. `check-picking.mjs` tests the ✕. All four checks pass. One overlay run timed a first switch at 1.7 s; two reruns gave 207–247 ms, a one-off CPU-renderer stall rather than a regression.

## M8 – Performance
**Measured** (`scripts/check-perf.mjs`, production build served with gzip; Vercel's brotli is slightly smaller):

| | Mobile (mid tier) | Desktop (high tier) | Budget (CLAUDE.md §8) |
|---|---|---|---|
| Bytes to the title card | **880 KB** | **2.34 MB** | ≤ 3 MB / ≤ 5 MB |
| JS (gzip, first load) | 168 KB | 168 KB | ≤ 250 KB |
| Fonts | 2 files, 83 KB (Inter + Fraunces, Latin) | same | 2 files ≈ 80 KB |
| Title card on 400 kbps "3G" | 20 s | – | ≤ 60 s |
| Title card on Slow 4G (1.6 Mbps) | 5.8 s | – | – |
| Lighthouse (mobile / desktop) | Perf **70–72** · A11y 100 · BP 100 · SEO 100 | Perf **81** · 100 · 100 · 100 | ≥ 80 / 95 / 95 / 90 |
| LCP | 0.8 s | 0.2 s | ≤ 4 s |
| CLS | 0.016 | 0.005 | – |

* **Caveat on the mobile Lighthouse score:** this container renders WebGL on the CPU (SwiftShader). Lighthouse's 4× CPU slowdown then turns every rendered frame of the drifting title card into a long main-thread task. Total Blocking Time varies between 2.1 and 5.8 s from run to run, and it alone holds the score below 80. Boot itself, unthrottled, is 0.5–0.6 s to the first frame (marks below) with no task over 240 ms. **Run Lighthouse in Chrome on a real laptop/phone against https://nimba-3d.vercel.app for the real figure.**
* Boot timeline (`performance.mark('nimba:*')`, phone, unthrottled, SwiftShader): webgl-probe 144 ms → data fetched 182 → decoded 227 → GL context 273 → terrain built 400 → shaders compiled 440 → first frame 609 ms.

**Changes**
* **The title card is the loading screen**, static HTML in `index.html` with its own critical CSS. "Monts Nimba", the subtitle (in the saved language, via a tiny inline script), the real DEM ridge line and the byte progress are painted from the first byte. The terrain fades in behind the card's gradient when ready, and Explorer/Passer appear *above* the fading progress block. The content is anchored from the top, so nothing already on screen moves. This took mobile LCP from 6.2 s to 0.8 s, because the title was previously created by JS only after the terrain loaded. On 3G, people read the title for those 20 s instead of a contour line. With `?skipintro` or a deep link, the card simply fades away when ready.
* **Code splitting:** the panel (4.8 KB gz), photo viewer (1.7 KB gz) and `credits.json` load on the first hotspot opening, or are prefetched during idle time 4 s after the first frame. The overlays (`Line2`, 6.6 KB gz) load right after the first frame. Main chunk 176 → 167 KB gz (mostly three.js).
* **Photos: AVIF + WebP + JPEG fallback** via `<picture>` (`scripts/make_photo_formats.mjs`, sharp; outputs committed so the Vercel build does not run encoders). Thumbs: JPEG 1.2 MB → AVIF 0.72 MB (−40 %). Full size (viewer only): 11 MB → 5.9 MB (−46 %). Opening a panel is now ≈ 20–30 KB per thumbnail. The repo grows by ≈ 14 MB of encoded copies.
* **FPS watchdog** (`scene/watchdog.ts`, CLAUDE.md §7): measures 2 s of *continuous* rendering (the stage reports whether each frame followed another rendered frame, so idle gaps never count). If it is under 28 fps it steps down one tier *at runtime*: high → mid → low, meaning fewer mesh segments (504² → 256² → 160²), a lower DPR cap (2 → 1.5 → 1), fewer cloud layers (3 → 2 → 0), fewer shadow steps (24 → 12 → 0) and no pin pulse on low. It re-measures after 600 ms of settling and saves the result for the next visit. `?tier=` forces a tier and disables it. It is off under automation (`navigator.webdriver`: software GL is always "slow") unless `?watchdog=1`.
  * The first version ignored frames more than 250 ms apart as "idle" and never fired on a GPU slow enough to need it. The new check caught this.
* **`?fps=1`**: an on-screen meter (fps · tier · mesh · DPR · watchdog history) for testing on real phones, without the debug badges.
* **Battery / render-on-demand:** the high-tier cloud drift and the title-card drift stop 20 s and 30 s after the last input, and restart on any input. The check confirms 0 frames in 3 s when idle.
* **Shaders:** compiled with `renderer.compileAsync` before the first frame when `KHR_parallel_shader_compile` exists (off the main thread). Otherwise, as before, on the first render. The overlay line shaders are precompiled the same way (async, or synchronously at load rather than as a stall on the first Conservation switch).
* **Favicon:** an inline SVG mountain glyph (no logo). This removes the `/favicon.ico` 404, the only console error Lighthouse found.
* Dev tooling: `scripts/serve-dist.mjs` (gzip static server for `dist/`, used for Lighthouse); `sharp` dev dependency.
* All checks pass: perf, flyover, panel, picking, overlays. The flyover check now waits for the lazily loaded panel on deep links.

### Automatic deployments paused (17 Nov 2026, Dean's request)
* Dean asked that nothing change on Vercel until he approves the results. `vercel.json` now has `"ignoreCommand": "… exit 0"`. Vercel's *Ignored Build Step* exits 0, so **every push is skipped**: it shows as *Canceled* in the Vercel dashboard and the live site stays exactly as it is.
* The live site is the M8 app (commit `b3937b3`). The three pushes after it (setup guide, stage-1 massif and zones) only added docs and data, and no web-build file has changed since.
* **To deploy again after approval:** remove the `ignoreCommand` line and push. That commit builds normally, because Vercel reads `vercel.json` from the commit being deployed.

## Stage 1 – world pack for the Unreal world (17 Nov 2026)

Everything is in `worldpack/`; read `worldpack/REPORT.md` first. The scripts are in `scripts/worldpack/`.

* **Terrain and forest:** massif at 15 m, plus four hero zones at 1 m (summit, cloud forest, Bossou hills, foothill forest).
  * Ground = Copernicus DSM − Meta/WRI canopy height.
  * PCG masks and DEM-derived streams.
  * The 1-px CHM tile seam at lon −8.4375 is filled with nearest valid values.
* **Species:** 3,914 species from 79,736 GBIF records, with Wikidata names and iNaturalist photo candidates. No coordinates are stored.
  * **GBIF deep paging:** search pages past offset ≈ 10,000 take 90 s or more, or stall, through the proxy. The script now splits the window into parts of fewer than 9,900 records each (quadrants, then taxon facets where one collection of 13,682 specimens shares a single point).
  * Requests have a hard 90 s streamed deadline and a 0.5 s pause between calls.
  * Not in GBIF within the window: the otter shrew, *Blaeria nimbana*, *Osbeckia porteresii*.
  * 1,112 of 1,117 iNaturalist photo candidates are CC BY-NC.

## Walk mode – first-person exploration (17 Nov 2026)

Dean asked for detail when zooming in: walk among the trees and plants, see animals, click on anything, each area unique. This is built into the web app as a lazy-loaded **walk mode** (`src/walk/`, 35 KB gz chunk, loaded only on entry). Nothing is deployed: Vercel stays paused.

**Ways in:**
* "Marcher ici / Walk here" in the free-click readout.
* The new walk button in a hotspot panel's footer.
* Zooming in past the closest orbit distance (mouse wheel).
* A deep link `#/walk/<lon>,<lat>` (kept up to date while walking, cleared on exit).

**Controls:**
* Drag to look; ZQSD/WASD (by key position) or the arrows; Shift to run.
* Double-click for mouse-look; Esc closes the card, then exits.
* Joystick on touch screens.
* A tap or click identifies the tree, plant, animal or ground under it.

**Data** (`scripts/worldpack/build_walk_data.py` → `public/walk/`, 8.8 MB, loaded tile by tile, ≈ 0.3–0.4 MB for one place):
* 15 m tiles in the app frame with ground height (DSM − canopy), canopy height, land cover, rock and stream masks.
* Smoothed DEM stream lines.
* `species.json`: the species that walk mode names, plus the most-recorded species per altitude band.
* **Dominant tree crowns detected in the 1 m canopy model** for the four hero zones: 3,505 / 4,912 / 6,253 / 8,712 crowns. The model is smooth, so these are the dominant crowns (≈ 20–40 per hectare), not every tree.
* The same script writes `mask_regrowth.png` into the world pack. This is the grey "neither forest nor grass" class seen in the previews: tree/shrub land cover with a canopy under ~6 m (39 % of the massif, 43 % of the Bossou zone).

**Rendering:**
* Two passes: far (sky, whole massif DSM at true scale, sea of clouds) and near (0.1–2,700 m).
* Ground patch: a GPU-displaced grid, ≈ 0.5 m at the centre to 25 m at the rim. It uses the same height function in GLSL and JS (shared integer hash), so feet, trees and the mesh agree.
* Beyond the tree range, the patch rises to the measured canopy height (a "canopy shell").
* Ground materials: leaf litter, laterite, turf, rock and moss, blended from the measured land cover, canopy, slope, altitude and stream distance. The textures are all drawn in code.

**Plants:**
* Ten procedural plant types following content.json's sourced habitat descriptions: emergent with buttresses and lianas, canopy, understorey, mossy Parinari-type montane tree with epiphytes, *Alsophila* tree fern, oil palm, raphia palm, *Protea* shrub, savanna tree, regrowth.
* In hero zones, measured crowns are placed at their real positions and heights. Elsewhere, canopy, understorey, shrubs, palms and ferns are placed deterministically from canopy height, land cover, altitude belt and stream proximity.
* Distant trees are impostors rendered from the same models.
* Ground cover: summit tussock grass, savanna grass, turf, ferns, broad-leaved herbs, branches, stones and boulders. Grass thins out to twice the cover radius.
* Streams are animated ribbons in carved beds.

**Animals** (simple procedural models, never photos or scans; all recorded by GBIF in the window):
* African pied hornbills and Guinea turacos (red flight feathers), sunbirds.
* *Acraea*, swallowtail and *Graphium* butterflies.
* An *illustrative* nut-cracking site at Bossou (anvil, hammer stone, palm nuts). Its card says the location is not real.
* No chimpanzee models (CLAUDE.md §10.4: wild, respectful), and no threatened species at specific places.

**Cards:**
* Trees: the measured height (Meta/WRI) when the crown is measured, otherwise ≈ the canopy height here. Sourced habitat text from content.json, recorded species of that plant group with GBIF links, and "the species of this exact tree is not mapped".
* Animals: the recorded species in GBIF, plus "simplified model at an illustrative spot".
* Ground: the habitat text and sources, the altitude band, the species counts for that band, and the most-recorded plants.

**Lighting and realism details:**
* Three light presets (Matin / Midi / Brume).
* Fog per habitat (dense in the cloud forest, light in the grassland), plus a fill light under closed canopy.
* Wind in leaves, fronds and grass; foliage normals not flipped; alpha-tested leaf shadows; alpha-to-coverage.
* Leaf textures bleed colour under transparent pixels, so mipmaps do not turn edges black.
* Foliage within ~1.5 m of the eye dissolves (dithered).
* The walker starts at the most open spot within 14 m.

**Tiers** (`TIER_OPTS` in `src/walk/index.ts`):
* High: 320² ground grid, 420 m tree range, 55 m full-detail trees, 2,048 shadows.
* Mid: 224², 260 m, 32 m, 1,024 shadows.
* Low: 160², 170 m, 20 m, no shadows.
* On every tier, the resolution steps down if the first seconds run under 24 fps.
* **Not yet measured on a real phone or GPU.** SwiftShader in the container renders 1–3 s per frame, so the numbers here are only correctness checks.

**Checks:**
* `scripts/check-walk.mjs [tier] [place]`: five places, screenshots in `docs/screens/walk-*.png`, console clean.
* `scripts/check-walk-flow.mjs`: phone flow, readout → walk → card → back, with the deep link and no overflow.
* `dev/walk-lab.html` (dev only, not built): every plant and cover type in a row.

**Bugs found and fixed during the build:**
* Fog started at full density.
* Canvas leaves had black mip edges.
* Fronds were invisible while casting solid shadows.
* Palm bark looked like faces.
* Herbs were lit from below.
* Teleporting kept stale heights.
* Butterflies never found a "suitable" spot.

**Honest limits:**
* Plant shapes and species per tree are reconstructions.
* The ground under 30 m is generated.
* Animals are simple models, often hard to spot behind leaves, as in a real forest.
* This is a browser, so it will not reach Unreal-level photorealism. The same data feeds the Unreal world pack.

### Preview deployments (17 Nov 2026, Dean's request)
* Dean asked for a preview link to review walk mode. `ignoreCommand` now skips **production** builds only (`$VERCEL_ENV = production` → exit 0). Every push to this branch is still a production deployment, and is still cancelled, so the live site (M8 app) does not change.
* Preview deployments are created on request through the Vercel API (target *preview*). They build normally and get their own URL. Vercel Authentication is on for deployment URLs, so a preview opens only for logged-in team members.
* **To go live after approval:** remove the `ignoreCommand` line and push.

## Walk mode – high-quality look (example, 17 Nov 2026)

Dean asked how to sharpen the graphics and the realism. This is an example of the first steps, on by default on the high tier; `?fx=1` / `?fx=0` forces it on or off.

* **Scanned textures:** CC0 textures from Poly Haven, fetched by `scripts/fetch_textures.mjs` into `public/walk/tex/` with `credits.json`. They are WebP, diffuse 1K and normals 512 px, 2.4 MB in total, and load only in this mode.
  * Ground: `forest_leaves_02` for leaf litter and `red_laterite_soil_stones` for laterite (tinted redder for Nimba), plus `leafy_grass`, `rock_boulder_dry` and `mossy_rock`.
  * Bark: `bark_brown_02`, `bark_platanus` and `palm_tree_bark`. Stones use the rock texture.
  * These are generic surfaces, never presented as photos of Nimba.
* **Post-processing** (`src/walk/post.ts`): the scene renders into a 4× MSAA HDR target, then:
  * GTAO ambient occlusion from the depth buffer, with normals reconstructed so there is no extra scene pass and the leaves keep their alpha cut-outs;
  * light bloom on the sun;
  * light shafts: a radial blur of the open sky toward the sun, only under a closed canopy, because in the open the whole sky glares;
  * contrast-adaptive sharpening, colour grading (saturation, filmic toe, warm highlights and cool shadows) and a vignette.
* **Lighting:** sky image-based light (PMREM of the sky dome) for leaf highlights and a soft fill. The hemisphere light is reduced to match, and shadows use a 4,096 px map.
* **Comparisons:** `docs/screens/fx-*-before.png` and `fx-*-after.png`, at the mid tier with fx off and on.
* **Not measured yet:** the GPU cost on real hardware. It is expected to suit desktops and recent laptops and iPads only, and phones stay on the light look.
* The network allowlist gained `api.polyhaven.com` and `dl.polyhaven.org` for the fetch script.

## Realism pass + real villages (night of 17–18 Nov 2026, Dean asleep, "push it live")

Dean sent a reference video (a chimpanzee on a forest trail) and asked for more realism, villages with people based on the real places, and that the result go live.

**What the reference shows that we lacked:**
* many thin, straight pole trunks with pale lichen-mottled bark;
* saplings with broad, glossy leaves;
* light-brown dry leaf litter;
* an open understorey with bright dappled light;
* a beaten-earth trail.

**Forest changes:**
* New `pole` plant (5–15 cm stems with lichen bark), up to about 300 per hectare under closed forest.
* `sapling` ground cover built from individual drawn leaves with drip tips.
* Herbs, ferns, shrubs and fallen branches thinned out.
* Brighter leaves and litter, and more fill light and exposure under closed canopy.
* Forest trails: a noise-based network, identical on CPU and GPU, kept clear of plants.
* High-quality mode adds six CC0 scanned models from Poly Haven (`scripts/fetch_models.mjs` → `public/walk/models/`, 1.7 MB, meshopt + WebP):
  * the fern and the broad-leaved herb replace the drawn ones;
  * scanned surface roots sit at the feet of the big trees;
  * the scanned rock replaces the boulders.

**Real places:** OpenStreetMap (ODbL), fetched by `scripts/worldpack/fetch_osm.py` through the OSM API. Overpass dropped the connection through the proxy. The extract is split into 3 km tiles in `public/walk/osm/`, 2.25 MB in total:
* 9,824 buildings;
* 2,578 roads and paths;
* 642 land-use areas;
* 42 named places.

Its uses:
* **Roads and paths** go into a 2 m distance field around the walker. They are drawn as beaten earth, and no plants grow on them.
* **The place chip** names the nearest village (Bossou, Séringbara, Gbakoré, N'Zoo, Yéalé, Yekepa…).
* **Houses** stand on the real footprints. Their shape and materials follow `docs/VILLAGE_SOURCES.md`:
  * round wattle-and-daub huts with thatch for small square footprints;
  * otherwise rectangular earth-plastered houses with corrugated metal roofs, some rusty, some with porches.
* **Villagers** are fictional, generic figures doing sourced everyday activities:
  * pounding in a mortar (palm fruit, per the Gret guide);
  * carrying water or a load, and a child with firewood (Guinea);
  * a mother with a baby on her back (Guinea);
  * hoeing in fields (rice and cassava at Bossou);
  * talking in the shade and children playing (generic, flagged);
  * walking the real OSM paths.

  Cards say "fictional figure" and cite the sources. Bossou cards add sourced village facts: about 2,000 people, Manon, rice, cassava and oil palm, the Wednesday market, and the chimpanzee taboo.
* **Never shown:** Mt Gban, the sacred forest; Poro/Sande societies; rites; masks; and chimpanzees near people. All of these are listed in `docs/VILLAGE_SOURCES.md`.
* The walk HUD shows "© OpenStreetMap", and the cards link the copyright page.

**Research:** done by a subagent, with sources and evidence levels, in `docs/VILLAGE_SOURCES.md`. It found dead links: the papfor.org PDFs for the `yeale` and `yekepa-lamco` hotspots now resolve to a parked domain. They are flagged and not yet changed.

**Network:** `overpass-api.de`, `api.openstreetmap.org` and `upload.wikimedia.org` were added to the environment allowlist. The fetch scripts need `NODE_USE_ENV_PROXY=1` behind the proxy.

**Sizes:** the walk chunk is 79 KB gz (GLTFLoader, meshopt and post-processing included), and the main bundle 184 KB gz. Village and OSM data load tile by tile.

**Not done / limits:**
* No chimpanzee model. A credible animated chimp needs a proper rigged model, and the rules ask for them wild and away from people.
* Faces are plain; villagers are simple rigged figures, not scans.
* No market scene; the Wednesday market is only mentioned in the cards.
* Fields are not yet drawn as rice or cassava rows.
* Real-GPU performance is still unmeasured.

### Live again (18 Nov 2026)
* Dean asked for the result to be pushed live, so the `ignoreCommand` pause is removed. Every push to this branch deploys to production again (nimba-3d.vercel.app).

## Every place looks like what is there: terrain types, water, rock, mines (18 Nov 2026)

Dean asked that walk mode match the real terrain type wherever you are, with water, rocks and the old mine, and then a clean-up, tests and a live push.

**Ground (`src/walk/terrainShader.ts`):** 11 layers in two texture arrays (colour and normals), so WebGL's sampler limit no longer caps the number of surface types. The layers are:
* forest litter, laterite, lowland turf, rock, moss;
* mud, beaten earth (roads and paths), mine benches and spoil, summit grass, river sand and gravel, worked fields.

Each fragment blends them from:
* canopy height, land cover, altitude and slope (measured data);
* streams and lakes (DEM + OSM), roads and paths (OSM);
* a 2 m area field rasterised from OSM land use: water, mine, field, rock, sand, wetland and the Guinean enclave.

Steep rock and mine faces use triplanar mapping, so cliffs do not stretch. The drawn layers are used on phones and the scanned CC0 layers (Poly Haven, 14 textures, 3.9 MB) in the high-quality mode. The new scans are `brown_mud_02`, `red_dirt_mud_01`, `red_mud_stones`, `aerial_grass_rock`, `coast_sand_rocks_02` and `farm_soil`. Draw cost is bounded: layers with a weight under 1.5 % are skipped, and samples use `textureGrad`.

**Water:**
* The 99 OSM rivers and streams join the DEM streams in the carved 2 m stream field and get ribbons at their mapped width (Diougou / upper Cavally, Ban, Goué, Kahnla…).
* OSM lakes, reservoirs and the flooded pit next to the LAMCO quarry are rasterised as "in the bed", so the ground is carved under them, and get a flat water surface just below the lowest DEM shore point.
* WorldCover water (80) and wetland (90) give mud and tall reeds.

**Rock:** WorldCover bare ground (60) and OSM cliff, bare rock and scree give the rock layer, dense stones and boulders, and no trees above 6 m.

**Mines:**
* **The old LAMCO workings in Liberia.** OSM quarry and brownfields; ESA's densest bare-ground cluster is the pit at −8.4995, 7.5394. They are shown as bare iron-ore ground with bench lines every 9 m of height and sparse grass, scrub and stones coming back (about 35 years after the mine closed in 1989). The card uses content.json's sourced `yekepa-lamco` text.
* **The Guinean "Mine de Nimba" enclave** (OSM outline). The sources describe exploration, and the land cover and canopy model show grassland and forest there. So the land keeps its measured cover, no pit is invented, and only the card says you are in the approximate enclave, with the sourced `mining-enclave` text (UNESCO 48 COM 7A.46).

**Fields:** OSM farmland and orchards, and WorldCover cropland, become worked soil with crop rows. The card says upland rice and cassava are the Bossou staples, with maize, banana, pineapple and fruit (Yamakoshi & Leblan 2013; Green Corridor).

**Clean-up:**
* Card logic moved from `walk/index.ts` into `walk/cards.ts`.
* The shader's layer scales are generated from the single TypeScript list.
* Unused parameters removed; the dev lab moved to `dev/walk-lab.html`.
* The unused `vite-plugin-pwa` dependency removed; it can be re-added for M10.
* npm scripts added for the checks and the data and asset pipelines.
* `README.md` is now the app README: run, code map, data rebuild, checks, licences. The kit's hand-over notes moved to `docs/KIT_README.md`.

**Tests:**
* `npm run build` passes: walk chunk 82 KB gz, main 187 KB gz.
* `check-walk-flow` passes.
* `check-panel` covers all 23 hotspots in FR and EN, on phone and desktop.
* Terrain screenshots: `docs/screens/terrain-*.png`.

### Lakes, place label and open-air fog (follow-up)
- **Lakes were invisible:** they reused the stream shader, whose edge fade is driven by the ribbon's u coordinate
  (0..1 across a stream). Lake UVs are world-scale, so the fade was 0 everywhere. Still water is now flagged by its
  flow attribute (< 0.05) and drawn opaque-ish with sky reflections and slow ripples.
- **Lake level:** the lowest shore point sat ~8 m under the measured water surface at the LAMCO pit lake (shore
  outliers). The DEM over water is the water surface, so the level is now the lower quartile of heights sampled
  inside the outline, − 0.3 m (pit lake: ≈ 852.8 m; interior median 853.4 m).
- **Place label** follows the mapped surface under the walker or within 15 m (lakeshore, former mine / LAMCO,
  rock, sand, wetland, fields, enclave) before the habitat name (it said "stream bank" next to the pit lake).
- **Fog:** open mapped ground (water, mines, rock, sand, fields) uses open-air fog instead of the forest-creek fog
  that turned the open pit into a white wall.
