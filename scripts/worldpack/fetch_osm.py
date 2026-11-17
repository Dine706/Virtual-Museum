#!/usr/bin/env python3
"""Real buildings, roads/paths, land use and place names from OpenStreetMap for the 3D window.

OSM data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
Fetched with the OSM API (map call) in 0.035° tiles, cached in .worldpack-cache/osm/.
Output: public/walk/osm.json in the app frame (x east, z south, metres):
  buildings: [{x, z, w, d, a, kind, levels}]  – oriented footprint rectangles (centre, width, depth, angle)
  roads:     [{k, p:[x,z,...]}]               – highway class + polyline
  areas:     [{k, p:[...]}]                   – landuse / natural polygons (farmland, residential, quarry, ...)
  places:    [{name, kind, x, z}]
Usage: .venv/bin/python scripts/worldpack/fetch_osm.py
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.worldpack-cache' / 'osm'
OUT = ROOT / 'public' / 'walk' / 'osm.json'
BBOX = (-8.56, 7.48, -8.28, 7.76)
STEP = 0.035
LON0, LAT0, KX, KZ = -8.42, 7.62, 110336.9679982832, 110574.0
S = requests.Session()
S.headers['User-Agent'] = 'nimba-walk/0.1 (educational prototype; contact via repository)'


def xz(lon, lat):
    return round((lon - LON0) * KX, 1), round(-(lat - LAT0) * KZ, 1)


def tile(w, s, e, n):
    p = CACHE / f'{w:.3f}_{s:.3f}.json'
    if p.exists():
        return json.loads(p.read_text())
    for attempt in range(5):
        try:
            r = S.get('https://api.openstreetmap.org/api/0.6/map.json', params={'bbox': f'{w},{s},{e},{n}'}, timeout=120)
            if r.status_code == 200:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(r.text)
                time.sleep(1.0)
                return r.json()
            print('  status', r.status_code, r.text[:120])
        except Exception as ex:  # noqa: BLE001
            print('  retry', ex)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'tile {w},{s} failed')


def min_rect(pts):
    """Oriented bounding rectangle of a small polygon (rotating calipers over hull edges)."""
    best = None
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        a = math.atan2(z2 - z1, x2 - x1)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + z * s for x, z in pts]
        vs = [-x * s + z * c for x, z in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if w * d <= 0:
            continue
        if best is None or w * d < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (w * d, cu * c - cv * s, cu * s + cv * c, w, d, a)
    return best


def main():
    nodes, ways, place_nodes = {}, {}, {}
    w0, s0, e0, n0 = BBOX
    lons = [w0 + i * STEP for i in range(int(round((e0 - w0) / STEP)) + 1)]
    lats = [s0 + i * STEP for i in range(int(round((n0 - s0) / STEP)) + 1)]
    total = (len(lons) - 1) * (len(lats) - 1)
    k = 0
    for i in range(len(lons) - 1):
        for j in range(len(lats) - 1):
            k += 1
            d = tile(round(lons[i], 3), round(lats[j], 3), round(lons[i + 1], 3), round(lats[j + 1], 3))
            for el in d['elements']:
                if el['type'] == 'node':
                    nodes[el['id']] = (el['lon'], el['lat'])
                    if 'place' in el.get('tags', {}) and 'name' in el['tags']:
                        place_nodes[el['id']] = el
                elif el['type'] == 'way':
                    ways[el['id']] = el
            if k % 8 == 0:
                print(f'  tiles {k}/{total}: {len(ways)} ways')
    buildings, roads, areas = [], [], []
    for wy in ways.values():
        t = wy.get('tags', {})
        pts = [nodes[n] for n in wy.get('nodes', []) if n in nodes]
        if len(pts) < 2:
            continue
        p = [xz(lon, lat) for lon, lat in pts]
        if 'building' in t and len(p) >= 4:
            ring = p[:-1] if p[0] == p[-1] else p
            r = min_rect(ring)
            if not r:
                continue
            _, cx, cz, w, dd, a = r
            if w * dd > 4000:  # skip huge mapping errors / industrial halls far from villages
                continue
            buildings.append({'x': round(cx, 1), 'z': round(cz, 1), 'w': round(w, 1), 'd': round(dd, 1), 'a': round(a, 3),
                              'kind': t.get('building', 'yes'), 'levels': t.get('building:levels'),
                              'roof': t.get('roof:material') or t.get('roof:shape')})
        elif 'highway' in t:
            roads.append({'k': t['highway'], 's': t.get('surface'), 'p': [c for xy in p for c in xy]})
        elif 'landuse' in t or t.get('natural') in ('water', 'bare_rock', 'scrub', 'wood', 'grassland', 'wetland'):
            areas.append({'k': t.get('landuse') or t.get('natural'), 'p': [c for xy in p for c in xy]})
    places = []
    for el in place_nodes.values():
        x, z = xz(el['lon'], el['lat'])
        places.append({'name': el['tags']['name'], 'kind': el['tags']['place'], 'x': x, 'z': z})
    # Split into the walk-mode 3 km tile grid (same as the terrain tiles) so a place loads only what is near it.
    TILE, HALF = 3000.0, 15000.0
    tiles = {}
    def put(key, kind, item):
        tiles.setdefault(key, {'buildings': [], 'roads': [], 'areas': []})[kind].append(item)
    def keys_for(xs, zs):
        i0, i1 = int((min(xs) + HALF) // TILE), int((max(xs) + HALF) // TILE)
        j0, j1 = int((min(zs) + HALF) // TILE), int((max(zs) + HALF) // TILE)
        return [f'{i}_{j}' for i in range(max(0, i0), min(9, i1) + 1) for j in range(max(0, j0), min(9, j1) + 1)]
    for b in buildings:
        for k in keys_for([b['x']], [b['z']]):
            put(k, 'buildings', b)
    for kind, lst in (('roads', roads), ('areas', areas)):
        for it in lst:
            for k in keys_for(it['p'][0::2], it['p'][1::2]):
                put(k, kind, it)
    tdir = OUT.parent / 'osm'
    tdir.mkdir(parents=True, exist_ok=True)
    for old in tdir.glob('*.json'):
        old.unlink()
    for k, v in tiles.items():
        (tdir / f'{k}.json').write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':')))
    (tdir / 'places.json').write_text(json.dumps({'license': 'OpenStreetMap contributors, ODbL 1.0', 'places': places,
                                                   'tiles': sorted(tiles)}, ensure_ascii=False, separators=(',', ':')))
    if OUT.exists():
        OUT.unlink()
    size = sum(f.stat().st_size for f in tdir.glob('*.json'))
    print(f'{len(buildings)} buildings, {len(roads)} roads/paths, {len(areas)} areas, {len(places)} places → '
          f'{len(tiles)} tiles in {tdir.relative_to(ROOT)} ({size / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()
