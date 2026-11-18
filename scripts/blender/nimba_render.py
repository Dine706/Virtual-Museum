"""Photo-real renders of the Monts Nimba from the app's real data, with Blender / Cycles.

    blender -b --python scripts/blender/nimba_render.py -- --spot summit --pano --res 4096 --samples 256 --gpu
    python  scripts/blender/nimba_render.py --spot summit --res 1024 --samples 16      (with `pip install bpy`)

Scene, all at true scale (Blender X = east, Y = north, Z = up; same local projection as the app):
  * ground: the walk-mode tiles (15 m terrain from the Copernicus DSM minus canopy, canopy height from
    Meta/WRI, ESA WorldCover classes, rock mask) – a fine patch around the camera with micro-relief, and the
    whole 31 km massif behind it with the canopy as relief;
  * surfaces: the app's scanned CC0 ground textures, blended per vertex from land cover, slope and altitude;
  * plants and rocks: CC0 Poly Haven scans (scripts/blender/fetch_assets.py) scattered from the same data.
    They are generic stand-ins, not Nimba species – the renders are illustrations, not photographs;
  * sky: physical sky + sun (time presets as in walk mode), height-dependent haze, optional sea of clouds.
Output: scripts/blender/out/<spot>[_pano].jpg (equirectangular 2:1 with --pano).
"""
import argparse
import math
import pathlib
import sys
import time

import numpy as np
import bpy
import addon_utils

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WALK = ROOT / "public" / "walk"
ASSETS = HERE / "assets"

# Tour stops (src/ui/tour.ts) + a few more. yaw as in walk mode: forward = (-sin yaw, -cos yaw) in (x, z).
SPOTS = {
    "summit": dict(lon=-8.4083, lat=7.6219, yaw=-0.8, time="morning", clouds=True,
                   fr="Au sommet du mont Richard-Molard", en="On top of Mount Richard-Molard"),
    "grassland": dict(lon=-8.3958, lat=7.6397, yaw=0.8, time="morning", clouds=True,
                      fr="Les prairies d'altitude", en="The high-altitude grasslands"),
    "lamco": dict(lon=-8.4995, lat=7.5410, yaw=-2.32, time="noon", clouds=False,
                  fr="Le lac de l'ancienne mine LAMCO", en="The lake of the former LAMCO mine"),
    "forest": dict(lon=-8.4000, lat=7.6700, yaw=0.6, time="morning", clouds=False,
                   fr="Dans la forêt de nuage", en="Inside the cloud forest"),
    "bossou": dict(lon=-8.5055, lat=7.6508, yaw=2.4, time="morning", clouds=False,
                   fr="Bossou, au pied du Nimba", en="Bossou, at the foot of Nimba"),
}
# Sun as in src/walk/env.ts (azimuth from north, clockwise; elevation) and haze strength.
TIMES = {
    "morning": dict(az=102, el=24, haze=1.0),
    "noon": dict(az=150, el=62, haze=0.8),
    "mist": dict(az=120, el=34, haze=2.6),
}


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


# ---------------------------------------------------------------- data

class Terrain:
    """The walk-mode tiles as one mosaic: ground height (m), canopy (m), land-cover class, rock (0..1)."""

    def __init__(self):
        import json
        idx = json.loads((WALK / "index.json").read_text())
        self.frame, self.step, self.origin = idx["frame"], idx["step"], idx["origin"]
        t, n = idx["tile"], idx["tiles"]
        N = n * t + 1
        self.h = np.zeros((N, N), np.float32)
        self.canopy = np.zeros((N, N), np.float32)
        self.cls = np.zeros((N, N), np.uint8)
        self.rock = np.zeros((N, N), np.float32)
        h0, sc = idx["height"]["h0"], idx["height"]["scale"]
        for j in range(n):
            for i in range(n):
                hp = self._pixels(WALK / "tiles" / f"{i}_{j}_h.png")
                ap = self._pixels(WALK / "tiles" / f"{i}_{j}_a.png")
                r0, c0 = j * t, i * t
                hh, ww = hp.shape[:2]
                self.h[r0:r0 + hh, c0:c0 + ww] = (hp[..., 0] * 256 + hp[..., 1]) / sc + h0
                self.canopy[r0:r0 + hh, c0:c0 + ww] = ap[..., 0]
                self.cls[r0:r0 + hh, c0:c0 + ww] = ap[..., 1]
                self.rock[r0:r0 + hh, c0:c0 + ww] = ap[..., 2] / 255.0
        self.N = N
        self.extent = (self.origin, self.origin + (N - 1) * self.step)

    @staticmethod
    def _pixels(path):
        img = bpy.data.images.load(str(path), check_existing=False)
        img.colorspace_settings.name = "Non-Color"
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        # Blender stores rows bottom-up; the app's rows run north (row 0) to south.
        return np.rint(px.reshape(h, w, 4)[::-1] * 255).astype(np.int32)

    def xz(self, lon, lat):
        f = self.frame
        return (lon - f["lon0"]) * f["kx"], -(lat - f["lat0"]) * f["kz"]

    def sample(self, arr, x, z, nearest=False):
        """Bilinear (or nearest) sample of a mosaic array at app coordinates x (east), z (south)."""
        u = np.clip((np.asarray(x) - self.origin) / self.step, 0, self.N - 1.001)
        v = np.clip((np.asarray(z) - self.origin) / self.step, 0, self.N - 1.001)
        if nearest:
            return arr[np.rint(v).astype(int), np.rint(u).astype(int)]
        i, j = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = u - i, v - j
        a = arr if arr.dtype == np.float32 else arr.astype(np.float32)
        return ((a[j, i] * (1 - fu) + a[j, i + 1] * fu) * (1 - fv) + (a[j + 1, i] * (1 - fu) + a[j + 1, i + 1] * fu) * fv)


def value_noise(x, y, scale, seed):
    """Smooth value noise in [-1, 1] at world positions (vectorised; deterministic per seed)."""
    gx, gy = np.asarray(x) / scale, np.asarray(y) / scale
    i, j = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    fx, fy = gx - i, gy - j
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def h(a, b):
        n = (a * 374761393 + b * 668265263 + seed * 2246822519) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 32767.5 - 1.0

    return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy


def detail(x, y, amp=1.0):
    """Micro-relief the 15 m data cannot show (bumps, hummocks, small gullies)."""
    return amp * (0.9 * value_noise(x, y, 23.0, 1) + 0.35 * value_noise(x, y, 7.0, 2) + 0.12 * value_noise(x, y, 2.3, 3))


# ---------------------------------------------------------------- OpenStreetMap areas (as in walk mode)

AREA_KIND = {"water": "water", "quarry": "mine", "brownfield": "mine", "industrial": "mine",
             "farmland": "field", "orchard": "field", "cliff": "rock", "bare_rock": "rock", "scree": "rock",
             "sand": "sand", "wetland": "wetland"}


def osm_areas(T, cx, cz, R):
    """Mapped areas near (cx, cz): list of (kind, name, (n, 2) array of x, z), deduplicated across tiles."""
    import json
    out, seen = [], set()
    t = 3000.0
    i0, i1 = int((cx - R - T.origin) // t), int((cx + R - T.origin) // t)
    j0, j1 = int((cz - R - T.origin) // t), int((cz + R - T.origin) // t)
    for j in range(max(0, j0), min(9, j1) + 1):
        for i in range(max(0, i0), min(9, i1) + 1):
            f = WALK / "osm" / f"{i}_{j}.json"
            if not f.exists():
                continue
            for a in json.loads(f.read_text()).get("areas", []):
                kind = "enclave" if a.get("name") == "Mine de Nimba" else AREA_KIND.get(a["k"])
                key = (a["k"], tuple(a["p"][:6]), len(a["p"]))
                if not kind or key in seen:
                    continue
                seen.add(key)
                P = np.asarray(a["p"], np.float64).reshape(-1, 2)
                if P[:, 0].max() < cx - R or P[:, 0].min() > cx + R or P[:, 1].max() < cz - R or P[:, 1].min() > cz + R:
                    continue
                out.append((kind, a.get("name"), P))
    return out


def inside(P, x, z):
    """Even-odd point-in-polygon for arrays of points x, z (vectorised over the points)."""
    x, z = np.asarray(x), np.asarray(z)
    res = np.zeros(x.shape, bool)
    xs, zs = P[:, 0], P[:, 1]
    xj, zj = np.roll(xs, 1), np.roll(zs, 1)
    for k in range(len(P)):
        a, b, c, d = xs[k], zs[k], xj[k], zj[k]
        if b == d:
            continue
        cross = ((b > z) != (d > z)) & (x < (c - a) * (z - b) / (d - b) + a)
        res ^= cross
    return res


def lake_level(T, P):
    """Water level: lower quartile of the terrain sampled inside the outline (the DEM over water is the
    water surface), less 0.3 m – as in src/walk/water.ts."""
    x0, x1, z0, z1 = P[:, 0].min(), P[:, 0].max(), P[:, 1].min(), P[:, 1].max()
    st = max(4.0, max(x1 - x0, z1 - z0) / 40)
    gx, gz = np.meshgrid(np.arange(x0 + st / 2, x1, st), np.arange(z0 + st / 2, z1, st))
    m = inside(P, gx, gz)
    hs = T.sample(T.h, gx[m], gz[m]) if m.any() else T.sample(T.h, P[:, 0], P[:, 1])
    return float(np.quantile(hs, 0.25 if m.any() else 0.0)) - 0.3


# ---------------------------------------------------------------- mesh helpers

def grid_mesh(name, X, Y, Z, attrs=None):
    """Quad grid mesh from 2-D arrays of vertex positions (rows along Y). attrs: name -> (n, k) float arrays."""
    ny, nx = Z.shape
    me = bpy.data.meshes.new(name)
    me.vertices.add(nx * ny)
    me.vertices.foreach_set("co", np.stack([X, Y, Z], -1).astype(np.float32).ravel())
    jj, ii = np.mgrid[0:ny - 1, 0:nx - 1]
    a = (jj * nx + ii).ravel()
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).astype(np.int32)
    nq = len(quads)
    me.loops.add(nq * 4)
    me.loops.foreach_set("vertex_index", quads.ravel())
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.polygons.foreach_set("loop_total", np.full(nq, 4, np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(nq, bool))
    me.update(calc_edges=True)
    for k, v in (attrs or {}).items():
        v = np.asarray(v, np.float32).reshape(nx * ny, -1)
        if v.shape[1] == 1:
            at = me.attributes.new(k, "FLOAT", "POINT")
            at.data.foreach_set("value", v.ravel())
        else:
            v4 = np.concatenate([v, np.ones((len(v), 4 - v.shape[1]), np.float32)], 1) if v.shape[1] < 4 else v
            at = me.color_attributes.new(k, "FLOAT_COLOR", "POINT")
            at.data.foreach_set("color", v4.ravel())
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def points_object(name, P, rot, scl):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(P))
    me.vertices.foreach_set("co", np.asarray(P, np.float32).ravel())
    for k, v in (("rot", rot), ("scl", scl)):
        at = me.attributes.new(k, "FLOAT_VECTOR", "POINT")
        at.data.foreach_set("vector", np.asarray(v, np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def instancer(points_ob, source_ob):
    """Geometry nodes: one instance of source_ob per point, rotation/scale from the point attributes."""
    g = bpy.data.node_groups.new(f"inst_{source_ob.name}", "GeometryNodeTree")
    g.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    g.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = g.nodes
    gi, go = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    ip = n.new("GeometryNodeInstanceOnPoints")
    oi = n.new("GeometryNodeObjectInfo")
    oi.inputs["Object"].default_value = source_ob
    oi.transform_space = "ORIGINAL"
    rot, scl = n.new("GeometryNodeInputNamedAttribute"), n.new("GeometryNodeInputNamedAttribute")
    for na, nm in ((rot, "rot"), (scl, "scl")):
        na.data_type = "FLOAT_VECTOR"
        na.inputs["Name"].default_value = nm
    L = g.links
    L.new(gi.outputs[0], ip.inputs["Points"])
    L.new(oi.outputs["Geometry"], ip.inputs["Instance"])
    L.new(rot.outputs["Attribute"], ip.inputs["Rotation"])
    L.new(scl.outputs["Attribute"], ip.inputs["Scale"])
    L.new(ip.outputs["Instances"], go.inputs[0])
    mod = points_ob.modifiers.new("instances", "NODES")
    mod.node_group = g


# ---------------------------------------------------------------- assets

def load_asset(aid):
    """Import a Poly Haven glTF, join it into one object at the origin (base at z = 0), hidden from render."""
    path = ASSETS / aid / f"{aid}.gltf"
    if not path.exists():
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    names = [o.name for o in new]
    if not meshes:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for nm in names:  # empties / joined leftovers (joined objects are already gone)
        o = bpy.data.objects.get(nm)
        if o is not None and o != ob:
            bpy.data.objects.remove(o)
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    ob.data.transform(__import__("mathutils").Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
    ob.name = aid
    ob["size"] = [float(v) for v in (hi - lo)]
    for m in ob.data.materials:
        foliage_translucency(m)
    ob.hide_render = True
    ob.hide_viewport = True
    ob.location = (0, 0, -10000)
    return ob


# ---------------------------------------------------------------- materials

def foliage_translucency(m):
    """Leaves and grass blades let light through: backlit by the sun they glow instead of going black.
    Principled (opaque part) + Translucent (same colour, a little darker), cut out by the texture alpha."""
    if not m or not m.node_tree:
        return
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not b or not out or not b.inputs["Base Color"].is_linked:
        return
    # Poly Haven's glTF takes the alpha from the colour JPEG (none): use the separate mask (…_alpha_1k.jpg)
    diff = b.inputs["Base Color"].links[0].from_node
    ipath = pathlib.Path(bpy.path.abspath(diff.image.filepath)) if getattr(diff, "image", None) else None
    apath = ipath.with_name(ipath.name.replace("_diff_", "_alpha_")) if ipath else None
    if not apath or not apath.exists():
        return  # trunks, bark, rocks: opaque
    L = nt.links
    for l in list(b.inputs["Alpha"].links):
        L.remove(l)
    an = tex_node(nt, apath, non_color=True)
    L.new(diff.inputs["Vector"].links[0].from_socket, an.inputs["Vector"]) if diff.inputs["Vector"].is_linked else None
    alpha_src = an.outputs["Color"]
    b.inputs["Alpha"].default_value = 1.0
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    if b.inputs["Base Color"].is_linked:
        hue = nt.nodes.new("ShaderNodeHueSaturation")
        hue.inputs["Saturation"].default_value = 1.15
        hue.inputs["Value"].default_value = 0.8
        L.new(b.inputs["Base Color"].links[0].from_socket, hue.inputs["Color"])
        L.new(hue.outputs["Color"], tr.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.35
    L.new(b.outputs["BSDF"], mix.inputs[1])
    L.new(tr.outputs["BSDF"], mix.inputs[2])
    cut = nt.nodes.new("ShaderNodeMixShader")
    tp = nt.nodes.new("ShaderNodeBsdfTransparent")
    L.new(alpha_src, cut.inputs["Fac"])
    L.new(tp.outputs["BSDF"], cut.inputs[1])
    L.new(mix.outputs["Shader"], cut.inputs[2])
    L.new(cut.outputs["Shader"], out.inputs["Surface"])


def tex_node(nt, path, non_color=False):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        n.image.colorspace_settings.name = "Non-Color"
    n.interpolation = "Cubic"
    return n


def ground_material():
    """Blend of the app's scanned ground layers, weighted per vertex (colour attributes w1, w2)."""
    layers = [("litter", "w1", 0, 2.6), ("laterite", "w1", 1, 3.2), ("turf", "w1", 2, 2.0), ("rock", "w1", 3, 4.5),
              ("moss", "w2", 0, 2.2), ("highgrass", "w2", 1, 2.6), ("mine", "w2", 2, 3.6), ("sand", "w2", 3, 2.8)]
    m = bpy.data.materials.new("ground")
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    tc = N.new("ShaderNodeTexCoord")
    sep, vcol = {}, {}
    for w in ("w1", "w2"):
        ca = N.new("ShaderNodeVertexColor")
        ca.layer_name = w
        s = N.new("ShaderNodeSeparateColor")
        L.new(ca.outputs["Color"], s.inputs["Color"])
        sep[w], vcol[w] = s, ca
    # break the tiling: a second, rotated and larger sample mixed in by noise
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.09
    col_acc = nor_acc = w_acc = None

    def add(a, b, op="ADD"):
        v = N.new("ShaderNodeVectorMath")
        v.operation = op
        L.new(a, v.inputs[0])
        L.new(b, v.inputs[1])
        return v.outputs[0]

    for name, w, ch, scale in layers:
        mp = N.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
        L.new(tc.outputs["Object"], mp.inputs["Vector"])
        mp2 = N.new("ShaderNodeMapping")
        mp2.inputs["Scale"].default_value = (1 / (scale * 2.7),) * 3
        mp2.inputs["Rotation"].default_value = (0, 0, 0.64)
        L.new(tc.outputs["Object"], mp2.inputs["Vector"])
        d1, d2 = tex_node(nt, WALK / "tex" / f"{name}_diff.webp"), tex_node(nt, WALK / "tex" / f"{name}_diff.webp")
        d1.projection = d2.projection = "BOX"  # walls and benches without smearing
        d1.projection_blend = d2.projection_blend = 0.25
        L.new(mp.outputs[0], d1.inputs["Vector"])
        L.new(mp2.outputs[0], d2.inputs["Vector"])
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        L.new(noise.outputs["Fac"], mix.inputs["Factor"])
        L.new(d1.outputs["Color"], mix.inputs[6])
        L.new(d2.outputs["Color"], mix.inputs[7])
        nn = tex_node(nt, WALK / "tex" / f"{name}_nor.webp", non_color=True)
        L.new(mp.outputs[0], nn.inputs["Vector"])
        wv = sep[w].outputs[ch] if ch < 3 else vcol[w].outputs["Alpha"]
        tint = {"laterite": (1.18, 0.82, 0.68), "mine": (1.22, 0.7, 0.52)}.get(name)  # Nimba's iron-rich soils are redder
        if tint:
            tm = N.new("ShaderNodeVectorMath")
            tm.operation = "MULTIPLY"
            L.new(mix.outputs[2], tm.inputs[0])
            tm.inputs[1].default_value = tint
            mix_out = tm.outputs[0]
        else:
            mix_out = mix.outputs[2]
        sc = N.new("ShaderNodeVectorMath")
        sc.operation = "SCALE"
        L.new(mix_out, sc.inputs[0])
        L.new(wv, sc.inputs["Scale"])
        sn = N.new("ShaderNodeVectorMath")
        sn.operation = "SCALE"
        L.new(nn.outputs["Color"], sn.inputs[0])
        L.new(wv, sn.inputs["Scale"])
        col_acc = sc.outputs[0] if col_acc is None else add(col_acc, sc.outputs[0])
        nor_acc = sn.outputs[0] if nor_acc is None else add(nor_acc, sn.outputs[0])
    L.new(col_acc, bsdf.inputs["Base Color"])
    nm = N.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 1.2
    L.new(nor_acc, nm.inputs["Color"])
    L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def far_material():
    """Distant massif: land-cover colour (vertex attribute) with crown bumps where there is forest."""
    m = bpy.data.materials.new("far")
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    ca = N.new("ShaderNodeVertexColor")
    ca.layer_name = "base"
    fa = N.new("ShaderNodeAttribute")
    fa.attribute_name = "forest"
    tc = N.new("ShaderNodeTexCoord")
    vor = N.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 1 / 9.0
    L.new(tc.outputs["Object"], vor.inputs["Vector"])
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1 / 60.0
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    # colour: base × (0.8 … 1.15) by broad noise, darker in the gaps between crowns
    gap = N.new("ShaderNodeMapRange")
    gap.inputs["From Max"].default_value = 0.35
    gap.inputs["To Min"].default_value = 0.55
    L.new(vor.outputs["Distance"], gap.inputs["Value"])
    gmix = N.new("ShaderNodeMix")
    gmix.data_type = "FLOAT"
    L.new(fa.outputs["Fac"], gmix.inputs["Factor"])
    gmix.inputs[2].default_value = 1.0
    L.new(gap.outputs["Result"], gmix.inputs[3])
    br = N.new("ShaderNodeMapRange")
    br.inputs["To Min"].default_value = 0.8
    br.inputs["To Max"].default_value = 1.15
    L.new(noise.outputs["Fac"], br.inputs["Value"])
    m1 = N.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    L.new(gmix.outputs[0], m1.inputs[0])
    L.new(br.outputs["Result"], m1.inputs[1])
    sc = N.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    L.new(ca.outputs["Color"], sc.inputs[0])
    L.new(m1.outputs[0], sc.inputs["Scale"])
    L.new(sc.outputs[0], bsdf.inputs["Base Color"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 3.0
    bs = N.new("ShaderNodeMath")
    bs.operation = "MULTIPLY"
    L.new(fa.outputs["Fac"], bs.inputs[0])
    bs.inputs[1].default_value = 0.9
    L.new(bs.outputs[0], bump.inputs["Strength"])
    L.new(vor.outputs["Distance"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def water_material():
    m = bpy.data.materials.new("water")
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.035, 0.03, 1)
    b.inputs["Roughness"].default_value = 0.04
    b.inputs["IOR"].default_value = 1.33
    return m


# ---------------------------------------------------------------- scene parts

CLASS_COL = {  # linear base colours for the distant massif (tuned by eye against the walk-mode look)
    10: (0.030, 0.055, 0.020), 20: (0.080, 0.085, 0.030), 30: (0.200, 0.170, 0.060), 40: (0.160, 0.130, 0.060),
    50: (0.180, 0.090, 0.050), 60: (0.230, 0.110, 0.060), 80: (0.020, 0.030, 0.035), 90: (0.060, 0.080, 0.040),
}


def build_far(T, cx, cz, hole, spacing):
    lo, hi = T.extent
    xs = np.arange(lo, hi + 1e-3, spacing)
    X, Zs = np.meshgrid(xs, xs)  # rows = z (south)
    g = T.sample(T.h, X, Zs)
    can = T.sample(T.canopy, X, Zs)
    cls = T.sample(T.cls, X, Zs, nearest=True)
    forest = np.clip((can - 3) / 9, 0, 1)
    H = g + can * 0.9
    # sink it under the fine patch so the two never fight
    inside = (np.abs(X - cx) < hole - 40) & (np.abs(Zs - cz) < hole - 40)
    # far under the fine patch: its coarse triangles would otherwise bridge pits and valleys above the camera
    H = np.where(inside, g - 300, H)
    base = np.zeros(X.shape + (3,), np.float32)
    for k, c in CLASS_COL.items():
        base[cls == k] = c
    base[cls == 0] = CLASS_COL[30]
    base = base * (1 - forest[..., None]) + np.array(CLASS_COL[10]) * forest[..., None]
    ob = grid_mesh("far", X, -Zs, H, {"base": base, "forest": forest})
    ob.data.materials.append(far_material())
    return ob


def build_near(T, cx, cz, R, spacing, tree_r, areas):
    n = int(R / spacing)
    ax = np.arange(-n, n + 1) * spacing
    X, Zs = np.meshgrid(cx + ax, cz + ax)
    g = T.sample(T.h, X, Zs)
    can = T.sample(T.canopy, X, Zs)
    rock = T.sample(T.rock, X, Zs)
    cls = T.sample(T.cls, X, Zs, nearest=True)
    d = np.hypot(X - cx, Zs - cz)
    edge = np.clip((R - np.maximum(np.abs(X - cx), np.abs(Zs - cz))) / 80, 0, 1)
    # mapped areas (OpenStreetMap): lakes are carved below their water level, mines are bare spoil
    m_water = np.zeros(X.shape, bool)
    m_mine = np.zeros(X.shape, bool)
    m_rock = np.zeros(X.shape, bool)
    level = np.full(X.shape, np.inf, np.float32)
    for kind, _name, P in areas:
        if kind not in ("water", "mine", "rock"):
            continue
        msk = inside(P, X, Zs)
        if kind == "water":
            m_water |= msk
            level = np.where(msk, np.minimum(level, lake_level(T, P)), level)
        elif kind == "mine":
            m_mine |= msk
        else:
            m_rock |= msk
    can = np.where(m_water, 0, np.where(m_mine, np.minimum(can, 3), can))

    def soft(m, r=3):
        """Box-blurred mask (r cells each way, twice): surfaces blend across mapped outlines."""
        a = m.astype(np.float32)
        for _ in range(2):
            for ax in (0, 1):
                a = sum(np.roll(a, k, ax) for k in range(-r, r + 1)) / (2 * r + 1)
        return a
    H = g + detail(X, Zs, 0.55 + rock * 1.2 + m_mine * 0.8) * edge
    # (the carve itself is applied below, eased in over the shore so the bank slopes into the water)
    # beyond the tree radius the canopy is drawn as relief (like the far massif)
    shell = np.clip((d - tree_r) / 120, 0, 1)
    H = H + can * 0.9 * shell
    # surface weights (as in src/walk/terrainShader.ts, simplified)
    gx, gz = np.gradient(H, spacing)
    slope = 1 - 1 / np.sqrt(1 + gx * gx + gz * gz)
    steep = np.clip((slope - 0.3) / 0.25, 0, 1)
    forest = np.clip((can - 3) / 9, 0, 1)
    grassy = ((cls == 30) | (cls == 20)).astype(np.float32)
    bare = (cls == 60).astype(np.float32)
    built = (cls == 50).astype(np.float32)
    high = np.clip((g - 1150) / 200, 0, 1)
    cloud = np.clip((g - 850) / 200, 0, 1)
    n1 = value_noise(X, Zs, 3.1, 81) * 0.5 + 0.5
    n2 = value_noise(X, Zs, 17.0, 82) * 0.5 + 0.5
    turf = np.clip(grassy * (1 - forest) - n1 * 0.2, 0, 1)
    w_litter = np.clip(forest + n1 * 0.2, 0, 1)
    w_laterite = np.clip(built * 0.9 + 0.08 + n2 * 0.12 - forest * 0.1, 0, 1)
    w_turf = turf * (1 - high)
    w_rock = np.clip(rock * 1.3 + steep + n2 * 0.25 - 0.15 + bare * 0.5, 0, 1)
    w_moss = cloud * (forest * 0.55 + w_rock * 0.4) * (0.6 + n1 * 0.4)
    w_high = turf * high
    s_mine, s_water, s_rock = soft(m_mine), soft(m_water), soft(m_rock)
    if m_water.any():
        lv = np.where(np.isfinite(level), level, np.nan)
        # spread the lake level a little beyond the outline so the eased bank has a target
        lvs = lv.copy()
        for _ in range(6):
            for ax in (0, 1):
                for k in (-1, 1):
                    sh = np.roll(lvs, k, ax)
                    lvs = np.where(np.isnan(lvs), sh, lvs)
        lvs = np.where(np.isnan(lvs), H, lvs)
        bed = np.minimum(H, lvs - 1.2)
        ease = np.clip(s_water * 1.6, 0, 1)
        eased = H * (1 - ease) + bed * ease
        # outside the outline the bank stops at the waterline (never a dry hollow below the lake surface)
        H = np.where(m_water, np.minimum(eased, lvs - 0.6), np.maximum(eased, np.minimum(H, lvs + 0.25)))
    w_mine = np.maximum(bare * (1 - forest) * 0.8, s_mine * 1.6)
    w_rock = np.maximum(w_rock, s_rock * 1.2)
    w_turf = w_turf * (1 - s_mine * 0.85)
    w_high = w_high * (1 - s_mine * 0.85)
    w_litter = w_litter * (1 - s_mine * 0.8)
    w_sand = s_water * 1.0
    w_laterite = w_laterite * (1 - s_water)
    W = np.stack([w_litter, w_laterite, w_turf, w_rock, w_moss, w_high, w_mine, w_sand], -1)
    W = W / (W.sum(-1, keepdims=True) + 1e-4)
    ob = grid_mesh("near", X, -Zs, H, {"w1": W[..., :4], "w2": W[..., 4:]})
    ob.data.materials.append(ground_material())
    return ob, dict(X=X, Z=Zs, H=H, g=g, can=can, cls=cls, rock=rock, slope=slope, high=high, bare=bare, d=d)


def build_water(T, areas, cx, cz, R):
    """OpenStreetMap lakes / flooded pits near the camera: flat water at the measured level."""
    import bmesh
    mat = water_material()
    for kind, name, P in areas:
        if kind != "water" or len(P) < 3:
            continue
        if np.hypot(P[:, 0].mean() - cx, P[:, 1].mean() - cz) > R * 1.5:
            continue
        lv = lake_level(T, P)
        log(f"lake: {len(P)} points, level {lv:.1f} m")
        Q = P[:-1] if np.allclose(P[0], P[-1]) else P
        me = bpy.data.meshes.new("lake")
        bm = bmesh.new()
        vs = [bm.verts.new((float(x), float(-z), lv)) for x, z in Q]
        try:
            f = bm.faces.new(vs)
            if f.normal.z < 0:
                f.normal_flip()
            bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")
        except ValueError:
            bm.free()
            continue
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new("lake", me)
        ob.data.materials.append(mat)
        bpy.context.scene.collection.objects.link(ob)


def scatter(T, cx, cz, F, assets, tree_r, density, areas=(), seed=7):
    """Place plants and rocks from the data (deterministic). Returns {asset id: (points, rot, scl)}."""
    rng = np.random.default_rng(seed)
    out = {}
    gx, gz, gh = F["X"][0], F["Z"][:, 0], F["H"]
    sp = gx[1] - gx[0]

    def ground(x, z):
        """Height of the fine ground mesh (carved lakes, mine relief) at x, z (bilinear on its grid)."""
        u = np.clip((x - gx[0]) / sp, 0, len(gx) - 1.001)
        v = np.clip((z - gz[0]) / sp, 0, len(gz) - 1.001)
        i, j = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = u - i, v - j
        return (gh[j, i] * (1 - fu) + gh[j, i + 1] * fu) * (1 - fv) + (gh[j + 1, i] * (1 - fu) + gh[j + 1, i + 1] * fu) * fv

    def area(kind, x, z):
        m = np.zeros(np.shape(x), bool)
        for k, _n, P in areas:
            if k == kind:
                m |= inside(P, x, z)
        return m

    def put(aid, x, z, s, tilt=0.06, max_w=None):
        """s: uniform scale per instance; max_w caps the footprint (m) – long, flat scans (a 1.7 m strip of grass)
        get their height from s but are not widened with it."""
        if aid not in assets or not len(x):
            return
        y = ground(x, z)
        P = np.stack([x, -z, y - 0.04 * s], -1)
        rot = np.stack([rng.normal(0, tilt, len(x)), rng.normal(0, tilt, len(x)), rng.uniform(0, 2 * np.pi, len(x))], -1)
        scl = np.repeat(np.asarray(s, np.float32)[:, None], 3, 1)
        if max_w is not None:
            w = max(assets[aid]["size"][:2])
            scl[:, :2] = np.minimum(scl[:, :2], max_w / max(w, 1e-3))
        prev = out.get(aid)
        out[aid] = (np.concatenate([prev[0], P]), np.concatenate([prev[1], rot]), np.concatenate([prev[2], scl])) if prev else (P, rot, scl)

    def field(radius, spacing):
        n = int(radius / spacing)
        a = np.arange(-n, n + 1) * spacing
        x, z = np.meshgrid(cx + a, cz + a)
        x = x.ravel() + rng.uniform(-0.5, 0.5, x.size) * spacing
        z = z.ravel() + rng.uniform(-0.5, 0.5, z.size) * spacing
        d = np.hypot(x - cx, z - cz)
        keep = (d < radius) & (d > 0.8)
        return x[keep], z[keep], d[keep]

    # grass and shrubs (open ground): a dense inner ring and a sparser outer ring of bigger tufts
    rings = [field(22 * density ** 0.5, 0.26 / density ** 0.5), field(85, 0.62 / density ** 0.5)]
    rx, rz, rd = (np.concatenate(v) for v in zip(*rings))
    inner = np.concatenate([np.ones(len(rings[0][0]), bool), np.zeros(len(rings[1][0]), bool)])
    keep = inner | (rd > 22 * density ** 0.5)
    x, z, d, inner = rx[keep], rz[keep], rd[keep], inner[keep]
    can = T.sample(T.canopy, x, z)
    cls = T.sample(T.cls, x, z, nearest=True)
    rock = T.sample(T.rock, x, z)
    g = T.sample(T.h, x, z)
    water, mine = area("water", x, z), area("mine", x, z)
    open_ = (can < 4) & (cls != 80) & ~water
    p_grass = np.where(open_, np.clip(0.97 - rock * 1.1, 0, 1), 0.05) * np.where(mine, 0.3, 1.0) * ~water  # old spoil: patchy regrowth
    patch = value_noise(x, z, 6.0, 31) * 0.5 + 0.5  # grass grows in clumps and patches
    u = rng.random(x.size)
    sel = u < p_grass * (0.55 + 0.45 * patch)
    high = g > 1150
    gid = np.where(rng.random(x.size) < np.where(high, 0.8, 0.55), "grass_medium_02", "grass_bermuda_01")
    for aid in ("grass_medium_02", "grass_bermuda_01"):
        k = sel & (gid == aid)
        sz = assets[aid]["size"] if aid in assets else [1, 1, 1]
        # montane grassland: a dense, knee-high sward; lowland savanna grass taller still
        target = np.where(high[k], 0.62, 0.85) * (0.55 + 0.9 * rng.random(k.sum()) * (0.6 + 0.4 * patch[k])) * np.where(inner[k], 1.0, 1.35)
        put(aid, x[k], z[k], target / max(sz[2], 0.05), max_w=1.6)
    shrub = (~sel) & open_ & (rng.random(x.size) < np.where(mine, 0.025, 0.04))
    for i, aid in enumerate(("shrub_01", "shrub_02", "shrub_03", "shrub_04")):
        k = shrub & (rng.integers(0, 4, x.size) == i)
        sz = assets.get(aid, {}).get("size", [1, 1, 1])
        put(aid, x[k], z[k], (0.6 + rng.random(k.sum()) * 0.9) / max(sz[2], 0.05))
    # rocks: outcrops on the rock mask and on bare ground, a few everywhere
    x, z, d = field(160, 3.0)
    rock = T.sample(T.rock, x, z)
    bare = T.sample(T.cls, x, z, nearest=True) == 60
    p = np.clip(rock * 0.6 + bare * 0.25 + area("mine", x, z) * 0.35, 0.01, 0.8) * np.clip(1.2 - d / 160, 0.2, 1)
    p = p * ~area("water", x, z)
    k = rng.random(x.size) < p
    for aid in ("boulder_01", "rock_07", "rock_09", "rock_moss_set_01"):
        kk = k & (rng.integers(0, 4, x.size) == ("boulder_01", "rock_07", "rock_09", "rock_moss_set_01").index(aid))
        sz = assets.get(aid, {}).get("size", [1, 1, 1])
        put(aid, x[kk], z[kk], (0.4 + rng.random(kk.sum()) ** 3 * 2.5) / max(max(sz[:2]), 0.05), tilt=0.4)
    # trees: one per crown-sized cell where the canopy model says there is forest
    x, z, d = field(tree_r, 7.0)
    can = T.sample(T.canopy, x, z)
    k = (can > 4) & (rng.random(x.size) < np.clip(can / 12, 0.2, 0.95)) & ~area("water", x, z) & ~area("mine", x, z)
    trees = [a for a in ("island_tree_01", "island_tree_02", "island_tree_03", "tree_small_02") if a in assets]
    if trees:
        pick = rng.integers(0, len(trees), x.size)
        for i, aid in enumerate(trees):
            kk = k & (pick == i)
            sz = assets[aid]["size"]
            put(aid, x[kk], z[kk], can[kk] * (0.75 + 0.35 * rng.random(kk.sum())) / max(sz[2], 0.5), tilt=0.03)
    # understorey under the trees
    x, z, d = field(min(tree_r, 60), 1.6)
    can = T.sample(T.canopy, x, z)
    k = (can > 6) & (rng.random(x.size) < 0.35)
    for aid in ("fern_02", "calathea_orbifolia_01", "pachira_aquatica_01"):
        kk = k & (rng.integers(0, 3, x.size) == ("fern_02", "calathea_orbifolia_01", "pachira_aquatica_01").index(aid))
        sz = assets.get(aid, {}).get("size", [1, 1, 1])
        put(aid, x[kk], z[kk], (0.6 + rng.random(kk.sum()) * 0.8) / max(sz[2], 0.05))
    return out


def sky_and_sun(tp):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("sky")
    sc.world = w
    nt = w.node_tree
    N, L = nt.nodes, nt.links
    bg = N["Background"]
    sky = N.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(tp["el"])
    # measured: the sky's sun_rotation is the compass azimuth (0 = north = +Y, clockwise), like the app's
    sky.sun_rotation = math.radians(tp["az"])
    sky.altitude = 1700
    sky.aerosol_density = 2.0
    L.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.25
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.2
    sun.angle = math.radians(0.6)
    sun.color = (1.0, 0.93, 0.82) if tp["el"] < 35 else (1.0, 0.97, 0.93)
    so = bpy.data.objects.new("sun", sun)
    el, az = math.radians(tp["el"]), math.radians(tp["az"])
    # light points along -Z of the object: aim it from the sun's direction
    d = np.array([math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)])
    import mathutils
    so.rotation_euler = mathutils.Vector(-d).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(so)


def haze_volume(cx, cy, k, base_z):
    """Aerial perspective: a huge box of thin scattering medium thinning out with height."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, base_z + 3000))
    ob = bpy.context.active_object
    ob.name = "haze"
    ob.scale = (60000, 60000, 6000)
    m = bpy.data.materials.new("haze")
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.remove(N["Principled BSDF"])
    vol = N.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.78, 0.84, 0.92, 1)
    vol.inputs["Anisotropy"].default_value = 0.55
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Object"], sep.inputs[0])
    # object z in [-0.5, 0.5] spans base_z … base_z + 6000 m: density ∝ exp(-(height above base)/1400 m)
    m1 = N.new("ShaderNodeMath")
    m1.operation = "MULTIPLY_ADD"
    L.new(sep.outputs["Z"], m1.inputs[0])
    m1.inputs[1].default_value = -6000 / 1400
    m1.inputs[2].default_value = -0.5 * 6000 / 1400
    ex = N.new("ShaderNodeMath")
    ex.operation = "EXPONENT"
    L.new(m1.outputs[0], ex.inputs[0])
    dn = N.new("ShaderNodeMath")
    dn.operation = "MULTIPLY"
    L.new(ex.outputs[0], dn.inputs[0])
    dn.inputs[1].default_value = 4.5e-5 * k
    L.new(dn.outputs[0], vol.inputs["Density"])
    L.new(vol.outputs[0], N["Material Output"].inputs["Volume"])
    ob.data.materials.append(m)
    ob.visible_shadow = False
    return ob


def cloud_volume(cx, cy, bottom, top, amount):
    """Sea of clouds: a slab of noise-shaped cloud between bottom and top (m)."""
    h = top - bottom
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, bottom + h / 2))
    ob = bpy.context.active_object
    ob.name = "clouds"
    ob.scale = (40000, 40000, h)
    m = bpy.data.materials.new("clouds")
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.remove(N["Principled BSDF"])
    vol = N.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.95, 0.96, 0.97, 1)
    vol.inputs["Anisotropy"].default_value = 0.6
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 26.0
    noise.inputs["Detail"].default_value = 6
    noise.inputs["Roughness"].default_value = 0.55
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Object"], sep.inputs[0])
    # vertical profile: 0 at the slab edges, 1 in the lower middle (flat bottoms, puffy tops)
    prof = N.new("ShaderNodeFloatCurve")
    L.new(sep.outputs["Z"], prof.inputs["Value"])
    c = prof.mapping.curves[0]
    c.points[0].location = (-0.5, 0.0)
    c.points[1].location = (0.5, 0.0)
    c.points.new(-0.3, 1.0)
    c.points.new(0.05, 0.8)
    prof.mapping.clip_min_x, prof.mapping.clip_max_x = -0.5, 0.5
    prof.mapping.use_clip = False
    sub = N.new("ShaderNodeMath")
    sub.operation = "SUBTRACT"
    L.new(noise.outputs["Fac"], sub.inputs[0])
    sub.inputs[1].default_value = 0.6 - amount * 0.12
    mul = N.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    L.new(sub.outputs[0], mul.inputs[0])
    L.new(prof.outputs["Value"], mul.inputs[1])
    dens = N.new("ShaderNodeMath")
    dens.operation = "MULTIPLY"
    dens.use_clamp = False
    L.new(mul.outputs[0], dens.inputs[0])
    dens.inputs[1].default_value = 0.06  # per metre: soft-edged, with gaps where the noise is below the threshold
    mx = N.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    L.new(dens.outputs[0], mx.inputs[0])
    mx.inputs[1].default_value = 0.0
    L.new(mx.outputs[0], vol.inputs["Density"])
    L.new(vol.outputs[0], N["Material Output"].inputs["Volume"])
    ob.data.materials.append(m)
    return ob


def camera(x, y, z, yaw, pano, fov=70, pitch=0.0):
    cd = bpy.data.cameras.new("cam")
    if pano:
        cd.type = "PANO"
        cd.panorama_type = "EQUIRECTANGULAR"
    else:
        cd.lens_unit = "FOV"
        cd.angle = math.radians(fov)
    cd.clip_start = 0.05
    cd.clip_end = 80000
    ob = bpy.data.objects.new("cam", cd)
    ob.location = (x, y, z)
    # walk yaw → Blender: forward (-sin yaw, +cos yaw) in (X, Y)
    ob.rotation_euler = (math.pi / 2 + (0 if pano else pitch), 0, yaw)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


# ---------------------------------------------------------------- main

def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spot", default="summit", choices=sorted(SPOTS))
    ap.add_argument("--pano", action="store_true", help="equirectangular 360° (2:1)")
    ap.add_argument("--res", type=int, default=1024, help="image width")
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--gpu", action="store_true")
    ap.add_argument("--time", choices=sorted(TIMES))
    ap.add_argument("--near", type=float, default=900, help="fine ground patch half-size (m)")
    ap.add_argument("--spacing", type=float, default=2.0, help="fine ground vertex spacing (m)")
    ap.add_argument("--far-spacing", type=float, default=30.0)
    ap.add_argument("--trees", type=float, default=450, help="radius with instanced trees (m)")
    ap.add_argument("--density", type=float, default=1.0, help="ground cover density factor")
    ap.add_argument("--no-clouds", action="store_true")
    ap.add_argument("--no-plants", action="store_true")
    ap.add_argument("--yaw", type=float)
    ap.add_argument("--pitch", type=float, default=0.0)
    ap.add_argument("--out")
    ap.add_argument("--blend", help="also save the .blend here")
    ap.add_argument("--publish", action="store_true", help="(with --pano) copy into public/pano/ (large + 2k) and list it in panos.json")
    a = ap.parse_args(argv)

    spot = SPOTS[a.spot]
    tp = TIMES[a.time or spot["time"]]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable("cycles", default_set=True)
    addon_utils.enable("io_scene_gltf2", default_set=True)
    sc = bpy.context.scene
    log("loading terrain tiles")
    T = Terrain()
    cx, cz = T.xz(spot["lon"], spot["lat"])
    log(f"spot {a.spot}: x {cx:.0f} z {cz:.0f} ground {T.sample(T.h, cx, cz):.0f} m")

    log("far massif")
    build_far(T, cx, cz, a.near, a.far_spacing)
    areas = osm_areas(T, cx, cz, a.near + 200)
    log(f"{len(areas)} mapped areas (OpenStreetMap)")
    log("fine ground")
    near, F = build_near(T, cx, cz, a.near, a.spacing, a.trees, areas)
    build_water(T, areas, cx, cz, a.near)
    # stand on dry, not too steep ground nearest the spot (a spot on a lake moves to its shore)
    wet = [P for k, _n, P in areas if k == "water"]
    gxs, gzs, gH = F["X"][0], F["Z"][:, 0], F["H"]
    sp = gxs[1] - gxs[0]
    best = None
    for r in np.arange(0, 160, sp):
        for ang in np.linspace(0, 2 * np.pi, max(1, int(2 * np.pi * r / sp)), endpoint=False):
            x, z = cx + r * np.cos(ang), cz + r * np.sin(ang)
            if any(inside(P, np.array([x]), np.array([z]))[0] for P in wet):
                continue
            i, j = int(round((x - gxs[0]) / sp)), int(round((z - gzs[0]) / sp))
            sl = abs(gH[j, i + 1] - gH[j, i - 1]) + abs(gH[j + 1, i] - gH[j - 1, i])
            if sl / (2 * sp) < 0.35:
                best = (x, z, float(gH[j, i]))
                break
        if best:
            break
    if best and (best[0], best[1]) != (cx, cz):
        log(f"camera moved {np.hypot(best[0] - cx, best[1] - cz):.0f} m to dry ground")
    cam_x, cam_z, ground_z = best if best else (cx, cz, float(T.sample(T.h, cx, cz)))
    log(f"camera at x {cam_x:.0f} z {cam_z:.0f}, ground {ground_z:.1f} m (data {float(T.sample(T.h, cam_x, cam_z)):.1f} m)")

    if not a.no_plants:
        log("assets")
        assets = {}
        for p in sorted(ASSETS.glob("*/*.gltf")):
            ob = load_asset(p.parent.name)
            if ob:
                assets[ob.name] = {"ob": ob, "size": list(ob["size"])}
        log(f"{len(assets)} assets; scattering")
        placed = scatter(T, cx, cz, F, assets, a.trees, a.density, areas)
        total = 0
        for aid, (P, rot, scl) in placed.items():
            # keep the camera's own spot clear
            far_enough = np.hypot(P[:, 0] - cam_x, P[:, 1] + cam_z) > 1.2
            po = points_object(f"pts_{aid}", P[far_enough], rot[far_enough], scl[far_enough])
            instancer(po, assets[aid]["ob"])
            total += int(far_enough.sum())
        log(f"{total} instances")

    sky_and_sun(tp)
    haze_volume(cx, -cz, tp["haze"], 300)
    if spot.get("clouds") and not a.no_clouds:
        cloud_volume(cx, -cz, 1080, 1420, 0.6 if a.time != "mist" else 0.9)

    yaw = a.yaw if a.yaw is not None else spot["yaw"]
    camera(cam_x, -cam_z, ground_z + 1.7, yaw, a.pano, pitch=a.pitch)

    r = sc.render
    r.engine = "CYCLES"
    r.resolution_x = a.res
    r.resolution_y = a.res // 2 if a.pano else int(a.res * 9 / 16)
    r.resolution_percentage = 100
    cy = sc.cycles
    cy.samples = a.samples
    cy.use_denoising = True
    cy.max_bounces = 6
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 2
    cy.transmission_bounces = 4
    cy.transparent_max_bounces = 16
    cy.volume_bounces = 1
    cy.volume_step_rate = 4.0
    if a.gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == kind
                    cy.device = "GPU"
                    log(f"GPU: {kind}")
                    break
            except TypeError:
                continue
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast" if "AgX - Base Contrast" in [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items] else "None"
    sc.view_settings.exposure = 0.35
    out = pathlib.Path(a.out) if a.out else HERE / "out" / f"{a.spot}{'_pano' if a.pano else ''}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    r.image_settings.file_format = "JPEG"
    r.image_settings.quality = 88
    r.filepath = str(out)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=a.blend)
    log(f"rendering {r.resolution_x}×{r.resolution_y}, {a.samples} samples")
    bpy.ops.render.render(write_still=True)
    log(f"wrote {out}")
    if a.publish and a.pano:
        publish(a.spot, spot, yaw, out)


def publish(sid, spot, yaw, path):
    """Copy a rendered panorama into the web app: <id>.jpg (as rendered) and <id>_2k.jpg, plus panos.json."""
    import json
    import shutil
    dst = ROOT / "public" / "pano"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dst / f"{sid}.jpg")
    img = bpy.data.images.load(str(path))
    if img.size[0] > 2048:
        img.scale(2048, 1024)
    # raw pixels (the render already went through the view transform: save_render would apply it twice)
    img.filepath_raw = str(dst / f"{sid}_2k.jpg")
    img.file_format = "JPEG"
    img.save(quality=82)
    reg_path = dst / "panos.json"
    reg = json.loads(reg_path.read_text()) if reg_path.exists() else {"panos": []}
    reg["panos"] = [p for p in reg["panos"] if p["id"] != sid] + [{
        "id": sid, "lon": spot["lon"], "lat": spot["lat"], "yaw": yaw,
        "src": {"lg": f"pano/{sid}.jpg", "sm": f"pano/{sid}_2k.jpg"},
        "title_fr": spot["fr"], "title_en": spot["en"],
    }]
    reg["note"] = "Computer-generated (Blender/Cycles) from the app's terrain and land-cover data; generic CC0 plants (Poly Haven). scripts/blender/nimba_render.py"
    reg_path.write_text(json.dumps(reg, indent=1, ensure_ascii=False) + "\n")
    log(f"published {sid} → public/pano/")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(argv)
