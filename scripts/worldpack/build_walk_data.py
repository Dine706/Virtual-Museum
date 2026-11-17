#!/usr/bin/env python3
"""Walk-mode data for the web app (public/walk/) + the regrowth mask for the world pack.

Reads the world pack built by build_terrain_forest.py / build_species.py (no network):

  public/walk/tiles/<i>_<j>_h.png   ground height + stream weight, app frame, 15 m, 3 km tiles
  public/walk/tiles/<i>_<j>_a.png   canopy height (m), WorldCover class, rock weight
  public/walk/crowns_<zone>.bin     individual tree crowns detected in the 1 m canopy model (hero zones)
  public/walk/streams.json          DEM-derived stream lines (approximate), app frame
  public/walk/species.json          species shown / named in walk mode, with sources
  public/walk/index.json            grid, encodings and zone list

App frame (CLAUDE.md §5): x = (lon − lon0)·110336.97, z = −(lat − lat0)·110574, metres, lon0 −8.42, lat0 7.62.
Height encoding: v = round((h − 300)·40) → R = v >> 8, G = v & 255 (2.5 cm steps).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
WP = ROOT / 'worldpack'
OUT = ROOT / 'public' / 'walk'
LON0, LAT0 = -8.42, 7.62
KX, KZ = 110336.9679982832, 110574.0
STEP = 15.0            # metres per tile pixel
TILE = 200             # pixels per tile (3 km); files hold TILE + 1 px (shared edge)
HALF = 15000.0         # tiles cover x, z ∈ [−15 km, +15 km]
NT = int(2 * HALF / STEP / TILE)  # 10 × 10 tiles
H0, HS = 300.0, 40.0

to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32629', always_xy=True)
to_ll = Transformer.from_crs('EPSG:32629', 'EPSG:4326', always_xy=True)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def load_folder(folder: Path):
    meta = json.loads((folder / 'meta.json').read_text())
    lo, hi = meta['unreal_import']['height_range_m']
    u16 = lambda n: np.asarray(Image.open(folder / n)).astype(np.float64) / 65535 * (hi - lo) + lo  # noqa: E731
    u8 = lambda n: np.asarray(Image.open(folder / n)).astype(np.float64)  # noqa: E731
    return meta, {
        'ground': u16('heightmap_ground.png'), 'canopy': u8('canopy_height_m.png'),
        'class': u8('landcover_worldcover.png'), 'stream': u8('mask_stream.png'), 'rock': u8('mask_rock.png'),
        'forest': u8('mask_forest.png'),
    }


# ---------------------------------------------------------------- regrowth mask (world pack)

def regrowth_masks():
    """Land the 10 m map calls tree/shrub but the 1 m canopy model puts under ~3–6 m:
    young regrowth, fallow and farm bush. Neither forest nor grass before; now its own layer."""
    folders = [WP / 'terrain' / 'massif'] + sorted((WP / 'zones').iterdir())
    for f in folders:
        if not (f / 'meta.json').exists():
            continue
        meta, d = load_folder(f)
        woody = np.isin(d['class'], (10, 20)).astype(np.float64)
        regrowth = woody * (1 - d['forest'] / 255) * (1 - smoothstep(6, 10, d['canopy']))
        Image.fromarray(np.round(regrowth * 255).astype(np.uint8)).save(f / 'mask_regrowth.png', optimize=True)
        if 'mask_regrowth.png' not in meta['files']:
            meta['files'] = sorted(meta['files'] + ['mask_regrowth.png'])
            (f / 'meta.json').write_text(json.dumps(meta, indent=1))
        print(f'  {f.relative_to(ROOT)}: regrowth mean {regrowth.mean():.2f}')


# ---------------------------------------------------------------- tiles in the app frame

def utm_pixel(meta, x, z):
    lon = LON0 + x / KX
    lat = LAT0 - z / KZ
    e, n = to_utm.transform(lon, lat)
    a = meta['affine_utm_pixel_is_area']
    col = (e - a[2]) / a[0] - 0.5
    row = (n - a[5]) / a[4] - 0.5
    return row, col


def tiles():
    meta, d = load_folder(WP / 'terrain' / 'massif')
    (OUT / 'tiles').mkdir(parents=True, exist_ok=True)
    for j in range(NT):
        for i in range(NT):
            xs = -HALF + i * TILE * STEP + np.arange(TILE + 1) * STEP
            zs = -HALF + j * TILE * STEP + np.arange(TILE + 1) * STEP
            X, Z = np.meshgrid(xs, zs)
            row, col = utm_pixel(meta, X.ravel(), Z.ravel())
            coords = np.vstack([row, col])
            s = lambda k, o: ndimage.map_coordinates(d[k], coords, order=o, mode='nearest').reshape(X.shape)  # noqa: E731
            h = s('ground', 3)
            v = np.clip(np.round((h - H0) * HS), 0, 65535).astype(np.uint16)
            himg = np.dstack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.clip(s('stream', 1), 0, 255).astype(np.uint8)])
            aimg = np.dstack([np.clip(np.round(s('canopy', 1)), 0, 255), s('class', 0), np.clip(s('rock', 1), 0, 255)]).astype(np.uint8)
            Image.fromarray(himg, 'RGB').save(OUT / 'tiles' / f'{i}_{j}_h.png', optimize=True)
            Image.fromarray(aimg, 'RGB').save(OUT / 'tiles' / f'{i}_{j}_a.png', optimize=True)
    total = sum(p.stat().st_size for p in (OUT / 'tiles').iterdir())
    print(f'  tiles: {NT}×{NT}, {total / 1e6:.1f} MB')


# ---------------------------------------------------------------- tree crowns from the 1 m canopy model

def crowns(zone: Path):
    meta, d = load_folder(zone)
    chm = ndimage.gaussian_filter(d['canopy'], 0.7)
    # Local maxima. The canopy model is smooth (crown-scale features), so these are the dominant crowns;
    # walk mode fills the canopy and understorey between them from the local canopy height.
    peaks = (chm == ndimage.maximum_filter(chm, size=3)) & (chm >= 4)
    r, c = np.nonzero(peaks)
    h = chm[r, c]
    order = np.argsort(-h)
    r, c, h = r[order], c[order], h[order]
    # Greedy suppression on a grid: keep a peak if no taller kept peak is within its minimum spacing.
    taken = np.zeros_like(chm, dtype=bool)
    keep = []
    for k in range(len(h)):
        rad = int(max(2, min(6, 0.12 * h[k])))
        r0, r1, c0, c1 = max(0, r[k] - rad), r[k] + rad + 1, max(0, c[k] - rad), c[k] + rad + 1
        if taken[r0:r1, c0:c1].any():
            continue
        taken[r[k], c[k]] = True
        keep.append(k)
    r, c, h = r[keep], c[keep], d['canopy'][r[keep], c[keep]]
    h = np.maximum(h, chm[r, c])
    # Crown radius: allometry (crown diameter ≈ 0.3–0.4 × height in tropical forest), capped by neighbours.
    a = meta['affine_utm_pixel_is_area']
    e = a[2] + (c + 0.5) * a[0]
    n = a[5] + (r + 0.5) * a[4]
    pts = np.c_[e, n]
    from scipy.spatial import cKDTree
    dist, _ = cKDTree(pts).query(pts, k=2)
    radius = np.minimum(1.0 + 0.16 * h, np.maximum(1.2, dist[:, 1] * 0.75))
    lon, lat = to_ll.transform(e, n)
    x = (lon - LON0) * KX
    z = -(lat - LAT0) * KZ
    cx, cz = float(np.round(x.mean())), float(np.round(z.mean()))
    rec = np.zeros(len(h), dtype=[('x', '<i2'), ('z', '<i2'), ('h', 'u1'), ('r', 'u1')])
    rec['x'] = np.round((x - cx) * 10)
    rec['z'] = np.round((z - cz) * 10)
    rec['h'] = np.clip(np.round(h * 4), 0, 255)
    rec['r'] = np.clip(np.round(radius * 10), 0, 255)
    name = zone.name.split('-', 1)[1] if '-' in zone.name else zone.name
    (OUT / f'crowns_{zone.name}.bin').write_bytes(rec.tobytes())
    print(f'  {zone.name}: {len(h)} crowns, height p50 {np.median(h):.0f} m, max {h.max():.0f} m')
    return {'id': zone.name, 'name': name, 'cx': cx, 'cz': cz, 'half': 1008, 'count': int(len(h)),
            'file': f'crowns_{zone.name}.bin'}


# ---------------------------------------------------------------- streams

def streams():
    g = json.loads((WP / 'terrain' / 'massif' / 'streams.geojson').read_text())
    lines = []
    for f in g['features']:
        co = np.array(f['geometry']['coordinates'])
        x = (co[:, 0] - LON0) * KX
        z = -(co[:, 1] - LAT0) * KZ
        lines.append({'a': round(f['properties'].get('catchment_km2', 0), 2),
                      'p': np.round(np.c_[x, z]).astype(int).ravel().tolist()})
    (OUT / 'streams.json').write_text(json.dumps(lines, separators=(',', ':')))
    print(f'  streams: {len(lines)} lines')


# ---------------------------------------------------------------- species shown in walk mode

# Taxa that walk mode draws or names, each tied to a visual. All are recorded by GBIF in the window.
WALK_TAXA = {
    'tree_fern': ['Alsophila camerooniana', 'Alsophila manniana', 'Alsophila dregei'],
    'protea': ['Protea madiensis', 'Protea angolensis'],
    'parinari': ['Parinari excelsa'],
    'oil_palm': ['Elaeis guineensis'],
    'raphia': ['Raphia hookeri'],
    'hornbill': ['Lophoceros fasciatus', 'Bycanistes fistulator', 'Ceratogymna elata'],
    'turaco': ['Tauraco persa', 'Corythaeola cristata', 'Tauraco macrorhynchus'],
    'sunbird': ['Cinnyris chloropygius', 'Hedydipna collaris', 'Cinnyris cupreus', 'Cyanomitra verticalis'],
    'swallowtail': ['Papilio antimachus', 'Papilio nireus', 'Graphium illyris'],
    'acraea': ['Acraea bonasia', 'Acraea kraka', 'Acraea alciope'],
    'chimpanzee': ['Pan troglodytes'],
}


def species():
    sp = json.loads((WP / 'species' / 'species.json').read_text())['species']
    by = {s['scientific_name']: s for s in sp}
    slim = lambda s: {  # noqa: E731
        'sci': s['scientific_name'], 'fr': s['names']['fr'], 'en': s['names']['en'],
        'family': s['taxonomy']['family'], 'class': s['taxonomy']['class'], 'iucn': s['iucn_category'],
        'records': s['gbif_records_in_window'], 'bands': s['altitude_zones_pct'], 'sensitive': s['sensitive'],
        'gbif': s['sources']['gbif_species'], 'wp_fr': s['sources']['wikipedia_fr'], 'wp_en': s['sources']['wikipedia_en'],
    }
    taxa = {k: [slim(by[n]) for n in names if n in by] for k, names in WALK_TAXA.items()}
    # Per altitude band: the most-recorded plants, birds and butterflies (for "recorded in this band").
    bands = {}
    for band in ('lowland_lt1000m', 'montane_1000-1400m', 'summit_gt1400m'):
        def top(pred, n=12):
            m = [s for s in sp if band in s['altitude_zones_pct'] and pred(s)]
            m.sort(key=lambda s: -s['gbif_records_in_window'] * s['altitude_zones_pct'][band])
            return [slim(s) for s in m[:n]]
        bands[band] = {
            'plants': top(lambda s: s['taxonomy']['kingdom'] == 'Plantae'),
            'birds': top(lambda s: s['taxonomy']['class'] == 'Aves'),
            'butterflies': top(lambda s: s['taxonomy']['order'] == 'Lepidoptera'),
            'counts': {
                'species': sum(1 for s in sp if band in s['altitude_zones_pct']),
                'plants': sum(1 for s in sp if band in s['altitude_zones_pct'] and s['taxonomy']['kingdom'] == 'Plantae'),
                'birds': sum(1 for s in sp if band in s['altitude_zones_pct'] and s['taxonomy']['class'] == 'Aves'),
            },
        }
    out = {'taxa': taxa, 'bands': bands,
           'source': 'GBIF.org occurrence records in the 3D window (aggregated, no coordinates); names from Wikidata.'}
    (OUT / 'species.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'  species.json: {sum(len(v) for v in taxa.values())} taxa')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print('regrowth masks')
    regrowth_masks()
    print('tiles')
    tiles()
    print('crowns')
    zones = json.loads((WP / 'zones.json').read_text())['zones']
    zinfo = []
    for z in zones:
        info = crowns(WP / 'zones' / z['id'])
        info.update({'name_fr': z['name_fr'], 'name_en': z['name_en']})
        zinfo.append(info)
    print('streams')
    streams()
    print('species')
    species()
    index = {'frame': {'lon0': LON0, 'lat0': LAT0, 'kx': KX, 'kz': KZ}, 'step': STEP, 'tile': TILE, 'tiles': NT,
             'origin': -HALF, 'height': {'h0': H0, 'scale': HS}, 'zones': zinfo,
             'crown_encoding': 'int16 x, int16 z (dm from zone centre), uint8 height (0.25 m), uint8 radius (0.1 m)'}
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
