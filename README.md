# Monts Nimba 3D – interactive demo

An unofficial **Phase 0 prototype** for the CSIG (Cité des Sciences et de l'Innovation de Guinée), fiche P19 "Musée virtuel et patrimoines UNESCO", built by Tech Guinée. Live at **https://nimba-3d.vercel.app**.

It has two views:
* **The 3D map:** the whole Nimba massif from the real terrain, with 23 sourced hotspots (French / English), photos, sources and modes.
* **Walk mode:** walk on the ground anywhere in the 31 km window. Tap the terrain → "Marcher ici", use the walk button in a hotspot panel, zoom in past the closest view, or open a `#/walk/<lon>,<lat>` link. The ground, forest, water, rocks, mines, fields and villages are built from measured and mapped data. Tap anything for a sourced card.

## Run it

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm run build
```

The build output in `dist/` is a static site. Vercel builds it from `vercel.json` on every push to the deployed branch.

URL flags:
* `?skipintro=1` skips the title and flyover;
* `?debug=1` shows uncertain badges, an FPS meter and the test hooks;
* `?tier=high|mid|low` forces a quality tier;
* `?fx=1|0` turns walk mode's high-quality look (generated surface textures, post-processing) on or off.

### Open-world development build

Walk mode now includes jumping, gravity, slope limits, rock collision, a standard-gamepad mapping,
touch jump and a compass. Open **Réglages / Settings** while walking to change FOV, sensitivity,
head bob, reduced motion and language. Quality selection applies on the next walk entry.

All 23 cards use generated landscape illustrations with **Digital reconstruction** captions.
Original licensed photographs remain as documentary references. High-quality walk mode adds
generated canopy/bark/litter textures and a small Blender-animated generic sapling. The sapling
is a filler, not an identified Nimba species. This is the first open-world implementation milestone;
the complete hero-plant/animal/weather/exploration roadmap remains in `docs/OPEN_WORLD_NOTES.md`.

Credits are available from walk settings and `credits.html`; `CREDITS.md` and `public/credits.json`
record attribution. Image-generation prompts, hashes and rebuild instructions are under
`scripts/blender/reference/world-art/`. The compressed runtime images and model are committed;
raw generation PNGs and the Blender scene stay outside tracked production assets.

Additional checks:

```bash
npm run check:walk-physics
npm run check:world-art
BROWSER_PATH=/usr/bin/chromium npm run check:walk-controls
BROWSER_PATH=/usr/bin/chromium npm run check:walk-quality
BROWSER_PATH=/usr/bin/chromium npm run check:art-ui
```

`BROWSER_PATH` is optional when Playwright's bundled Chromium is installed. `BASE_URL` selects
a running dev or preview server; screenshot/report output paths can be set with `RESULTS_DIR`.
Use Node 22.23+ (or Node 24) for native TypeScript stripping in the physics check. Software-renderer
FPS and JS heap figures do not establish GPU performance or total GPU-memory use.

For Blender assets, use Python 3.13 and `scripts/blender/requirements.txt`. The tested cloud
interpreter is `/workspace/.tools/nimba-blender/bin/python`; the asset README has exact commands.

## Code map

| Path | What |
|---|---|
| `src/main.ts` | Boot, the 3D map, hotspot selection, routing (`#/h/<id>`, `#/walk/<lon>,<lat>`) |
| `src/scene/` | Map renderer: terrain mesh and shader, sky, clouds, overlays, flyover, camera, picking, quality tiers |
| `src/ui/` | DOM UI: title card, pins, panel, photo viewer, readout, labels, chrome |
| `src/data/` | Content, geography, regions, loaders |
| `src/i18n/` | French / English strings (every UI label) |
| `src/walk/` | Walk mode (lazy chunk). Main modules below. |
| `src/walk/index.ts` | Orchestration |
| `src/walk/data.ts` | Tiles, streams, paths, OSM areas and buildings: one height function shared by CPU and GPU |
| `src/walk/ground.ts`, `src/walk/terrainShader.ts` | Ground patch, 11 ground layers, far massif, clouds |
| `src/walk/forest.ts`, `src/walk/plants.ts`, `src/walk/groundcover.ts` | Trees and plants |
| `src/walk/water.ts` | Streams, rivers, lakes |
| `src/walk/village.ts` | Houses on OSM footprints, villagers |
| `src/walk/fauna.ts` | Animals |
| `src/walk/cards.ts` | Sourced info cards |
| `src/walk/post.ts`, `src/walk/photo.ts`, `src/walk/models.ts` | High-quality look |
| `public/data/` | Map data (terrain, land cover, boundaries, `content.json`) |
| `public/walk/` | Walk-mode data (see below) |
| `public/photos/` | Licensed photos (JPEG / WebP / AVIF) with `credits.json` |
| `worldpack/` | Data pack for the future Unreal Engine world (see `worldpack/README.md`) |
| `docs/` | `BUILD_NOTES.md` (decisions and measurements), `VILLAGE_SOURCES.md`, `GEO_DATA.md`, `DATA_LICENCES.md`, `UNREAL_MAC_SETUP.md` |
| `scripts/` | Data rebuild scripts and browser checks |

## Rebuilding the data

Python tools:

```bash
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt rasterio scipy shapely pyproj requests
```

Map data (`public/data/`):
* `scripts/build_terrain.py`
* `build_landcover.py`
* `fetch_boundaries.py`
* `fetch_photos.py` – note that it overwrites `credits.json`; `assets/photos/alt_text.json` is the backup.

World pack and walk mode, in this order:

```bash
.venv/bin/python scripts/worldpack/build_terrain_forest.py
```

```bash
.venv/bin/python scripts/worldpack/build_species.py
```

```bash
.venv/bin/python scripts/worldpack/fetch_osm.py
```

```bash
.venv/bin/python scripts/worldpack/build_walk_data.py
```

In more detail:
* **`build_terrain_forest.py`:** Copernicus DEM, Meta/WRI canopy height and ESA WorldCover from AWS open data → `worldpack/terrain`, `worldpack/zones`.
* **`build_species.py`:** GBIF, Wikidata and iNaturalist → `worldpack/species`.
* **`fetch_osm.py`:** OpenStreetMap buildings, roads, rivers, land use and places → `public/walk/osm/`.
* **`build_walk_data.py`:** walk tiles, tree crowns, streams, species → `public/walk/`.

Scanned CC0 textures and models from Poly Haven (behind a proxy, add `NODE_USE_ENV_PROXY=1`):

```bash
node scripts/fetch_textures.mjs
```

```bash
node scripts/fetch_models.mjs
```

Raw downloads are cached in `.worldpack-cache/`, which is git-ignored.

## Checks

Run these with `npm run dev` running in another terminal. They use Playwright and Chromium.

| Script | What it checks |
|---|---|
| `node scripts/check-panel.mjs` | All 23 hotspots open in FR and EN, on phone and desktop |
| `node scripts/check-walk-flow.mjs` | Phone flow: readout → walk → card → back |
| `node scripts/check-tour.mjs` | Guided tour: all five stops on phone and desktop, captions, back to the map |
| `node scripts/check-walk.mjs [tier]` | Walk mode at five places, with screenshots |
| `node scripts/screens.mjs` | Screens at 390 × 844, 820 × 1180 and 1440 × 900 |
| `check-picking`, `check-overlays`, `check-flyover`, `check-perf` | The M5–M8 acceptance checks |

## Data and licences

| Data | Source and licence |
|---|---|
| Terrain | Copernicus DEM GLO-30 |
| Canopy height | Meta / WRI (CC BY 4.0) |
| Land cover | ESA WorldCover (CC BY 4.0) |
| Reserve boundary | WDPA (non-commercial) |
| Buildings, roads, rivers, land use | © OpenStreetMap contributors (ODbL) |
| Species records | GBIF (per dataset) |
| Photos | Wikimedia Commons (per photo) |
| Scanned textures and models | Poly Haven (CC0) |

The exact attribution texts are in `docs/DATA_LICENCES.md` and `worldpack/README.md`.

Content rules (CLAUDE.md §10):
* sourced facts only;
* threatened species never at precise places;
* no sacred sites, rites or masks;
* chimpanzees shown with respect;
* every villager is a fictional figure.

The kit's original hand-over notes are in `docs/KIT_README.md`.
