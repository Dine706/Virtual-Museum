"""Test area for the Unreal world: a 300 m square of the summit zone, dressed with the Blender asset kit.

Reads the 1 m world-pack layers of zone z1 (worldpack/zones/z1-summit), cuts a 300 m patch where the montane
grassland meets the forest edge (≈ 1,400 m), places the kit assets from the real masks (forest weight, canopy
height, grass, steep ground) and writes everything Unreal needs to rebuild the same scene:

    worldpack/testarea/terrain.glb           ground mesh (2 m grid, baked colour map)
    worldpack/testarea/placements.bin/.json  one transform per plant / rock (float32 x, y, z, yaw, scale)
    worldpack/testarea/testarea.json         georeferencing, viewpoints, light
    docs/screens/kit/testarea_*.jpg          Cycles review stills of the same scene

    python scripts/blender/nimba_kit.py --no-render      # the kit must exist first
    python scripts/blender/nimba_test_area.py [--no-render] [--samples 64] [--blend out.blend]

Coordinates: x east, y north, z up, metres, origin at the patch centre, z = altitude − base_alt_m.
"""
import argparse
import json
import math
import pathlib
import sys

import bpy
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import nimba_render as nr  # noqa: E402  (grid_mesh, points_object, instancer, sky_and_sun, haze_volume)

ZONE = ROOT / "worldpack" / "zones" / "z1-summit"
MASSIF = ROOT / "worldpack" / "terrain" / "massif"
KIT = ROOT / "worldpack" / "kit"
OUT = ROOT / "worldpack" / "testarea"
SHOTS = ROOT / "docs" / "screens" / "kit"
TEX = ROOT / "public" / "walk" / "tex"

ROW, COL, HALF = 720, 1816, 150  # patch centre in the zone raster (1 m pixels) and half-size
Image.MAX_IMAGE_PIXELS = None


def log(*a):
    print("[area]", *a, flush=True)


def load(folder, name):
    return np.asarray(Image.open(folder / f"{name}.png")).astype(np.float32)


def heights(folder, name="heightmap_ground"):
    meta = json.loads((folder / "meta.json").read_text())
    lo, hi = meta["unreal_import"]["height_range_m"]
    return lo + load(folder, name) / 65535.0 * (hi - lo), meta


class Patch:
    def __init__(self):
        h, self.meta = heights(ZONE)
        r0, c0 = ROW - HALF, COL - HALF
        s = np.s_[r0:r0 + 2 * HALF + 1, c0:c0 + 2 * HALF + 1]
        self.h = h[s]
        self.base = float(math.floor(self.h.min()))
        self.forest = load(ZONE, "mask_forest")[s] / 255
        self.grass = load(ZONE, "mask_grass")[s] / 255
        self.rock = load(ZONE, "mask_rock")[s] / 255
        self.canopy = load(ZONE, "canopy_height_m")[s]
        ax, _, x0, _, ay, y0 = self.meta["affine_utm_pixel_is_area"]
        self.utm = (x0 + (COL + 0.5) * ax, y0 + (ROW + 0.5) * ay)

    def s(self, a, x, y, order=1):
        """Sample a patch layer at local metres (x east, y north)."""
        yy, xx = np.asarray(y, float), np.asarray(x, float)
        r = map_coordinates(a, [HALF - np.atleast_1d(yy), np.atleast_1d(xx) + HALF], order=order, mode="nearest")
        return r if xx.ndim else r[0]

    def z(self, x, y):
        return self.s(self.h, x, y) - self.base


# ---------------------------------------------------------------- ground

def tile(role, px, n):
    t = np.asarray(Image.open(TEX / f"{role}_diff.webp").convert("RGB").resize((px, px), Image.LANCZOS), np.float32) / 255
    reps = math.ceil(n / px)
    return np.tile(t, (reps, reps, 1))[:n, :n]


def bake_albedo(P, n=4096):
    """Colour map of the patch: the app's scanned ground layers blended by the real masks."""
    def up(a):
        return np.asarray(Image.fromarray(a.astype(np.float32), mode="F").resize((n, n), Image.BICUBIC))
    rng = np.random.default_rng(5)
    nz = up(gaussian_filter(rng.random((301, 301)), 3) * 6 - 2.5)  # soft noise to break the mask edges
    forest = np.clip(up(gaussian_filter(P.forest, 2)) + 0.25 * nz - 0.1, 0, 1)[..., None]
    rock = np.clip(up(gaussian_filter(P.rock, 1.5)) * 1.3 + 0.3 * nz - 0.35, 0, 1)[..., None]
    wear = np.clip(0.5 + nz, 0, 1)[..., None]
    turf = tile("turf", 96, n) * 0.6 + tile("highgrass", 128, n) * 0.4
    turf = turf * (0.8 + 0.3 * wear) * np.array([0.62, 0.74, 0.5])
    col = turf * (1 - forest) + tile("litter", 80, n) * 0.8 * forest
    col = col * (1 - rock) + tile("rock", 160, n) * np.array([0.62, 0.56, 0.52]) * rock
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(OUT / "terrain_albedo.jpg", quality=86)


def build_ground(P, step=2):
    g = np.arange(-HALF, HALF + 1, step, dtype=float)
    X, Y = np.meshgrid(g, g)
    ob = nr.grid_mesh("terrain", X, Y, P.z(X, Y))
    me = ob.data
    uv = me.uv_layers.new(name="UVMap")
    li = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", li)
    U = np.stack([(X.ravel() + HALF) / (2 * HALF), (Y.ravel() + HALF) / (2 * HALF)], -1)
    uv.data.foreach_set("uv", U[li].astype(np.float32).ravel())
    m = bpy.data.materials.new("terrain")
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    t = N.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(OUT / "terrain_albedo.jpg"))
    b = N["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.95
    L.new(t.outputs["Color"], b.inputs["Base Color"])
    me.materials.append(m)
    return ob


def bump_for_render(m):
    """Cycles only (after export): fine bump so the bare ground is not flat between the plants."""
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 8
    tc = N.new("ShaderNodeTexCoord")
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    bp = N.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.6
    bp.inputs["Distance"].default_value = 0.08
    L.new(nz.outputs["Fac"], bp.inputs["Height"])
    L.new(bp.outputs["Normal"], N["Principled BSDF"].inputs["Normal"])


def translucent(m, b):
    """Cycles only: thin leaves pass light, so the canopy glows from below instead of going black."""
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    if b.inputs["Base Color"].is_linked:
        nt.links.new(b.inputs["Base Color"].links[0].from_socket, tr.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.45
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def backdrop(P):
    """Render-only surroundings: the 2 km zone (8 m grid) and the whole massif (60 m), canopy as relief."""
    def col_of(forest, grass, rock):
        c = (np.array([0.012, 0.030, 0.010])[None, None] * forest[..., None]
             + np.array([0.045, 0.060, 0.018])[None, None] * (1 - forest[..., None]))
        k = np.clip(rock * (1 - forest) * 0.8, 0, 1)[..., None]
        return c * (1 - k) + np.array([0.075, 0.068, 0.060])[None, None] * k

    def layer(folder, step, name, box, drop):
        h, meta = heights(folder, "heightmap_dsm")
        ax, _, x0, _, ay, y0 = meta["affine_utm_pixel_is_area"]
        s = np.s_[::step, ::step]
        rows, cols = np.mgrid[0:h.shape[0]:step, 0:h.shape[1]:step]
        X = x0 + (cols + 0.5) * ax - P.utm[0]
        Y = y0 + (rows + 0.5) * ay - P.utm[1]
        Z = h[s] - P.base - drop
        inside = (X > box[0]) & (X < box[1]) & (Y > box[2]) & (Y < box[3])
        Z = np.where(inside, Z - 400, Z)
        C = col_of(load(folder, "mask_forest")[s] / 255, load(folder, "mask_grass")[s] / 255, load(folder, "mask_rock")[s] / 255)
        ob = nr.grid_mesh(name, X[::-1], Y[::-1], Z[::-1], {"col": C[::-1]})  # rows south → north: normals up
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = "col"
        nt.links.new(a.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
        nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        ob.data.materials.append(m)
        return ob
    q = HALF - 4
    layer(ZONE, 8, "backdrop_zone", (-q, q, -q, q), 1.5)
    layer(MASSIF, 4, "backdrop_massif", (-COL + 80, 2016 - COL - 80, -(2016 - ROW) + 80, ROW - 80), 12)


# ---------------------------------------------------------------- placement

def jitter_grid(rng, cell, margin=4):
    g = np.arange(-HALF + margin, HALF - margin, cell)
    X, Y = np.meshgrid(g, g)
    return (X + rng.random(X.shape) * cell).ravel(), (Y + rng.random(Y.shape) * cell).ravel()


def place(P, kit):
    rng = np.random.default_rng(42)
    hgt = {a["id"]: a["height_m"] for a in kit["assets"]}
    out = {}

    def put(aid, x, y, scale, sink=0.0):
        n = len(x)
        z = P.z(x, y) - sink * scale
        rec = np.stack([x, y, z, rng.uniform(0, 2 * math.pi, n), scale], -1).astype(np.float32)
        out[aid] = np.concatenate([out[aid], rec]) if aid in out else rec

    fsoft = gaussian_filter(P.forest, 10)
    # trees: one candidate per 4.5 m cell, kept where the canopy model has trees; height = measured canopy height
    x, y = jitter_grid(rng, 4.5)
    ch, fo = P.s(P.canopy, x, y), P.s(P.forest, x, y)
    keep = (ch > 4) & (rng.random(len(x)) < fo * 0.9)
    tall = keep & (ch >= 14)
    tall = keep & (ch >= 10)
    low = keep & ~tall
    put("parinari_tree", x[tall], y[tall], np.clip(ch[tall] / hgt["parinari_tree"] * rng.uniform(0.9, 1.15, tall.sum()), 0.4, 1.5), 0.3)
    put("montane_tree", x[low], y[low], np.clip(ch[low] / hgt["montane_tree"] * rng.uniform(0.9, 1.15, low.sum()), 0.6, 1.5), 0.2)
    x, y = jitter_grid(rng, 9)
    k = (P.s(P.forest, x, y) > 0.6) & (rng.random(len(x)) < 0.3)
    put("tree_fern", x[k], y[k], rng.uniform(0.7, 1.15, k.sum()), 0.1)
    x, y = jitter_grid(rng, 2)
    k = rng.random(len(x)) < P.s(P.forest, x, y) * 0.4
    put("ground_fern", x[k], y[k], rng.uniform(0.8, 1.6, k.sum()))
    x, y = jitter_grid(rng, 20)
    k = (P.s(P.forest, x, y) > 0.6) & (rng.random(len(x)) < 0.35)
    put("fallen_log", x[k], y[k], rng.uniform(0.7, 1.2, k.sum()))
    # Protea-type shrubs: the belt where grassland meets the forest
    x, y = jitter_grid(rng, 5)
    fs = P.s(fsoft, x, y)
    k = (P.s(P.grass, x, y) > 0.4) & (fs > 0.12) & (fs < 0.6) & (rng.random(len(x)) < 0.6)
    put("protea_shrub", x[k], y[k], rng.uniform(0.7, 1.3, k.sum()), 0.05)
    # rock on the steep ground
    for aid, cell, p, smin, smax in (("rock_outcrop", 18, 0.8, 0.7, 1.6), ("rock_boulder_a", 9, 0.45, 0.6, 1.8),
                                    ("rock_boulder_b", 11, 0.45, 0.6, 1.6), ("rock_scree", 4, 0.45, 0.8, 1.6)):
        x, y = jitter_grid(rng, cell)
        k = rng.random(len(x)) < P.s(P.rock, x, y) * p * (0.4 + 0.6 * (1 - P.s(P.forest, x, y)))
        put(aid, x[k], y[k], rng.uniform(smin, smax, k.sum()), 0.12)
    # grass tussocks: the sward itself
    x, y = jitter_grid(rng, 0.48, margin=1)
    k = rng.random(len(x)) < P.s(P.grass, x, y) * (1 - 0.5 * P.s(P.rock, x, y)) * (1 - P.s(P.forest, x, y)) ** 0.5
    b = rng.random(len(x)) < 0.35
    put("grass_tussock_a", x[k & ~b], y[k & ~b], rng.uniform(0.8, 1.5, (k & ~b).sum()))
    put("grass_tussock_b", x[k & b], y[k & b], rng.uniform(0.9, 1.6, (k & b).sum()))
    return out


def viewpoints(P, pl):
    """Three review cameras chosen from the data (not by eye)."""
    g = np.arange(-HALF + 30, HALF - 30, 3.0)
    X, Y = np.meshgrid(g, g)
    hs = gaussian_filter(P.h, 3)
    gy, gx = np.gradient(hs)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    sl = P.s(slope, X, Y)
    fs = P.s(gaussian_filter(P.forest, 12), X, Y)
    gr = P.s(gaussian_filter(P.grass, 6), X, Y)
    # 1: standing in open grass, forest edge 20–40 m away
    sc = gr - np.abs(fs - 0.1) * 3 - sl / 60
    i = np.unravel_index(sc.argmax(), sc.shape)
    x1, y1 = float(X[i]), float(Y[i])
    fx, fy = np.gradient(gaussian_filter(P.forest, 15))[::-1]
    dx, dy = float(P.s(fx, x1, y1)), -float(P.s(fy, x1, y1))  # towards more forest (rows run south)
    yaw1 = math.atan2(-dx, dy)
    # 2: inside the forest edge, looking back out to the grass
    from scipy.spatial import cKDTree
    big = np.concatenate([pl[k][:, :2] for k in pl if not k.startswith(("grass", "ground_fern", "rock_scree"))])
    clear = cKDTree(big).query(np.stack([X.ravel(), Y.ravel()], -1))[0].reshape(X.shape)
    sc = fs * (P.s(P.canopy, X, Y) > 8) - np.abs(fs - 0.6) - sl / 60 - 5 * (clear < 3.0) - 5 * (cKDTree(pl["montane_tree"][:, :2]).query(np.stack([X.ravel(), Y.ravel()], -1))[0].reshape(X.shape) < 9.0)
    i = np.unravel_index(sc.argmax(), sc.shape)
    x2, y2 = float(X[i]), float(Y[i])
    dx, dy = -float(P.s(fx, x2, y2)), float(P.s(fy, x2, y2))
    yaw2 = math.atan2(-dx, dy)
    # 3: from the downhill side, 130 m above the centre, looking back up at the whole patch
    gyy, gxx = np.gradient(gaussian_filter(P.h, 40))
    down = -np.array([gxx.mean(), -gyy.mean()])
    down = down / (np.linalg.norm(down) + 1e-9)
    ox, oy = float(down[0] * 300), float(down[1] * 300)
    oe = float(P.z(0, 0)) + 130
    return [
        dict(id="grassland", x=x1, y=y1, eye=1.65, yaw=yaw1, pitch=-0.03, fov=68),
        dict(id="forest_edge", x=x2, y=y2, eye=1.65, yaw=yaw2, pitch=0.05, fov=72, ev=2.2),
        dict(id="overview", x=ox, y=oy, eye=oe, yaw=math.atan2(ox, -oy), pitch=-math.atan2(130, 300), fov=58),
    ]


# ---------------------------------------------------------------- main

def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--res", type=int, default=1600)
    ap.add_argument("--only", nargs="*", help="viewpoint ids to render")
    ap.add_argument("--blend")
    ap.add_argument("--no-haze", action="store_true")
    ap.add_argument("--debug", action="store_true", help="no backdrop / haze, plus a top view")
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    P = Patch()
    kit = json.loads((KIT / "kit.json").read_text())
    log(f"patch centre UTM 29N {P.utm[0]:.1f}, {P.utm[1]:.1f}; ground {P.h.min():.0f}–{P.h.max():.0f} m; base {P.base:.0f} m")

    bake_albedo(P)
    ground = build_ground(P)
    for o in sc.objects:
        o.select_set(o is ground)
    bpy.context.view_layer.objects.active = ground
    bpy.ops.export_scene.gltf(filepath=str(OUT / "terrain.glb"), use_selection=True, export_format="GLB", export_yup=True,
                              export_image_format="JPEG", export_jpeg_quality=88)

    pl = place(P, kit)
    index, off, blob = [], 0, []
    for aid, rec in pl.items():
        index.append({"asset": aid, "count": int(len(rec)), "offset_floats": off})
        off += rec.size
        blob.append(rec.ravel())
        log(f"{aid}: {len(rec)}")
    np.concatenate(blob).astype("<f4").tofile(OUT / "placements.bin")
    views = viewpoints(P, pl)
    for v in views:
        v["z"] = v["eye"] if v["id"] == "overview" else float(P.z(v["x"], v["y"])) + v["eye"]
    from pyproj import Transformer
    lon, lat = Transformer.from_crs(32629, 4326, always_xy=True).transform(*P.utm)
    corners = [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF), (0, 0), (-70, 40), (55, -85), (110, 95)]
    light = dict(az=125, el=42, haze=1.0)  # mid-morning
    (OUT / "testarea.json").write_text(json.dumps({
        "id": "testarea-z1-edge", "name_fr": "Zone test – lisière prairie d'altitude / forêt (zone sommet)",
        "name_en": "Test area – montane grassland / forest edge (summit zone)",
        "centre_lonlat": [round(lon, 6), round(lat, 6)], "centre_utm29n_m": [round(v, 2) for v in P.utm],
        "size_m": 2 * HALF, "base_alt_m": P.base, "ground_alt_m": [round(float(P.h.min()), 1), round(float(P.h.max()), 1)],
        "axes": "x east, y north, z up, metres; origin at the patch centre; z = altitude - base_alt_m",
        "record": "placements.bin: little-endian float32, 5 per instance: x, y, z, yaw (radians, counter-clockwise from +x seen from above), uniform scale",
        "terrain": {"file": "terrain.glb", "grid_m": 2, "albedo": "terrain_albedo.jpg"},
        "check_points": [{"x": x, "y": y, "z": round(float(P.z(x, y)), 2)} for x, y in corners],
        "sun": {"azimuth_deg_from_north_clockwise": light["az"], "elevation_deg": light["el"]},
        "viewpoints": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in vp.items()} for vp in views],
        "placements": index,
        "sources": "Relief: Copernicus DEM GLO-30 minus Meta/WRI canopy height, upsampled to 1 m (shape real, detail not). "
                   "Where trees/grass/rock are: Meta/WRI canopy height, ESA WorldCover, slope. Plants: draft kit models.",
    }, indent=1, ensure_ascii=False) + "\n")
    log("wrote", OUT)
    if a.no_render and not a.blend:
        return

    # ---- the same scene, lit and rendered for review
    bump_for_render(ground.data.materials[0])
    if not a.debug:
        backdrop(P)
    before = set(bpy.data.objects)
    src = {}
    for aid in pl:
        bpy.ops.import_scene.gltf(filepath=str(KIT / f"{aid}.glb"))
        ob = [o for o in bpy.data.objects if o not in before and o.type == "MESH"][0]
        before = set(bpy.data.objects)
        ob.location = (0, 0, -5000)
        ob.hide_render = True
        src[aid] = ob
        for m in ob.data.materials:  # thin leaves: let light through
            if "leaf" in m.name or "tussock" in m.name or "bract" in m.name:
                b = m.node_tree.nodes.get("Principled BSDF")
                if b:  # matte leaves: no sky-coloured sheen on every blade
                    b.inputs["Specular IOR Level"].default_value = 0.15
                    b.inputs["Sheen Weight"].default_value = 0.0
                    b.inputs["Roughness"].default_value = 0.8
                    translucent(m, b)
    for aid, rec in pl.items():
        rot = np.zeros((len(rec), 3), np.float32)
        rot[:, 2] = rec[:, 3]
        pts = nr.points_object(f"pts_{aid}", rec[:, :3], rot, np.repeat(rec[:, 4:5], 3, 1))
        nr.instancer(pts, src[aid])
    nr.sky_and_sun(light)
    if not a.debug and not a.no_haze:
        nr.haze_volume(0, 0, light["haze"], -P.base)
    else:
        views.append(dict(id="top", x=0.0, y=0.0, z=560.0, yaw=0.0, pitch=-math.pi / 2, fov=32))
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.cycles.volume_bounces = 1
    sc.render.resolution_x, sc.render.resolution_y = a.res, a.res * 9 // 16
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.2
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(pathlib.Path(a.blend).resolve()))
    if a.no_render:
        return
    SHOTS.mkdir(parents=True, exist_ok=True)
    for v in views:
        if a.only and v["id"] not in a.only:
            continue
        for o in [o for o in sc.objects if o.type == "CAMERA"]:
            bpy.data.objects.remove(o)
        nr.camera(v["x"], v["y"], v["z"], v["yaw"], False, fov=v["fov"], pitch=v["pitch"])
        sc.view_settings.exposure = 0.2 + v.get("ev", 0.0)  # the forest interior is exposed for the shade
        png = SHOTS / f"testarea_{v['id']}.png"
        sc.render.filepath = str(png)
        bpy.ops.render.render(write_still=True)
        Image.open(png).convert("RGB").save(png.with_suffix(".jpg"), quality=88)
        png.unlink()
        log("rendered", v["id"])


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
