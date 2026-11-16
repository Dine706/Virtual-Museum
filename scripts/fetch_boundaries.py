#!/usr/bin/env python3
"""Fetch protected-area polygons + national borders and write simplified GeoJSON for the demo.
 - WDPA (UNEP-WCMC / IUCN, protectedplanet.net) via the public ArcGIS FeatureServer.
   LICENCE: WDPA terms are NON-COMMERCIAL and forbid redistributing the raw data. We only ship a simplified
   derivative for a non-commercial demo. For a commercial/public product, digitise the boundary from the
   UNESCO nomination map or ask the authorities (OGPR Guinea / OIPR Cote d'Ivoire) for the official shapefile.
 - geoBoundaries gbOpen ADM0 (GIN: CC BY-SA 2.0 ; LBR: CC BY 3.0 IGO ; CIV: public domain) for country outlines.
Usage: python3 scripts/fetch_boundaries.py   (needs shapely, requests or urllib)"""
import json, os, urllib.request, urllib.parse
from shapely.geometry import shape, mapping, box
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data"); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "nimba-demo-kit/1.0"}
BBOX = box(-8.56, 7.48, -8.28, 7.76)
def get(url): return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120))

WDPA = "https://services5.arcgis.com/Mj0hjvkNtV7NRhA7/arcgis/rest/services/WDPA_v0/FeatureServer/1/query"
def wdpa(site_id):
    q = urllib.parse.urlencode({"where": f"site_id={site_id}", "outFields": "*", "f": "geojson", "outSR": "4326"})
    return get(WDPA + "?" + q)
parts = []
for sid, iso, label in [(29067, "GIN", "Guinea part (Reserve naturelle integrale des Monts Nimba)"), (1295, "CIV", "Cote d'Ivoire part (Reserve integrale du Mont Nimba)")]:
    f = wdpa(sid)["features"][0]; g = shape(f["geometry"]).simplify(0.0003, preserve_topology=True)  # ~30 m
    p = f["properties"]
    parts.append({"type": "Feature", "geometry": mapping(g), "properties": {
        "id": f"wdpa-{sid}", "iso3": iso, "label": label, "wdpa_id": sid, "iucn_cat": p.get("iucn_cat"),
        "reported_area_km2": p.get("rep_area"), "gis_area_km2": p.get("gis_area"), "status_year": p.get("status_yr"),
        "source": "UNEP-WCMC & IUCN (WDPA), simplified ~30 m", "licence": "WDPA non-commercial; see docs/DATA_LICENCES.md"}})
json.dump({"type": "FeatureCollection", "features": parts}, open(os.path.join(OUT, "reserve_boundary.geojson"), "w"))

GB = {"GIN": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/GIN/ADM0/geoBoundaries-GIN-ADM0_simplified.geojson",
      "LBR": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/LBR/ADM0/geoBoundaries-LBR-ADM0_simplified.geojson",
      "CIV": "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/CIV/ADM0/geoBoundaries-CIV-ADM0_simplified.geojson"}
feats = []
for iso, url in GB.items():
    g = shape(get(url)["features"][0]["geometry"]).buffer(0)
    clipped = g.boundary.intersection(BBOX)          # outline only, clipped to the demo window
    feats.append({"type": "Feature", "geometry": mapping(clipped), "properties": {"iso3": iso, "kind": "country-outline", "source": "geoBoundaries gbOpen ADM0", "note": "approximate; outlines from different countries do not match exactly"}})
json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(OUT, "borders_clipped.geojson"), "w"))
print("wrote reserve_boundary.geojson, borders_clipped.geojson")
