# Open world development notes

## Direction and source checkout

- Extend the existing Vite / TypeScript / three.js walk mode. The map, tour and bilingual content remain supported. No native-engine migration and no VR.
- Source baseline: `cba3f1b4a1d216b3387ec9594d2041209aca5ffb`, branch `claude/new-session-96lrge` of `Dine706/Virtual-Museum`. The separately selected `GTP-WORLD` repository was empty.
- Reused the committed browser assets; no terrain or biodiversity records were fetched again from their providers. The cloud checkout initially used sparse checkout; `public/` and `assets/` have now been hydrated from Git.

## Cloud capabilities actually checked

- Linux x86-64, 32 GiB memory limit, four-core CPU quota; no exposed NVIDIA device. Performance observations here describe software rendering, not an RTX GPU or a real phone.
- System Blender 4.3.2 supports headless execution, with CPU Cycles only. Python 3.13 is available, but its standard `venv` lacks `ensurepip`. `uv pip` can install into a virtual environment without that bootstrap.
- Installed `bpy==5.3.0` in `/workspace/.tools/nimba-blender`, outside the repository. Import reports Blender 5.3.0 and the glTF exporter is available. The Python wheel is about 428 MB; no paid tools were used.
- System Chromium and global Playwright render WebGL2 with ANGLE / SwiftShader. Set `BROWSER_PATH=/usr/bin/chromium` for repository checks: the bundled Playwright browser is absent.
- GitHub read, npm registry, PyPI and the live Vercel site were reachable. Vercel returned HTTP 200; that is not a deployment or a gameplay test.
- Node 24 is the system default. The repository pins Node 22; the production build was also exercised with the npm-distributed Node 22 runtime.
- The session's image generation tool produced eight scenery illustrations and eleven material/reference images after Dean requested generated replacement imagery. Captions use “Digital reconstruction”, without an “AI” badge. Prompts, hashes and provenance are retained under `scripts/blender/reference/world-art/`; no external paid image service was added.

## Data and visual constraints learned from the source

- The 1 m hero-zone terrain grids resample a 30 m Copernicus DEM. Canopy heights are model-derived. Fine rocks, paths, gullies, individual plants and people are reconstructions, not surveyed detail (`worldpack/REPORT.md`).
- `worldpack/` uses EPSG:32629; browser tiles, OSM extracts and crown centres use the app's local longitude/latitude frame (`scripts/worldpack/build_walk_data.py`). Crown centres are derived from detected crowns, not zone-centre coordinates. Convert through geographic coordinates when introducing the hero rasters; do not align these grids by copying their array indices.
- The LAMCO lake uses the lower quartile of interior DEM samples minus 0.3 m, approximately 852.8 m in the existing data (`docs/BUILD_NOTES.md`, `src/walk/water.ts`).
- `public/photos/cloud-forest.jpg` supplies a useful reference for the forest/grassland mosaic and haze, but is a distant landscape photograph, not an understorey photograph. The procedural low-tier canopy and bark remain visibly artificial; a screenshot cannot establish species identity.
- Real-plant work must resolve the request's Cyathea terminology against the existing code's Alsophila label using botanical sources. Do not silently assert they identify the same species.
- Most species photo candidates have NC licences. Retain per-image attribution and usage constraints; the database is not an unrestricted asset library.

## M1 implementation decisions

- Keep all new controls and settings within the lazy walk chunk. Persist validated FOV, sensitivity, head bob, reduced motion and walk quality. Explicit `?tier=` still overrides the saved quality for reproducible tests.
- Quality changes apply on the next walk entry; FOV, sensitivity and motion settings apply immediately. A native modal dialog pauses movement, releases pointer lock and supports keyboard focus.
- Feet move in real metres. Substeps enforce slope/step limits and collision, with gravity, jumping and falling. The same terrain-height function still drives the visual ground and player.
- Standard gamepads use left/right sticks, A for jump and L1/left-stick press for sprint. Touch keeps the existing joystick and adds a jump button.
- High quality increases near-tree geometry distance, foliage/impostor resolution, ground tessellation and shadows. It also loads generated canopy, bark and litter textures and a Blender-animated generic sapling. Low and Mid geometry/texture settings are unchanged.
- Telemetry logs real frame intervals; the old walk FPS calculation used a clamped simulation delta and could hide slow frames. CPU-rendered timings must remain labelled as such.
- Checks now accept an explicit Chromium path. Walk and screenshot checks return failure for collected errors rather than only printing them. New physics checks exercise slope, jump, edge fall, boundaries, frame-rate independence and collision substeps.
- The final High look uses generated maps for every ground/bark role, with shared source textures for related surfaces. The generic canopy texture is loaded before impostor baking. Full-resolution captures freeze after an actual rendered frame, avoiding an unbounded render queue on SwiftShader.
- Final build/test evidence and the remaining pre-existing software-renderer timing failures are recorded in `docs/BUILD_NOTES.md`. No real GPU FPS or GPU-memory claim is made.

## Next milestones

1. M2: continuous streamed walking routes and bounded caches, seamless hero-raster integration and lake validation.
2. M3: sourced hero-plant references, headless Blender assets, LODs and photographic review.
3. M4: animal sheets and reviewed references in the requested order. The approved generated-artwork workflow does not remove species-reference or sensitive-location requirements.
4. M5: village geometry and only documented fictional activities.
5. M6: weather, time, seasons and individually licensed audio.
6. M7: discoveries, map, fast travel, photo mode and complete credits/reconstruction disclosure.
7. M8: every-tier budgets and release validation. Hardware FPS and true GPU-memory targets require a GPU-enabled test environment.

## Technical references

- Project brief: `CLAUDE.md`, `DESIGN.md`, `README.md`.
- Data provenance: `worldpack/README.md`, `worldpack/REPORT.md`, `worldpack/ASSETS.md`, `docs/GEO_DATA.md`, `docs/DATA_LICENCES.md`.
- Cultural constraints: `docs/VILLAGE_SOURCES.md`.
- Asset tooling: `scripts/blender/README.md`, `scripts/blender/nimba_render.py`, `scripts/blender/fetch_assets.py`.
- Blender distribution: <https://download.blender.org/release/Blender5.3/>; Python wheel metadata: <https://pypi.org/pypi/bpy/5.3.0/json>.
- Browser architecture and tests: `src/walk/`, `scripts/check-*.mjs`, `scripts/screens.mjs`.
