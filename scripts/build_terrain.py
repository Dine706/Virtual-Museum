#!/usr/bin/env python3
"""Build every terrain asset from the Copernicus GLO-30 DEM.
  python3 scripts/build_terrain.py            (pip install rasterio numpy pillow matplotlib shapely pyproj)
Outputs in public/data/:
  heightmap_16bit.png      1008x1008 16-bit grey, h = 300 + v/65535*1500  (metres, Copernicus DSM = includes canopy)
  heightmap_512_16bit.png  same, 504x504 (mobile / low LOD)
  terrarium_504.png        504x504 RGB Terrarium (mobile)
  terrarium.png            1008x1008 RGB Terrarium encoding  h = R*256 + G + B/256 - 32768 (MapLibre / Cesium / three terrain loaders)
  terrain_lod0.glb         257x257 grid mesh in local metres (LOD0, desktop)   terrain_lod1.glb 129x129 (mobile)
  terrain_meta.json        bbox, pixel size, projection, decode formulas, min/max
  hillshade.png            greyscale hillshade (also usable as a texture/ao map)
  preview.png              colour-relief + hillshade + reserve boundary + hotspots (quick look)
  hotspots.geojson         generated from public/data/content.json with sampled DEM elevation
Local metres: x = (lon-lon0)*111320*cos(lat0)  east+ ; z = -(lat-lat0)*110574  (north = -z, three.js convention) ; y = elevation (m).
"""
import json, os, struct, sys, urllib.request
import numpy as np, rasterio
from rasterio.windows import from_bounds
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data"); PUB = os.path.join(ROOT, "public", "data"); os.makedirs(DATA, exist_ok=True); os.makedirs(PUB, exist_ok=True)
W, S, E, N = -8.56, 7.48, -8.28, 7.76
ZMIN, ZMAX = 300.0, 1800.0
TILE = "Copernicus_DSM_COG_10_N07_00_W009_00_DEM"
URL = f"https://copernicus-dem-30m.s3.amazonaws.com/{TILE}/{TILE}.tif"
RAW = os.path.join(DATA, "raw_Copernicus_N07_W009.tif")
if not os.path.exists(RAW):
    print("downloading", URL); urllib.request.urlretrieve(URL, RAW)
with rasterio.open(RAW) as ds:
    win = from_bounds(W, S, E, N, ds.transform).round_offsets().round_lengths()
    dem = ds.read(1, window=win).astype("float64"); tr = ds.window_transform(win)
H, Wd = dem.shape
print("DEM window", dem.shape, "min/max", dem.min(), dem.max())
lon0, lat0 = (W + E) / 2, (S + N) / 2
mx, mz = 111320 * np.cos(np.radians(lat0)), 110574.0
px_m = abs(tr.a) * mx; py_m = abs(tr.e) * mz       # metres per pixel
# --- rasters
v16 = np.clip((dem - ZMIN) / (ZMAX - ZMIN), 0, 1) * 65535
Image.fromarray(v16.round().astype("uint16")).save(os.path.join(PUB, "heightmap_16bit.png"), optimize=True)
half = Image.fromarray(v16.round().astype("uint16")).resize((Wd // 2, H // 2), Image.BILINEAR)
half.save(os.path.join(PUB, "heightmap_512_16bit.png"), optimize=True)
t = dem + 32768.0; R = np.floor(t / 256); G = np.floor(t - R * 256); B = np.floor((t - np.floor(t)) * 256)
Image.fromarray(np.dstack([R, G, B]).astype("uint8")).save(os.path.join(PUB, "terrarium.png"), optimize=True)
Image.fromarray(np.dstack([R, G, B]).astype("uint8")).resize((Wd // 2, H // 2), Image.BILINEAR).save(os.path.join(PUB, "terrarium_504.png"), optimize=True)  # mobile
# --- hillshade
def hillshade(z, az=315, alt=40, exag=1.5):
    gy, gx = np.gradient(z * exag, py_m, px_m)
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)   # y grows south in image space
    azr, altr = np.radians(360 - az + 90), np.radians(alt)
    hs = np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - aspect)
    return np.clip(hs, 0, 1)
hs = hillshade(dem); Image.fromarray((hs * 255).astype("uint8")).save(os.path.join(PUB, "hillshade.png"), optimize=True)
# --- GLB mesh
def to_xz(lon, lat): return (lon - lon0) * mx, -(lat - lat0) * mz
def glb(n, path):
    # sample DEM on an n x n grid covering the window (pixel centres at edges)
    ys = np.linspace(0, H - 1, n); xs = np.linspace(0, Wd - 1, n)
    from numpy import floor
    y0 = np.clip(floor(ys).astype(int), 0, H - 2); x0 = np.clip(floor(xs).astype(int), 0, Wd - 2)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    z = (dem[y0][:, x0] * (1 - fy) * (1 - fx) + dem[y0 + 1][:, x0] * fy * (1 - fx) + dem[y0][:, x0 + 1] * (1 - fy) * fx + dem[y0 + 1][:, x0 + 1] * fy * fx)
    lon = W + (E - W) * np.linspace(0, 1, n); lat = N - (N - S) * np.linspace(0, 1, n)
    X = (lon - lon0) * mx; Zc = -(lat - lat0) * mz
    XX, ZZ = np.meshgrid(X, Zc)
    pos = np.dstack([XX, z, ZZ]).reshape(-1, 3).astype("float32")
    gz, gx = np.gradient(z, np.diff(Zc).mean(), np.diff(X).mean())
    nrm = np.dstack([-gx, np.ones_like(z), -gz]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    nrm = nrm.reshape(-1, 3).astype("float32")
    u, v = np.meshgrid(np.linspace(0, 1, n), np.linspace(0, 1, n)); uv = np.dstack([u, v]).reshape(-1, 2).astype("float32")
    idx = np.arange(n * n).reshape(n, n); a = idx[:-1, :-1].ravel(); b = idx[:-1, 1:].ravel(); c = idx[1:, :-1].ravel(); d = idx[1:, 1:].ravel()
    ind = np.stack([a, c, b, b, c, d], 1).astype("uint32").ravel()   # CCW seen from +Y
    chunks = [pos.tobytes(), nrm.tobytes(), uv.tobytes(), ind.tobytes()]
    offs = np.cumsum([0] + [len(c) for c in chunks]); blob = b"".join(chunks)
    js = {"asset": {"version": "2.0", "generator": "nimba-demo-kit build_terrain.py"}, "scene": 0, "scenes": [{"nodes": [0]}],
          "nodes": [{"mesh": 0, "name": "NimbaTerrain"}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "mode": 4}]}],
          "buffers": [{"byteLength": len(blob)}],
          "bufferViews": [{"buffer": 0, "byteOffset": int(offs[i]), "byteLength": len(chunks[i]), "target": 34962 if i < 3 else 34963} for i in range(4)],
          "accessors": [{"bufferView": 0, "componentType": 5126, "count": n * n, "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                        {"bufferView": 1, "componentType": 5126, "count": n * n, "type": "VEC3"},
                        {"bufferView": 2, "componentType": 5126, "count": n * n, "type": "VEC2"},
                        {"bufferView": 3, "componentType": 5125, "count": len(ind), "type": "SCALAR"}]}
    jb = json.dumps(js, separators=(",", ":")).encode(); jb += b" " * (-len(jb) % 4); blob += b"\0" * (-len(blob) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb); f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    print(path, os.path.getsize(path) // 1024, "KB", n, "x", n)
glb(257, os.path.join(PUB, "terrain_lod0.glb")); glb(129, os.path.join(PUB, "terrain_lod1.glb"))
meta = {"source": "Copernicus GLO-30 DSM (ESA, 2019 release), tile N07 W009, AWS open data", "bbox_wgs84": {"west": W, "south": S, "east": E, "north": N},
        "size_px": [Wd, H], "pixel_size_deg": [abs(tr.a), abs(tr.e)], "pixel_size_m": [round(px_m, 2), round(py_m, 2)], "extent_m": [round(Wd * px_m), round(H * py_m)],
        "elevation_min_m": float(dem.min()), "elevation_max_m": float(dem.max()),
        "heightmap_16bit_decode": f"h_m = {ZMIN} + value/65535*{ZMAX-ZMIN}", "terrarium_decode": "h_m = R*256 + G + B/256 - 32768",
        "local_projection": {"lon0": lon0, "lat0": lat0, "x_m_per_deg_lon": mx, "z_m_per_deg_lat": mz, "formula": "x=(lon-lon0)*x_m_per_deg_lon; z=-(lat-lat0)*z_m_per_deg_lat; y=elevation"},
        "caveat": "DSM: includes canopy, so forest tops read 10-30 m higher than the ground; summit value differs from the surveyed 1,752 m."}
json.dump(meta, open(os.path.join(PUB, "terrain_meta.json"), "w"), indent=1)
def sample(lon, lat):
    c = (lon - tr.c) / tr.a - 0.5; r = (lat - tr.f) / tr.e - 0.5
    if not (0 <= c < Wd - 1 and 0 <= r < H - 1): return None
    r0, c0 = int(r), int(c); fr, fc = r - r0, c - c0
    return float(dem[r0, c0] * (1 - fr) * (1 - fc) + dem[r0 + 1, c0] * fr * (1 - fc) + dem[r0, c0 + 1] * (1 - fr) * fc + dem[r0 + 1, c0 + 1] * fr * fc)
# --- hotspots + preview
spots = []
cj = os.path.join(PUB, "content.json")
if os.path.exists(cj):
    for h in json.load(open(cj))["hotspots"]:
        z = sample(h["lon"], h["lat"]); h["dem_m"] = None if z is None else round(z, 1)
        x, zz = to_xz(h["lon"], h["lat"]); h["local_xz_m"] = [round(x, 1), round(zz, 1)]
        spots.append(h)
    json.dump({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [h["lon"], h["lat"], h.get("dem_m")]},
        "properties": {k: h[k] for k in ("id", "category", "title_fr", "title_en", "elevation_m", "dem_m", "coord_confidence", "local_xz_m")}} for h in spots]},
        open(os.path.join(PUB, "hotspots.geojson"), "w"), ensure_ascii=False)
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, LightSource
cm = LinearSegmentedColormap.from_list("nimba", ["#1F3D2B", "#3C6B3A", "#7A8F3E", "#C3B25E", "#D9CBA3", "#F2EEE3"], N=256)
fig, ax = plt.subplots(figsize=(10, 10), dpi=100); ext = [W, E, S, N]
rgb = LightSource(315, 40).shade(dem, cmap=cm, vmin=350, vmax=1750, blend_mode="overlay", vert_exag=2, dx=px_m, dy=py_m)
ax.imshow(rgb, extent=ext, origin="upper", interpolation="bilinear")
bj = os.path.join(PUB, "reserve_boundary.geojson")
if os.path.exists(bj):
    for f in json.load(open(bj))["features"]:
        g = f["geometry"]; polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for p in polys:
            for ring in p: xs, ys = zip(*[c[:2] for c in ring]); ax.plot(xs, ys, color="#FFD54A", lw=1.6)
bd = os.path.join(PUB, "borders_clipped.geojson")
if os.path.exists(bd):
    from shapely.geometry import shape
    for f in json.load(open(bd))["features"]:
        g = shape(f["geometry"]); gs = getattr(g, "geoms", [g])
        for part in gs:
            if part.geom_type == "LineString": x, y = part.xy; ax.plot(x, y, color="white", lw=0.8, ls="--", alpha=.8)
cols = {"peak": "#E4572E", "habitat": "#2E9E5B", "species": "#8E44AD", "culture": "#F2A900", "conservation": "#1F77B4", "water": "#17BECF"}
for h in spots: ax.scatter(h["lon"], h["lat"], s=42, c=cols.get(h["category"], "k"), edgecolor="white", lw=1, zorder=5)
for h in spots: ax.annotate(h["id"], (h["lon"], h["lat"]), fontsize=6, color="white", xytext=(3, 3), textcoords="offset points", zorder=6)
ax.set_title("Monts Nimba - Copernicus GLO-30 relief, WDPA boundary (yellow), borders (dashed), hotspots", fontsize=9)
ax.set_xlabel("lon"); ax.set_ylabel("lat"); fig.tight_layout(); fig.savefig(os.path.join(PUB, "preview.png")); plt.close(fig)
print("done; spots:", len(spots))
