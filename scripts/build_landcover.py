#!/usr/bin/env python3
"""ESA WorldCover 2021 (10 m, CC BY 4.0) -> landcover class map + baked albedo texture for the terrain.
Reads the COG straight from AWS (no 600 MB download).  Outputs in public/data/:
  landcover_classes.png   1008x1008 8-bit, pixel value = WorldCover class code (10 tree, 20 shrub, 30 grass, 40 crop, 50 built, 60 bare, 80 water, 90 wetland)
  albedo_2048.jpg         2048x2048 colour map = smoothed class colours x hillshade (use as the base colour texture; add detail noise in the shader)
Attribution: 'Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium' - ESA WorldCover 10 m 2021 v200, CC BY 4.0."""
import os, json, numpy as np, rasterio
from rasterio.windows import from_bounds
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PUB = os.path.join(ROOT, "public", "data")
W, S, E, N = -8.56, 7.48, -8.28, 7.76
URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N06W009_Map.tif"
with rasterio.open(URL) as ds: lc = ds.read(1, window=from_bounds(W, S, E, N, ds.transform))
lc_img = Image.fromarray(lc)
lc_img.resize((1008, 1008), Image.NEAREST).save(os.path.join(PUB, "landcover_classes.png"), optimize=True)
pal = {10: (47, 93, 52), 20: (110, 139, 61), 30: (184, 176, 97), 40: (201, 178, 107), 50: (154, 143, 134), 60: (183, 165, 138), 80: (60, 124, 156), 90: (80, 140, 120), 95: (60, 120, 90), 70: (240, 240, 240), 100: (150, 150, 120)}
rgb = np.zeros(lc.shape + (3,), "uint8")
for k, v in pal.items(): rgb[lc == k] = v
col = Image.fromarray(rgb).resize((2048, 2048), Image.BILINEAR).filter(ImageFilter.GaussianBlur(3))
hs = Image.open(os.path.join(PUB, "hillshade.png")).convert("L").resize((2048, 2048), Image.BICUBIC)
c = np.asarray(col).astype("float32") / 255; h = (np.asarray(hs).astype("float32") / 255)[..., None]
out = np.clip(c * (0.45 + 0.9 * h), 0, 1)
Image.fromarray((out * 255).astype("uint8")).save(os.path.join(PUB, "albedo_2048.jpg"), quality=84, optimize=True)
Image.open(os.path.join(PUB, "albedo_2048.jpg")).resize((1024, 1024), Image.LANCZOS).save(os.path.join(PUB, "albedo_1024.jpg"), quality=82, optimize=True)  # mobile
print({int(k): int(v) for k, v in zip(*np.unique(lc, return_counts=True))})
