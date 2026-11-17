#!/usr/bin/env python3
"""Stage 1 – terrain + forest data pack for the Unreal world (worldpack/).

Reads open data straight from AWS (no account needed):
  * Copernicus DEM GLO-30 (DSM, 30 m)            – copernicus-dem-30m bucket
  * Meta/WRI global canopy height v1 (≈1.2 m)    – dataforgood-fb-data bucket (Tolan et al. 2024, CC BY 4.0)
  * ESA WorldCover 2021 v200 (10 m)              – esa-worldcover bucket (CC BY 4.0)
and writes, in UTM 29N metres:
  * massif:  2017×2017 px at 15 m (30.24 km square centred on lon0/lat0 of the web demo)
  * 4 hero zones: 2017×2017 px at 1 m (2.016 km squares)
  for each: 16-bit PNG heightmaps for Unreal (dsm = surface incl. canopy, ground = dsm − canopy height,
  approximate), canopy height (8-bit, metres), land cover (8-bit WorldCover code), 8-bit weight masks
  (forest, grass, rock, stream, altitude bands), meta.json with Unreal import settings, preview.jpg.
  plus streams.geojson derived from the ground model (D8 flow accumulation – approximate).

Usage:  .venv/bin/python scripts/worldpack/build_terrain_forest.py [--only massif|zones] [--zones id,id]
Raw reads are cached in .worldpack-cache/ (git-ignored).
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import from_bounds
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'worldpack'
CACHE = ROOT / '.worldpack-cache'
UTM = 'EPSG:32629'  # UTM zone 29N – Nimba (≈ −8.4°) lies in zone 29

DEM_URL = 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N07_00_W009_00_DEM/Copernicus_DSM_COG_10_N07_00_W009_00_DEM.tif'
WC_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N06W009_Map.tif'
CHM_TILES = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{}.tif'
# Quadkey tiles (zoom 9) covering the 3D window, with their EPSG:4326 bounds (from tiles.geojson).
CHM_TILE_IDS = ['033330211', '033330300', '033330213', '033330302']

MASSIF = {'id': 'massif', 'lon': -8.42, 'lat': 7.62, 'size_px': 2017, 'spacing_m': 15.0}
ZONES = [
    {'id': 'z1-summit', 'name_fr': 'Sommet – Mont Richard-Molard', 'name_en': 'Summit – Mount Richard-Molard',
     'lon': -8.4083, 'lat': 7.6219,
     'why': 'Montane grassland meeting the cloud-forest edge around the highest point (994–1,755 m).'},
    {'id': 'z2-cloud-forest', 'name_fr': 'Forêt de nuage', 'name_en': 'Cloud forest',
     'lon': -8.4000, 'lat': 7.6700,
     'why': 'The montane / cloud-forest belt on the north-western slope (≈ 775–1,570 m).'},
    {'id': 'z3-bossou', 'name_fr': 'Collines de Bossou', 'name_en': 'Bossou hills',
     'lon': -8.5054, 'lat': 7.6487,
     'why': 'Forested hills of Bossou (chimpanzee forest, publicly known site) and the village edge (≈ 535–700 m).'},
    {'id': 'z4-lowland-forest', 'name_fr': 'Forêt de piémont', 'name_en': 'Foothill forest',
     'lon': -8.4400, 'lat': 7.6750,
     'why': 'Tall lowland forest of the foothills with DEM-derived streams (≈ 545–660 m).'},
]
for z in ZONES:
    z.update(size_px=2017, spacing_m=1.0)

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                GDAL_HTTP_MAX_RETRY='4', GDAL_HTTP_RETRY_DELAY='2', VSI_CACHE='TRUE')

to_utm = Transformer.from_crs('EPSG:4326', UTM, always_xy=True)
from_utm = Transformer.from_crs(UTM, 'EPSG:4326', always_xy=True)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- grids

def grid(spec):
    """Square UTM grid centred on lon/lat. Pixel centres span the extent exactly (Unreal vertex = pixel)."""
    cx, cy = to_utm.transform(spec['lon'], spec['lat'])
    n, s = spec['size_px'], spec['spacing_m']
    ext = (n - 1) * s
    # Pixel-is-area transform whose pixel *centres* sit on the vertex lattice.
    west = cx - ext / 2 - s / 2
    north = cy + ext / 2 + s / 2
    return {'transform': from_origin(west, north, s, s), 'shape': (n, n), 'cx': cx, 'cy': cy, 'extent_m': ext}


def grid_bounds_lonlat(g, pad_m=0.0):
    t, (h, w) = g['transform'], g['shape']
    xs = [t.c - pad_m, t.c + w * t.a + pad_m]
    ys = [t.f + pad_m, t.f + h * t.e - pad_m]
    pts = [from_utm.transform(x, y) for x in xs for y in ys]
    return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))


def warp_to(src_arr, src_transform, src_crs, g, resampling, src_nodata=None, dtype=np.float32):
    dst = np.zeros(g['shape'], dtype=dtype)
    reproject(src_arr, dst, src_transform=src_transform, src_crs=src_crs, src_nodata=src_nodata,
              dst_transform=g['transform'], dst_crs=UTM, resampling=resampling)
    return dst


# ---------------------------------------------------------------- sources (cached)

def cached(name, fn):
    CACHE.mkdir(exist_ok=True)
    p = CACHE / f'{name}.npz'
    if p.exists():
        d = np.load(p, allow_pickle=True)
        return d['arr'], tuple(d['transform']), str(d['crs'])
    arr, transform, crs = fn()
    np.savez_compressed(p, arr=arr, transform=np.array(tuple(transform)[:6]), crs=np.array(crs))
    return arr, tuple(transform)[:6], crs


def read_window(url, bounds_lonlat, name):
    def fn():
        with rasterio.Env(**GDAL_ENV), rasterio.open('/vsicurl/' + url) as ds:
            win = from_bounds(*bounds_lonlat, ds.transform).round_offsets().round_lengths()
            arr = ds.read(1, window=win)
            return arr, ds.window_transform(win), ds.crs.to_string()
    a, t, c = cached(name, fn)
    return a, rasterio.Affine(*t), c


def read_chm(bounds_lonlat, name, factor=1):
    """Mosaic the canopy-height tiles over a lon/lat box in EPSG:3857, optionally block-averaged by `factor`."""
    def fn():
        merc = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
        x0, y0 = merc.transform(bounds_lonlat[0], bounds_lonlat[1])
        x1, y1 = merc.transform(bounds_lonlat[2], bounds_lonlat[3])
        res = 1.1943285669558783 * factor
        W, H = int(math.ceil((x1 - x0) / res)), int(math.ceil((y1 - y0) / res))
        out = np.zeros((H, W), np.float32)
        cnt = np.zeros((H, W), np.float32)
        mos_t = from_origin(x0, y1, res, res)
        for tid in CHM_TILE_IDS:
            with rasterio.Env(**GDAL_ENV), rasterio.open('/vsicurl/' + CHM_TILES.format(tid)) as ds:
                l, b, r, t = ds.bounds
                ix0, iy0, ix1, iy1 = max(l, x0), max(b, y0), min(r, x1), min(t, y1)
                if ix0 >= ix1 or iy0 >= iy1:
                    continue
                win = from_bounds(ix0, iy0, ix1, iy1, ds.transform).round_offsets().round_lengths()
                # Read in strips (stripped COG, 1-row blocks) and block-average.
                strip = 1200 if factor == 1 else factor * max(1, 1200 // factor)
                for r0 in range(0, win.height, strip):
                    rh = min(strip, win.height - r0)
                    sw = rasterio.windows.Window(win.col_off, win.row_off + r0, win.width, rh)
                    a = ds.read(1, window=sw).astype(np.float32)
                    st = ds.window_transform(sw)
                    if factor > 1:
                        hh, ww = (a.shape[0] // factor) * factor, (a.shape[1] // factor) * factor
                        if hh == 0 or ww == 0:
                            continue
                        a = a[:hh, :ww].reshape(hh // factor, factor, ww // factor, factor).mean(axis=(1, 3))
                    # place into mosaic
                    c0 = int(round((st.c - mos_t.c) / res))
                    r0m = int(round((mos_t.f - st.f) / res))
                    hh, ww = a.shape
                    rs, cs = max(0, r0m), max(0, c0)
                    re, ce = min(H, r0m + hh), min(W, c0 + ww)
                    if re > rs and ce > cs:
                        out[rs:re, cs:ce] += a[rs - r0m:re - r0m, cs - c0:ce - c0]
                        cnt[rs:re, cs:ce] += 1
                log(f'  chm tile {tid} read')
        out = np.where(cnt > 0, out / np.maximum(cnt, 1), 0)
        # Seams between tiles (rounding leaves 1-px gaps): fill every empty pixel from its nearest valid one.
        empty = cnt == 0
        if empty.any() and (~empty).any():
            idx = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
            out = out[tuple(idx)]
            log(f'  chm: filled {int(empty.sum())} seam/edge pixels')
        return out, mos_t, 'EPSG:3857'
    a, t, c = cached(name, fn)
    return a, rasterio.Affine(*t), c


# ---------------------------------------------------------------- outputs

def save_u16(path, arr, lo, hi):
    v = np.clip((arr - lo) / (hi - lo), 0, 1) * 65535
    Image.fromarray(np.round(v).astype(np.uint16)).save(path, optimize=True)


def save_u8(path, arr):
    Image.fromarray(np.clip(np.round(arr), 0, 255).astype(np.uint8)).save(path, optimize=True)


def unreal_import(g, lo, hi):
    """Unreal: Z scale 100 maps the 16-bit range to 512 m; value 32768 = actor Z."""
    s = g['transform'].a
    return {
        'heightmap_resolution': f"{g['shape'][1]} x {g['shape'][0]}",
        'scale_cm': {'x': round(s * 100, 4), 'y': round(s * 100, 4), 'z': round((hi - lo) / 512 * 100, 6)},
        'location_cm': {'x': 0, 'y': 0, 'z': round((lo + hi) / 2 * 100, 2)},
        'note': 'Import as a new Landscape (File → Import from file), set these scale values, then set the Landscape actor '
                'location Z: elevations then match real metres above sea level (1 Unreal unit = 1 cm).',
        'height_range_m': [round(float(lo), 2), round(float(hi), 2)],
        'vertical_precision_cm': round((hi - lo) / 65535 * 100, 3),
    }


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def slope_deg(z, spacing):
    gy, gx = np.gradient(z, spacing)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def hillshade(z, spacing, az=315, alt=45):
    gy, gx = np.gradient(z, spacing)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = np.radians(az), np.radians(alt)
    return np.clip(np.sin(b) * np.cos(slope) + np.cos(b) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def preview(path, ground, chm, lc, streams_mask, spacing):
    hs = hillshade(ground, spacing)
    base = np.stack([hs] * 3, -1) * 0.55 + 0.25
    green = np.array([0.18, 0.42, 0.16])
    straw = np.array([0.72, 0.68, 0.40])
    f = smoothstep(2, 20, chm)[..., None]
    col = base * (1 - 0.6 * f) + green * 0.6 * f
    grass = ((lc == 30) | (lc == 20))[..., None] * (1 - f)
    col = col * (1 - 0.45 * grass) + straw * 0.45 * grass
    if streams_mask is not None:
        w = (streams_mask / 255.0)[..., None]
        col = col * (1 - w) + np.array([0.2, 0.45, 0.8]) * w
    img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
    img.thumbnail((1024, 1024))
    img.save(path, quality=85)


# ---------------------------------------------------------------- hydrology (approximate, from the ground model)

def flow_accumulation(z):
    """Priority-flood depression filling + D8 accumulation (cells). Fine for ~1 M cells."""
    h, w = z.shape
    filled = z.astype(np.float64).copy()
    closed = np.zeros(z.shape, bool)
    pq = []
    for r in range(h):
        for c in (0, w - 1):
            heapq.heappush(pq, (filled[r, c], r, c)); closed[r, c] = True
    for c in range(1, w - 1):
        for r in (0, h - 1):
            heapq.heappush(pq, (filled[r, c], r, c)); closed[r, c] = True
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    eps = 1e-4
    while pq:
        e, r, c = heapq.heappop(pq)
        for dr, dc in nb:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and not closed[rr, cc]:
                closed[rr, cc] = True
                if filled[rr, cc] <= e:
                    filled[rr, cc] = e + eps
                heapq.heappush(pq, (filled[rr, cc], rr, cc))
    # D8 receivers on the filled surface
    pad = np.pad(filled, 1, mode='edge')
    best = np.zeros(z.shape, np.int8) - 1
    bestdrop = np.zeros(z.shape)
    for k, (dr, dc) in enumerate(nb):
        nbz = pad[1 + dr:1 + dr + h, 1 + dc:1 + dc + w]
        drop = (filled - nbz) / (math.sqrt(2) if dr and dc else 1)
        better = drop > bestdrop
        best[better] = k
        bestdrop[better] = drop[better]
    order = np.argsort(-filled, axis=None)
    acc = np.ones(h * w, np.float64)
    bf = best.ravel()
    for idx in order:
        k = bf[idx]
        if k < 0:
            continue
        r, c = divmod(idx, w)
        rr, cc = r + nb[k][0], c + nb[k][1]
        if 0 <= rr < h and 0 <= cc < w:
            acc[rr * w + cc] += acc[idx]
    return acc.reshape(h, w), best


def trace_streams(acc, best, transform, min_cells):
    """Polylines (UTM) following D8 receivers from every stream head down to a confluence or the edge."""
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    h, w = acc.shape
    stream = acc >= min_cells
    # heads: stream cells with no upstream stream neighbour
    up = np.zeros(acc.shape, int)
    rs, cs = np.nonzero(stream)
    for r, c in zip(rs, cs):
        k = best[r, c]
        if k >= 0:
            rr, cc = r + nb[k][0], c + nb[k][1]
            if 0 <= rr < h and 0 <= cc < w and stream[rr, cc]:
                up[rr, cc] += 1
    visited = np.zeros(acc.shape, bool)
    lines = []
    for r, c in zip(rs, cs):
        if up[r, c] != 0:
            continue
        pts = []
        while True:
            x, y = transform * (c + 0.5, r + 0.5)
            pts.append((x, y, float(acc[r, c])))
            if visited[r, c]:
                break
            visited[r, c] = True
            k = best[r, c]
            if k < 0:
                break
            rr, cc = r + nb[k][0], c + nb[k][1]
            if not (0 <= rr < h and 0 <= cc < w) or not stream[rr, cc]:
                break
            r, c = rr, cc
        if len(pts) >= 2:
            lines.append(pts)
    return lines


# ---------------------------------------------------------------- builders

def build(spec, chm_factor, streams_lines=None):
    g = grid(spec)
    s = spec['spacing_m']
    pad = 600 if s >= 10 else 200
    bb = grid_bounds_lonlat(g, pad_m=pad)
    out = OUT / ('terrain/massif' if spec['id'] == 'massif' else f"zones/{spec['id']}")
    out.mkdir(parents=True, exist_ok=True)
    log(f"[{spec['id']}] grid {g['shape']} @ {s} m, extent {g['extent_m']:.0f} m")

    dem, dem_t, dem_crs = read_window(DEM_URL, bb, f"dem_{spec['id']}")
    dsm = warp_to(dem.astype(np.float32), dem_t, dem_crs, g, Resampling.cubic)
    wc, wc_t, wc_crs = read_window(WC_URL, bb, f"wc_{spec['id']}")
    lc = warp_to(wc, wc_t, wc_crs, g, Resampling.nearest, dtype=np.uint8)
    chm_src, chm_t, chm_crs = read_chm(bb, f"chm_{spec['id']}_f{chm_factor}", factor=chm_factor)
    chm = warp_to(chm_src, chm_t, chm_crs, g, Resampling.bilinear)
    chm = np.clip(chm, 0, 80)
    log(f"[{spec['id']}] sources warped: dsm {dsm.min():.0f}–{dsm.max():.0f} m, chm max {chm.max():.0f} m, mean {chm.mean():.1f} m")

    # Ground ≈ DSM − canopy height averaged over the DSM's ~30 m footprint (crown detail must not dent the ground).
    k = max(1, int(round(30 / s)))
    chm_30 = ndimage.uniform_filter(chm, size=k) if k > 1 else chm
    ground = dsm - chm_30
    ground = ndimage.gaussian_filter(ground, sigma=max(1.0, 15 / s))
    ground = np.minimum(ground, dsm)  # never above the surface

    lo = float(min(ground.min(), dsm.min())) - 1
    hi = float(max(ground.max(), dsm.max())) + 1
    save_u16(out / 'heightmap_ground.png', ground, lo, hi)
    save_u16(out / 'heightmap_dsm.png', dsm, lo, hi)
    save_u8(out / 'canopy_height_m.png', chm)
    save_u8(out / 'landcover_worldcover.png', lc)

    # Weight masks (0–255) for landscape layers / PCG.
    soft = max(1.0, 10 / s)
    forest = smoothstep(3, 12, ndimage.gaussian_filter(chm, soft * 0.5))
    grass = ((lc == 30) | (lc == 20) | (lc == 40)).astype(np.float32) * (1 - smoothstep(3, 8, chm))
    grass = ndimage.gaussian_filter(grass, soft)
    sl = slope_deg(ground, s)
    rock = smoothstep(32, 42, sl) * (1 - forest * 0.6)
    elev = ground
    band_low = 1 - smoothstep(950, 1050, elev)
    band_mont = smoothstep(950, 1050, elev) * (1 - smoothstep(1350, 1450, elev))
    band_summit = smoothstep(1350, 1450, elev)
    for name, arr in [('mask_forest', forest), ('mask_grass', grass), ('mask_rock', rock),
                      ('mask_band_lowland_lt1000m', band_low), ('mask_band_montane_1000-1400m', band_mont),
                      ('mask_band_summit_gt1400m', band_summit)]:
        save_u8(out / f'{name}.png', arr * 255)

    stream_mask = None
    if streams_lines is not None:
        img = Image.new('L', (g['shape'][1], g['shape'][0]), 0)
        dr = ImageDraw.Draw(img)
        inv = ~g['transform']
        for line in streams_lines:
            # width grows with catchment (cells of 30 m → km²), 2–8 m
            pts = [inv * (x, y) for x, y, _ in line]
            catch_km2 = line[-1][2] * 900 / 1e6
            width_m = 2 + min(6, catch_km2 * 1.5)
            dr.line(pts, fill=255, width=max(1, int(round(width_m / s))), joint='curve')
        stream_mask = ndimage.gaussian_filter(np.asarray(img, np.float32), max(0.8, 2 / s))
        save_u8(out / 'mask_stream.png', stream_mask)

    meta = {
        'id': spec['id'], 'name_fr': spec.get('name_fr'), 'name_en': spec.get('name_en'), 'why': spec.get('why'),
        'center_lonlat': [spec['lon'], spec['lat']], 'crs': UTM,
        'center_utm_m': [round(g['cx'], 2), round(g['cy'], 2)], 'spacing_m': s, 'size_px': spec['size_px'],
        'extent_m': g['extent_m'],
        'corners_lonlat': {k2: [round(v, 6) for v in from_utm.transform(*xy)] for k2, xy in {
            'nw': (g['cx'] - g['extent_m'] / 2, g['cy'] + g['extent_m'] / 2),
            'ne': (g['cx'] + g['extent_m'] / 2, g['cy'] + g['extent_m'] / 2),
            'sw': (g['cx'] - g['extent_m'] / 2, g['cy'] - g['extent_m'] / 2),
            'se': (g['cx'] + g['extent_m'] / 2, g['cy'] - g['extent_m'] / 2)}.items()},
        'affine_utm_pixel_is_area': list(g['transform'])[:6],
        'unreal_import': unreal_import(g, lo, hi),
        'stats': {
            'dsm_m': [round(float(dsm.min()), 1), round(float(dsm.max()), 1)],
            'ground_m': [round(float(ground.min()), 1), round(float(ground.max()), 1)],
            'canopy_height_m': {'mean': round(float(chm.mean()), 1), 'p95': round(float(np.percentile(chm, 95)), 1),
                                'max': round(float(chm.max()), 1)},
            'cover_pct': {str(c): round(float((lc == c).mean()) * 100, 1) for c in np.unique(lc)},
            'forest_weight_mean': round(float(forest.mean()), 3),
            'steep_gt38deg_pct': round(float((sl > 38).mean()) * 100, 2),
        },
        'files': sorted(p.name for p in out.glob('*.png')),
    }
    (out / 'meta.json').write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    preview(out / 'preview.jpg', ground, chm, lc, stream_mask, s)
    log(f"[{spec['id']}] written to {out.relative_to(ROOT)}")
    return g, ground


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['massif', 'zones'])
    ap.add_argument('--zones', default='')
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    streams_path = OUT / 'terrain/massif/streams.geojson'

    if args.only in (None, 'massif'):
        # Massif: canopy aggregated ×13 (≈15.5 m) – the full-res tiles are 65 536² stripped COGs.
        g, ground = build(MASSIF, chm_factor=13)
        # Streams from the ground model resampled to 30 m (≈1 M cells).
        z30 = ground[::2, ::2]
        acc, best = flow_accumulation(z30)
        t30 = g['transform'] * rasterio.Affine.scale(2)
        min_cells = int(0.25e6 / 900)  # ≥ 0.25 km² catchment
        lines = trace_streams(acc, best, t30, min_cells)
        feats = []
        for ln in lines:
            coords = [list(map(lambda v: round(v, 6), from_utm.transform(x, y))) for x, y, _ in ln]
            feats.append({'type': 'Feature', 'properties': {'catchment_km2': round(ln[-1][2] * 900 / 1e6, 3)},
                          'geometry': {'type': 'LineString', 'coordinates': coords}})
        streams_path.write_text(json.dumps({
            'type': 'FeatureCollection',
            'note': 'Derived from the Copernicus GLO-30 ground model (DSM − canopy height) by D8 flow accumulation, '
                    'catchment ≥ 0.25 km². APPROXIMATE – not surveyed rivers.',
            'features': feats}))
        log(f'[massif] {len(feats)} stream segments → {streams_path.relative_to(ROOT)}')
        # Massif stream mask
        img = Image.new('L', (g['shape'][1], g['shape'][0]), 0)
        dr = ImageDraw.Draw(img)
        inv = ~g['transform']
        for ln in lines:
            dr.line([inv * (x, y) for x, y, _ in ln], fill=255, width=1)
        save_u8(OUT / 'terrain/massif/mask_stream.png', np.asarray(img))

    if args.only in (None, 'zones'):
        lines = None
        if streams_path.exists():
            d = json.loads(streams_path.read_text())
            lines = [[(*to_utm.transform(lon, lat), f['properties']['catchment_km2'] * 1e6 / 900)
                      for lon, lat in f['geometry']['coordinates']] for f in d['features']]
        wanted = set(filter(None, args.zones.split(',')))
        for z in ZONES:
            if wanted and z['id'] not in wanted:
                continue
            build(z, chm_factor=1, streams_lines=lines)

    (OUT / 'zones.json').write_text(json.dumps({'zones': ZONES, 'massif': MASSIF, 'crs': UTM}, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
