#!/usr/bin/env python3
"""Export the OSM 'Mine de Nimba' polygon (way 307934062, ODbL) as public/data/mining_enclave_osm.geojson.
Volunteer-mapped, NOT an official boundary: always label it 'approximate'."""
import json, os, urllib.request
from shapely.geometry import shape, mapping
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
u = "https://nominatim.openstreetmap.org/lookup?osm_ids=W307934062&format=json&polygon_geojson=1&extratags=1"
m = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "nimba-demo-kit/1.0"}), timeout=60))[0]
g = shape(m["geojson"]).simplify(0.0001)
fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": mapping(g), "properties": {"id": "mining-enclave-osm", "name": m["display_name"], "osm": "way/307934062", "approx_area_ha": 269, "note": "Volunteer-mapped OSM polygon (ODbL), not official", "source": "OpenStreetMap contributors, ODbL"}}]}
json.dump(fc, open(os.path.join(ROOT, "public", "data", "mining_enclave_osm.geojson"), "w"))
