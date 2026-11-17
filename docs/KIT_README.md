# Nimba demo kit – how to hand this to Claude Code

This folder is a **complete brief + data pack** for a 3D, click-to-learn web demo of the Monts Nimba (Guinea / Côte d'Ivoire / Liberia) for the CSIG P19 pilot.

## What is inside
| Path | What |
|---|---|
| `CLAUDE.md` | The main brief Claude Code reads automatically: purpose, flows, stack decision, budgets, milestones M0–M10, acceptance checklist |
| `DESIGN.md` | Palette, fonts, layouts (phone/tablet/desktop), pins, panel, flyover, atmosphere, modes, footer |
| `public/data/` | Real terrain (Copernicus GLO-30), land cover (ESA WorldCover), boundaries, `content.json` (23 hotspots FR/EN with sources), preview image |
| `assets/photos/` | 32 openly licensed photos (Wikimedia Commons) + `credits.json` + `alt_text.json` |
| `scripts/` | Rebuild scripts (DEM fetch with GDAL or Python, terrain/mesh/heightmaps, land cover, boundaries, photos) |
| `docs/GEO_DATA.md` | Coordinates, bounds, peaks, places, gaps and conflicts |
| `docs/DATA_LICENCES.md` | Licences and the exact attribution text to show (WDPA is **non-commercial**) |

## Steps
1. Install Claude Code, unzip this kit, `cd nimba-demo-kit`, run `claude`.
2. Paste the first prompt below.
3. Review each milestone's screenshots (phone, tablet, desktop) before approving the next one.

## First prompt to paste
```
Read CLAUDE.md, DESIGN.md, docs/GEO_DATA.md and docs/DATA_LICENCES.md in this folder completely. Then build the Monts Nimba 3D demo exactly as specified: Vite + TypeScript + vanilla three.js, using only the data already in public/data and assets/photos (do not invent facts, coordinates or photos). Work milestone by milestone (M0 to M10 in CLAUDE.md), run the app and check it in a browser at 390x844, 820x1180 and 1440x900 after each milestone, commit after each, and keep docs/BUILD_NOTES.md updated. Start with M0 and M1 now, show me screenshots, then continue to M3 without waiting unless something blocks you.
```

## Notes for you (Dean)
* Everything here is a **non-commercial, unofficial prototype**. The reserve boundary comes from WDPA (non-commercial licence); replace it with an official boundary before any commercial or public launch.
* Facts flagged `uncertain` in `content.json` need a local check (CEGENS, OIPR, IREB, Kyoto University): current chimpanzee count, IREB status, mining enclave outline, peak heights.
* No photos were found for the Nimba otter shrew and Lamotte's bat; the app shows an illustration placeholder. Ask CEGENS/IREB for permissioned photos.
* To rebuild data: `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt && .venv/bin/python scripts/build_terrain.py` (also `build_landcover.py`, `fetch_boundaries.py`). Re-running `fetch_photos.py` overwrites alt text (backup in `assets/photos/alt_text.json`).
