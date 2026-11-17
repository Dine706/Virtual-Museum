#!/usr/bin/env python3
"""Stage 1 – species & facts database for the Nimba world (worldpack/species/).

Sources (public APIs, no account):
  * GBIF occurrence API  – every georeferenced record in the 3D window (taxonomy, IUCN category, year, dataset)
  * Wikidata SPARQL      – French / English names and Wikipedia articles, matched by GBIF taxon ID (P846)
  * iNaturalist API      – research-grade observations in the window: photo candidates with licence + attribution

Rules built in (CLAUDE.md §10):
  * NO coordinates are written to the output. Records are aggregated to counts, years and altitude zones
    (sampled from the Copernicus DEM at each record), so nothing can be used to locate a species.
  * Species that are threatened (IUCN CR / EN / VU) or named as sensitive in content.json are flagged
    `sensitive: true` – the 3D world must place them only in generalised zones.
  * Every species keeps its sources (GBIF species page, contributing datasets, Wikidata item).

Usage:  .venv/bin/python scripts/worldpack/build_species.py
Raw API responses are cached in .worldpack-cache/species/.
"""
from __future__ import annotations

import collections
import csv
import json
import time
import urllib.parse
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'worldpack' / 'species'
CACHE = ROOT / '.worldpack-cache' / 'species'
BBOX = {'west': -8.56, 'south': 7.48, 'east': -8.28, 'north': 7.76}
UA = {'User-Agent': 'nimba-worldpack/0.1 (unofficial research prototype; data aggregation for a museum demo)'}
S = requests.Session()
S.headers.update(UA)

# Content.json hotspots that describe deliberately generalised species (never precise locations).
SENSITIVE_NAMES = {'Nimbaphrynoides occidentalis', 'Micropotamogale lamottei', 'Hipposideros lamottei'}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def get_json(url, params=None, cache_name=None, tries=6, method='GET', data=None):
    if cache_name:
        p = CACHE / f'{cache_name}.json'
        if p.exists():
            return json.loads(p.read_text())
    delay = 2
    for i in range(tries):
        try:
            r = S.request(method, url, params=params, data=data, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f'HTTP {r.status_code}')
            r.raise_for_status()
            j = r.json()
            if cache_name:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(j))
            return j
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            log(f'  retry {i + 1} after {e}')
            time.sleep(delay)
            delay *= 2


# ---------------------------------------------------------------- elevation sampling (no coordinates kept)

class DEM:
    def __init__(self):
        im = np.asarray(Image.open(ROOT / 'public/data/terrarium.png').convert('RGB')).astype(np.float64)
        self.h = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
        self.n = self.h.shape[0]

    def at(self, lon, lat):
        c = int((lon - BBOX['west']) / (BBOX['east'] - BBOX['west']) * self.n)
        r = int((BBOX['north'] - lat) / (BBOX['north'] - BBOX['south']) * self.n)
        if 0 <= r < self.n and 0 <= c < self.n:
            return float(self.h[r, c])
        return None


def band(elev):
    if elev is None:
        return None
    if elev < 1000:
        return 'lowland_lt1000m'
    if elev < 1400:
        return 'montane_1000-1400m'
    return 'summit_gt1400m'


# ---------------------------------------------------------------- GBIF

def gbif_records():
    base = 'https://api.gbif.org/v1/occurrence/search'
    q = {'decimalLatitude': f"{BBOX['south']},{BBOX['north']}", 'decimalLongitude': f"{BBOX['west']},{BBOX['east']}",
         'hasCoordinate': 'true', 'hasGeospatialIssue': 'false', 'limit': 300}
    first = get_json(base, {**q, 'limit': 0}, cache_name='gbif_count')
    total = first['count']
    log(f'GBIF: {total} records in the window')
    off = 0
    while off < min(total, 100000):
        page = get_json(base, {**q, 'offset': off}, cache_name=f'gbif_{off:06d}')
        for r in page['results']:
            yield r
        off += 300
        if page.get('endOfRecords'):
            break
        if off % 6000 == 0:
            log(f'  GBIF {off}/{total}')


# ---------------------------------------------------------------- Wikidata

def wikidata_by_gbif(keys):
    out = {}
    keys = [str(k) for k in keys]
    for i in range(0, len(keys), 250):
        batch = keys[i:i + 250]
        values = ' '.join(f'"{k}"' for k in batch)
        query = f"""SELECT ?gbif ?item ?fr ?en ?frwiki ?enwiki WHERE {{
  VALUES ?gbif {{ {values} }}
  ?item wdt:P846 ?gbif .
  OPTIONAL {{ ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }}
  OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?frwiki schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> }}
  OPTIONAL {{ ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}}"""
        # Common names (P1843) separately: labels of taxa are often the scientific name.
        query_cn = f"""SELECT ?gbif ?cn WHERE {{
  VALUES ?gbif {{ {values} }}
  ?item wdt:P846 ?gbif ; wdt:P1843 ?cn .
  FILTER(LANG(?cn) IN ("fr", "en"))
}}"""
        j = get_json('https://query.wikidata.org/sparql', {'query': query, 'format': 'json'}, cache_name=f'wd_{i:05d}')
        cn = get_json('https://query.wikidata.org/sparql', {'query': query_cn, 'format': 'json'}, cache_name=f'wdcn_{i:05d}')
        for b in j['results']['bindings']:
            g = b['gbif']['value']
            d = out.setdefault(g, {'qid': b['item']['value'].rsplit('/', 1)[-1], 'common': {'fr': set(), 'en': set()}})
            for lang in ('fr', 'en'):
                if lang in b:
                    d.setdefault(f'label_{lang}', b[lang]['value'])
                if f'{lang}wiki' in b:
                    d[f'wikipedia_{lang}'] = b[f'{lang}wiki']['value']
        for b in cn['results']['bindings']:
            g = b['gbif']['value']
            if g in out:
                out[g]['common'][b['cn']['xml:lang']].add(b['cn']['value'])
        log(f'  Wikidata {min(i + 250, len(keys))}/{len(keys)}')
        time.sleep(1.0)
    return out


# ---------------------------------------------------------------- iNaturalist

def inat_photos():
    base = 'https://api.inaturalist.org/v1/observations'
    params = {'swlat': BBOX['south'], 'swlng': BBOX['west'], 'nelat': BBOX['north'], 'nelng': BBOX['east'],
              'quality_grade': 'research', 'photos': 'true', 'per_page': 200, 'order_by': 'id', 'order': 'asc'}
    by_name = collections.defaultdict(list)
    page = 1
    while True:
        j = get_json(base, {**params, 'page': page}, cache_name=f'inat_{page:03d}')
        res = j.get('results', [])
        for o in res:
            taxon = o.get('taxon') or {}
            name = taxon.get('name')
            for ph in (o.get('photos') or [])[:2]:
                lic = ph.get('license_code')
                if not lic:  # all rights reserved – not usable
                    continue
                by_name[name].append({
                    'url': (ph.get('url') or '').replace('square', 'medium'),
                    'license': lic.upper(),
                    'attribution': ph.get('attribution'),
                    'observation': f"https://www.inaturalist.org/observations/{o['id']}",
                })
        if len(res) < 200 or page * 200 >= 10000:
            break
        page += 1
        time.sleep(1.0)
    log(f'iNaturalist: photo candidates for {len(by_name)} taxa')
    return by_name


# ---------------------------------------------------------------- main

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dem = DEM()
    species = {}
    datasets = collections.Counter()
    dataset_names = {}
    n_records = 0
    for r in gbif_records():
        n_records += 1
        key = r.get('speciesKey')
        if not key:
            continue  # identified above species level
        s = species.setdefault(key, {
            'gbif_key': key, 'scientific_name': r.get('species'),
            'kingdom': r.get('kingdom'), 'phylum': r.get('phylum'), 'class': r.get('class'), 'order': r.get('order'),
            'family': r.get('family'), 'genus': r.get('genus'),
            'iucn': None, 'records': 0, 'years': [None, None], 'bands': collections.Counter(),
            'basis': collections.Counter(), 'datasets': collections.Counter(), 'licenses': collections.Counter(),
        })
        s['records'] += 1
        if r.get('iucnRedListCategory'):
            s['iucn'] = r['iucnRedListCategory']
        y = r.get('year')
        if y:
            s['years'][0] = y if s['years'][0] is None else min(s['years'][0], y)
            s['years'][1] = y if s['years'][1] is None else max(s['years'][1], y)
        e = dem.at(r['decimalLongitude'], r['decimalLatitude'])
        b = band(e)
        if b:
            s['bands'][b] += 1
        s['basis'][r.get('basisOfRecord', '?')] += 1
        dk = r.get('datasetKey')
        if dk:
            s['datasets'][dk] += 1
            datasets[dk] += 1
            dataset_names.setdefault(dk, r.get('datasetName'))
        if r.get('license'):
            s['licenses'][r['license'].rsplit('/', 2)[-2] if '/' in r['license'] else r['license']] += 1
    log(f'{n_records} records → {len(species)} species')

    wd = wikidata_by_gbif(list(species))
    photos = inat_photos()

    rows = []
    for key, s in sorted(species.items(), key=lambda kv: -kv[1]['records']):
        w = wd.get(str(key), {})
        name = s['scientific_name']
        iucn = s['iucn']
        sensitive = (iucn in {'CR', 'EN', 'VU', 'CRITICALLY_ENDANGERED', 'ENDANGERED', 'VULNERABLE'}) or name in SENSITIVE_NAMES
        common_fr = sorted(w.get('common', {}).get('fr', []))
        common_en = sorted(w.get('common', {}).get('en', []))
        label_fr = w.get('label_fr') if w.get('label_fr') and w.get('label_fr') != name else None
        label_en = w.get('label_en') if w.get('label_en') and w.get('label_en') != name else None
        total_b = sum(s['bands'].values()) or 1
        rows.append({
            'gbif_key': key,
            'scientific_name': name,
            'names': {'fr': label_fr or (common_fr[0] if common_fr else None),
                      'en': label_en or (common_en[0] if common_en else None),
                      'fr_other': common_fr[:5], 'en_other': common_en[:5]},
            'taxonomy': {k: s[k] for k in ('kingdom', 'phylum', 'class', 'order', 'family', 'genus')},
            'iucn_category': iucn,
            'sensitive': sensitive,
            'gbif_records_in_window': s['records'],
            'years_recorded': s['years'],
            'altitude_zones_pct': {k: round(v / total_b * 100) for k, v in s['bands'].most_common()},
            'basis_of_record': dict(s['basis']),
            'record_licences': dict(s['licenses']),
            'photo_candidates': photos.get(name, [])[:4],
            'sources': {
                'gbif_species': f'https://www.gbif.org/species/{key}',
                'gbif_datasets': [f'https://www.gbif.org/dataset/{dk}' for dk, _ in s['datasets'].most_common(5)],
                'wikidata': f"https://www.wikidata.org/wiki/{w['qid']}" if w.get('qid') else None,
                'wikipedia_fr': w.get('wikipedia_fr'), 'wikipedia_en': w.get('wikipedia_en'),
            },
        })

    meta = {
        'generated': time.strftime('%Y-%m-%d'),
        'window_wgs84': BBOX,
        'gbif_records_read': n_records,
        'species': len(rows),
        'note': 'Aggregated from GBIF occurrence records (no coordinates kept). Counts reflect collecting effort, not '
                'abundance. Altitude zones are sampled from the Copernicus DEM at each record and depend on record '
                'precision. Species flagged sensitive must only be shown in generalised zones.',
        'citation': f"GBIF.org ({time.strftime('%d %B %Y')}) Occurrence search, window {BBOX}. For publication, "
                    'replace with a GBIF download DOI (requires a free GBIF account).',
    }
    (OUT / 'species.json').write_text(json.dumps({'meta': meta, 'species': rows}, indent=1, ensure_ascii=False))
    with open(OUT / 'species.csv', 'w', newline='', encoding='utf-8') as f:
        wr = csv.writer(f)
        wr.writerow(['scientific_name', 'name_fr', 'name_en', 'kingdom', 'class', 'order', 'family', 'iucn', 'sensitive',
                     'records', 'first_year', 'last_year', 'lowland_pct', 'montane_pct', 'summit_pct', 'photos', 'gbif'])
        for r in rows:
            z = r['altitude_zones_pct']
            wr.writerow([r['scientific_name'], r['names']['fr'], r['names']['en'], r['taxonomy']['kingdom'],
                         r['taxonomy']['class'], r['taxonomy']['order'], r['taxonomy']['family'], r['iucn_category'],
                         r['sensitive'], r['gbif_records_in_window'], r['years_recorded'][0], r['years_recorded'][1],
                         z.get('lowland_lt1000m', 0), z.get('montane_1000-1400m', 0), z.get('summit_gt1400m', 0),
                         len(r['photo_candidates']), r['sources']['gbif_species']])
    ds = [{'key': k, 'name': dataset_names.get(k), 'records': n, 'url': f'https://www.gbif.org/dataset/{k}'}
          for k, n in datasets.most_common()]
    (OUT / 'gbif_datasets.json').write_text(json.dumps(ds, indent=1, ensure_ascii=False))
    log(f'written {len(rows)} species, {len(ds)} datasets → {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
