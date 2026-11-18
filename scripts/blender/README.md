# Photo-real 360° renders (Blender / Cycles)

`nimba_render.py` builds a true-scale scene of the Monts Nimba from the app's own data and renders it with
Cycles: still images or 360° panoramas that the web app shows in its **"Vue 360° / 360° view"** viewer
(`src/ui/pano.ts`, offered in walk mode and at the guided-tour stops).

What is real and what is not:

| Part | Source |
|---|---|
| Relief | Copernicus GLO-30 (walk-mode tiles, 15 m) + generated micro-relief |
| Where forest, grass, bare ground, rock are | Meta/WRI canopy height, ESA WorldCover, rock mask (same tiles) |
| Ground surfaces | the app's scanned CC0 textures (`public/walk/tex/`) |
| Plants and rocks | generic CC0 scans from [Poly Haven](https://polyhaven.com) – **not Nimba species** |
| Sky, sun, haze, sea of clouds | physical sky + volumes, light presets as in walk mode |

The images are **computer-generated illustrations, not photographs**; the viewer says so on screen.

## Run it

Needs Blender 5.x (or `pip install bpy==5.3.0` with Python 3.13) and the repository.

```bash
python scripts/blender/fetch_assets.py 2k
```

(Without a separate Python, e.g. on Windows: `blender -b --python scripts/blender/fetch_assets.py -- 2k`.)

```bash
blender -b --python scripts/blender/nimba_render.py -- --spot summit --pano --res 4096 --samples 256 --gpu --publish
```

`--publish` copies the panorama into `public/pano/` (`<spot>.jpg` and a 2048 px `<spot>_2k.jpg` for phones)
and lists it in `public/pano/panos.json`; commit those files and the app offers the 360° view at that place.

| Option | Default | |
|---|---|---|
| `--spot` | summit | summit, grassland, lamco, forest, bossou (see `SPOTS`) |
| `--pano` | off | equirectangular 360° (2:1); otherwise a 16:9 still |
| `--res` / `--samples` | 1024 / 32 | 4096 / 256 for final panoramas (GPU) |
| `--gpu` | off | OptiX → CUDA → HIP → oneAPI → Metal, first found |
| `--time` | per spot | morning, noon, mist |
| `--spacing`, `--near`, `--far-spacing` | 2 m, 900 m, 30 m | fine ground grid, its half-size, far massif grid |
| `--trees`, `--density` | 450 m, 1.0 | radius with instanced trees, ground-cover density |
| `--no-clouds`, `--no-plants` | | quick tests |
| `--yaw`, `--pitch` | per spot | view direction (walk-mode convention) |
| `--blend file.blend` | | also save the scene to open it in Blender |

Quick CPU test (≈ 1 min): `--res 800 --samples 12 --spacing 5 --far-spacing 60 --near 700 --density 0.7`.
Typical times: 3072 × 1536 at 32 samples ≈ 30–40 min on a CPU; 4096 × 2048 at 256 samples is a few minutes
on a recent GPU.

## Notes

* Poly Haven's glTF files take leaf/grass transparency from the colour JPEG (no alpha), so the fetcher also
  downloads the separate `*_alpha_*.jpg` masks and the script wires them in, with leaf translucency.
* `grass_medium_01` is not used (renders almost black under this light).
* Sun direction: the sky node's `sun_rotation` is the compass azimuth (0 = north, clockwise), measured.
* Credits: `assets/credits.json` (all CC0).
