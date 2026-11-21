"""Nimba asset kit – models built in Blender (bpy) for the Unreal world.

Every asset is generated from code (no downloaded meshes), textured with the app's CC0 ground/bark scans and
with small generated leaf textures, then exported as GLB into worldpack/kit/ and rendered for review.

    python scripts/blender/nimba_kit.py                 # build + export + review renders
    python scripts/blender/nimba_kit.py --no-render     # build + export only
    blender -b --python scripts/blender/nimba_kit.py -- --only parinari_tree

The shapes are generic growth forms taken from worldpack/ASSETS.md (which only repeats the sources of
public/data/content.json). They are NOT botanically validated models of the named species: each one is
flagged "to validate" in kit.json until someone checks it against reference photos or herbarium sheets.
"""
import argparse
import json
import math
import pathlib
import sys

import bpy
import numpy as np
from mathutils import noise as mnoise, Vector
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TEX_SRC = ROOT / "public" / "walk" / "tex"
KIT = ROOT / "worldpack" / "kit"
TEX = KIT / "tex"
SHOTS = ROOT / "docs" / "screens" / "kit"


def log(*a):
    print("[kit]", *a, flush=True)


def norm(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


# ---------------------------------------------------------------- textures

def prep_textures():
    """JPEG copies of the app's CC0 scans + generated leaf / blade textures (worldpack/kit/tex)."""
    TEX.mkdir(parents=True, exist_ok=True)
    for role in ("bark", "barkGrey", "rock", "moss", "palm"):
        for kind in ("diff", "nor"):
            dst = TEX / f"{role}_{kind}.jpg"
            if not dst.exists():
                Image.open(TEX_SRC / f"{role}_{kind}.webp").convert("RGB").resize((1024, 1024), Image.LANCZOS).save(dst, quality=88)
    # mossy bark for the cloud-forest trees: bark with moss in noise-shaped patches
    dst = TEX / "barkMoss_diff.jpg"
    if not dst.exists():
        b = np.asarray(Image.open(TEX / "bark_diff.jpg"), float)
        m = np.asarray(Image.open(TEX / "moss_diff.jpg"), float)
        rng = np.random.default_rng(3)
        n = np.asarray(Image.fromarray((rng.random((24, 24)) * 255).astype(np.uint8)).resize((1024, 1024), Image.BICUBIC), float) / 255
        k = np.clip((n - 0.38) * 5, 0, 1)[..., None]
        Image.fromarray((b * (1 - k) + m * 0.85 * k).astype(np.uint8)).save(dst, quality=88)
    # fern trunk: dark fibrous brown from the palm scan
    dst = TEX / "fernTrunk_diff.jpg"
    if not dst.exists():
        p = np.asarray(Image.open(TEX / "palm_diff.jpg"), float)
        g = p.mean(-1, keepdims=True)
        Image.fromarray(np.clip(g * np.array([0.55, 0.40, 0.28]), 0, 255).astype(np.uint8)).save(dst, quality=88)

    def leaf_tex(name, cols, rib=0.75, tip=None):
        """4 colour variants side by side (u), base → tip along v, a paler midrib in each column."""
        W, H = 256, 128
        img = np.zeros((H, W, 3))
        v = np.linspace(0, 1, H)[::-1, None]
        rng = np.random.default_rng(len(name))
        for k, c in enumerate(cols):
            c = np.array(c, float)
            x = (np.arange(64) + 0.5) / 64 - 0.5
            col = c[None, None, :] * (0.82 + 0.3 * v[..., None]) * (1 - 0.9 * np.abs(x)[None, :, None] ** 2 * 0.5)
            if tip is not None:
                col = col * (1 - v[..., None] ** 2) + np.array(tip, float)[None, None, :] * v[..., None] ** 2
            ribm = np.exp(-(x / 0.035) ** 2)[None, :, None] * (1 - rib)
            col = col * (1 - ribm) + (c * 1.5 + 0.08)[None, None, :] * ribm
            col = col * (0.94 + 0.12 * rng.random((H, 64, 1)))
            img[:, k * 64:(k + 1) * 64] = col
        Image.fromarray((np.clip(img, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(TEX / f"{name}.png")

    # linear RGB; four variants each (the fourth is the oldest / driest)
    leaf_tex("leaf_parinari", [(0.045, 0.125, 0.030), (0.060, 0.150, 0.038), (0.036, 0.105, 0.030), (0.100, 0.150, 0.040)])
    leaf_tex("leaf_montane", [(0.050, 0.130, 0.034), (0.070, 0.155, 0.040), (0.040, 0.110, 0.038), (0.130, 0.145, 0.045)])
    leaf_tex("leaf_protea", [(0.085, 0.130, 0.085), (0.100, 0.150, 0.095), (0.070, 0.115, 0.080), (0.130, 0.140, 0.080)], rib=0.6)
    leaf_tex("bract_protea", [(0.62, 0.50, 0.40), (0.68, 0.52, 0.44), (0.55, 0.42, 0.34), (0.60, 0.55, 0.42)], rib=0.9)
    leaf_tex("leaf_fern", [(0.035, 0.115, 0.020), (0.050, 0.140, 0.025), (0.028, 0.095, 0.022), (0.150, 0.110, 0.040)])
    leaf_tex("leaf_palm", [(0.030, 0.090, 0.018), (0.040, 0.105, 0.022), (0.026, 0.078, 0.020), (0.120, 0.115, 0.045)], rib=0.6)
    leaf_tex("blade_tussock", [(0.045, 0.110, 0.016), (0.065, 0.130, 0.020), (0.100, 0.135, 0.028), (0.190, 0.160, 0.055)],
             rib=1.0, tip=(0.24, 0.21, 0.08))


_MATS = {}


def material(name, diff, nor=None, rough=0.8, two_sided=False, tint=None):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_backface_culling = not two_sided
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    t = N.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(TEX / diff), check_existing=True)
    if tint:
        mx = N.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        L.new(t.outputs["Color"], mx.inputs["A"])
        mx.inputs["B"].default_value = (*tint, 1)
        L.new(mx.outputs["Result"], bsdf.inputs["Base Color"])
    else:
        L.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if nor:
        tn = N.new("ShaderNodeTexImage")
        tn.image = bpy.data.images.load(str(TEX / nor), check_existing=True)
        tn.image.colorspace_settings.name = "Non-Color"
        nm = N.new("ShaderNodeNormalMap")
        L.new(tn.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if two_sided:  # thin leaves: let some light through (Cycles); glTF keeps doubleSided
        try:
            bsdf.inputs["Subsurface Weight"].default_value = 0.0
            bsdf.inputs["Transmission Weight"].default_value = 0.0
            bsdf.inputs["Sheen Weight"].default_value = 0.15
        except KeyError:
            pass
    _MATS[name] = m
    return m


# ---------------------------------------------------------------- mesh builder

class MB:
    """Accumulates vertices / UVs / faces for one asset, by material name."""

    def __init__(self):
        self.v, self.uv, self.f, self.fm, self.n = [], [], [], [], 0
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, V, UV, F, mat):
        V = np.asarray(V, float).reshape(-1, 3)
        F = np.asarray(F, np.int64) + self.n
        self.v.append(V)
        self.uv.append(np.asarray(UV, float).reshape(-1, 2))
        self.f.append(F)
        self.fm.append(np.full(len(F), self.mat(mat), np.int32))
        self.n += len(V)

    def tube(self, pts, radii, sides, mat, tile=0.8, cap=False):
        pts = np.asarray(pts, float)
        radii = np.broadcast_to(np.asarray(radii, float), (len(pts),))
        tan = norm(np.gradient(pts, axis=0))
        nrm = np.cross(tan[0], [0.3, 0.9, 0.1])
        if np.linalg.norm(nrm) < 1e-3:
            nrm = np.cross(tan[0], [1, 0, 0])
        nrm = norm(nrm)
        seg = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
        reps = max(1, round(2 * math.pi * float(radii[0]) / tile))
        a = np.linspace(0, 2 * math.pi, sides + 1)
        V, UV = [], []
        for i in range(len(pts)):
            nrm = norm(nrm - tan[i] * np.dot(nrm, tan[i]))
            b = np.cross(tan[i], nrm)
            ring = pts[i] + radii[i] * (np.cos(a)[:, None] * nrm + np.sin(a)[:, None] * b)
            V.append(ring)
            UV.append(np.stack([a / (2 * math.pi) * reps, np.full(sides + 1, seg[i] / tile)], -1))
        k = sides + 1
        i, j = np.meshgrid(np.arange(len(pts) - 1), np.arange(sides), indexing="ij")
        q = (i * k + j).ravel()
        self.add(np.concatenate(V), np.concatenate(UV), np.stack([q, q + 1, q + k + 1, q + k], -1), mat)
        if cap:
            for end, order in ((0, -1), (len(pts) - 1, 1)):
                ring = V[end][:-1]
                c = pts[end]
                VV = np.concatenate([ring, [c]])
                uv = np.concatenate([(ring - c)[:, :2] / tile + 0.5, [[0.5, 0.5]]])
                tri = [[s, (s + 1) % sides, sides][::order] for s in range(sides)]
                self.add(VV, uv, tri, mat)

    def leaves(self, P, D, U, length, width, col, mat, cup=0.12):
        """One 4-triangle leaf per row: base P, direction D, 'up' hint U; col 0..3 picks the texture column."""
        P, D = np.asarray(P, float), norm(D)
        S = np.cross(D, np.asarray(U, float))
        S = norm(np.where(np.linalg.norm(S, axis=1, keepdims=True) < 1e-4, np.cross(D, [0.3, 0.2, 0.9]), S))
        Nn = np.cross(S, D)
        length = np.broadcast_to(np.asarray(length, float), (len(P),))[:, None]
        width = np.broadcast_to(np.asarray(width, float), (len(P),))[:, None]
        col = np.broadcast_to(np.asarray(col), (len(P),))
        lift = Nn * width * cup
        v = np.stack([P,
                      P + D * length * 0.33 - S * width * 0.5 + lift,
                      P + D * length * 0.33 + S * width * 0.5 + lift,
                      P + D * length * 0.72 - S * width * 0.36 + lift,
                      P + D * length * 0.72 + S * width * 0.36 + lift,
                      P + D * length], 1)
        u0 = (col[:, None] + 0.5) / 4
        du = np.array([0, -0.11, 0.11, -0.08, 0.08, 0])[None, :]
        vv = np.array([0.02, 0.33, 0.33, 0.72, 0.72, 0.98])[None, :]
        uv = np.stack([u0 + du, np.broadcast_to(vv, (len(P), 6))], -1)
        base = (np.arange(len(P)) * 6)[:, None]
        tris = np.array([[0, 2, 1], [1, 2, 4], [1, 4, 3], [3, 4, 5]])
        self.add(v.reshape(-1, 3), uv.reshape(-1, 2), (base[:, None, :] + tris[None]).reshape(-1, 3), mat)

    def blades(self, P, out, height, reach, width, col, mat):
        """Grass blades: 3 segments bending outward from the root, tapering to a point."""
        P, out = np.asarray(P, float), norm(out)
        S = np.cross(out, [0, 0, 1.0])
        S = norm(S)
        n = len(P)
        height, reach, width = (np.broadcast_to(np.asarray(a, float), (n,))[:, None] for a in (height, reach, width))
        col = np.broadcast_to(np.asarray(col), (n,))
        rows = []
        for t, wk in ((0, 1.0), (0.4, 0.85), (0.75, 0.55)):
            c = P + out * reach * t ** 2 + np.array([0, 0, 1.0]) * height * (t ** 0.85)
            rows += [c - S * width * wk * 0.5, c + S * width * wk * 0.5]
        rows.append(P + out * reach + np.array([0, 0, 1.0]) * height)
        v = np.stack(rows, 1)
        u0 = (col[:, None] + 0.5) / 4
        du = np.array([-0.1, 0.1, -0.09, 0.09, -0.06, 0.06, 0])[None]
        vv = np.array([0, 0, 0.4, 0.4, 0.75, 0.75, 1.0])[None]
        uv = np.stack([u0 + du, np.broadcast_to(vv, (n, 7))], -1)
        base = (np.arange(n) * 7)[:, None]
        tris = np.array([[0, 1, 3], [0, 3, 2], [2, 3, 5], [2, 5, 4], [4, 5, 6]])
        self.add(v.reshape(-1, 3), uv.reshape(-1, 2), (base[:, None, :] + tris[None]).reshape(-1, 3), mat)

    def build(self, name, mats):
        V = np.concatenate(self.v)
        UV = np.concatenate(self.uv)
        faces = [tuple(int(i) for i in f) for F in self.f for f in F]
        me = bpy.data.meshes.new(name)
        me.from_pydata(V.tolist(), [], faces)
        uvl = me.uv_layers.new(name="UVMap")
        li = np.zeros(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", li)
        uvl.data.foreach_set("uv", UV[li].astype(np.float32).ravel())
        me.polygons.foreach_set("material_index", np.concatenate(self.fm))
        me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
        for mn in self.mats:
            me.materials.append(mats[mn])
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- generators

def rot_about(v, axis, ang):
    axis = norm(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


def perp(d, rng):
    p = np.cross(d, rng.normal(size=3))
    return norm(p)


def grow(mb, rng, p, d, L, r, lvl, c, tips):
    """Recursive branching. c: per-level lists (see tree())."""
    n = max(3, int(L / c["seg"][lvl]))
    pts, dd = [np.asarray(p, float)], norm(d)
    for _ in range(n):
        dd = norm(dd + rng.normal(0, c["wob"][lvl], 3) + np.array([0, 0, c["up"][lvl]]))
        pts.append(pts[-1] + dd * L / n)
    pts = np.array(pts)
    t = np.linspace(0, 1, n + 1)
    rad = r * (1 - (1 - c["taper"][lvl]) * t)
    if lvl == 0 and c.get("flare"):
        rad = rad * (1 + c["flare"] * np.exp(-t * L / 0.9))
    mb.tube(pts, rad, c["sides"][lvl], c["bark"], tile=c.get("tile", 0.8))
    if lvl == c["levels"]:
        tips.append(pts)
        return
    k = c["kids"][lvl]
    for j in range(k):
        tt = 1.0 if j == 0 and lvl > 0 else rng.uniform(c["from"][lvl], 1.0)
        i = min(n, int(round(tt * n)))
        base_d = norm(pts[i] - pts[i - 1])
        ang = math.radians(rng.uniform(*c["ang"][lvl]))
        if lvl == 0:  # spread the main limbs evenly around the trunk
            ax = rot_about(perp(base_d, np.random.default_rng(1)), base_d, 2 * math.pi * (j + rng.uniform(-0.2, 0.2)) / k)
        else:
            ax = perp(base_d, rng)
        cd = rot_about(base_d, ax, ang)
        grow(mb, rng, pts[i], cd, L * c["len"][lvl] * rng.uniform(0.8, 1.2), max(rad[i] * c["rk"][lvl], 0.012), lvl + 1, c, tips)


def tree(name, seed, c, mats):
    rng = np.random.default_rng(seed)
    mb, tips = MB(), []
    grow(mb, rng, (0, 0, -0.3), (0, 0, 1), c["height"] * c["trunk"], c["radius"], 0, c, tips)
    P, D = [], []
    for pts in tips:
        m = c["leaves"]
        i = rng.integers(max(1, len(pts) // 3), len(pts), m)
        f = rng.random((m, 1))
        base = pts[i - 1] * (1 - f) + pts[i] * f
        tw = norm(pts[i] - pts[i - 1])
        d = norm(tw * 0.5 + rng.normal(0, 0.8, (m, 3)) + np.array([0, 0, c.get("leaf_up", 0.15)]))
        P.append(base + rng.normal(0, c["spread"], (m, 3)))
        D.append(d)
    P, D = np.concatenate(P), np.concatenate(D)
    n = len(P)
    U = norm(np.array([0, 0, 1.0]) + rng.normal(0, 0.5, (n, 3)))
    col = rng.choice(4, n, p=[0.4, 0.3, 0.24, 0.06])
    mb.leaves(P, D, U, c["leaf"][0] * rng.uniform(0.75, 1.25, n), c["leaf"][1] * rng.uniform(0.8, 1.2, n), col, c["leafmat"])
    return mb.build(name, mats)


def frond(mb, rng, base, az, elev, length, droop, pairs, pin_len, pin_w, mat, stem_mat, stem_r=0.012, col_p=(0.45, 0.3, 0.22, 0.03),
          vee=0.25, pin_droop=0.25):
    """Pinnate frond: an arching rachis with paired leaflets."""
    n = pairs
    t = np.linspace(0, 1, n + 1)
    e = elev - droop * t ** 1.6
    step = length / n
    h = np.array([math.cos(az), math.sin(az), 0.0])
    dirs = np.cos(e)[:, None] * h + np.sin(e)[:, None] * np.array([0, 0, 1.0])
    pts = np.asarray(base, float) + np.concatenate([[np.zeros(3)], np.cumsum(dirs[:-1] * step, 0)])
    mb.tube(pts, stem_r * (1 - 0.8 * t), 4, stem_mat, tile=0.4)
    side = np.array([-math.sin(az), math.cos(az), 0.0])
    up = np.cross(dirs, side)  # frond "upper face" normal
    prof = np.sin(np.pi * np.clip(t, 0.04, 1) ** 0.75) * 0.95 + 0.05
    skip = max(1, int(n * 0.12))
    for sgn in (-1, 1):
        i = np.arange(skip, n + 1)
        d = norm(sgn * side[None] * 1.0 + dirs[i] * 0.45 + up[i] * vee - np.array([0, 0, pin_droop]))
        col = rng.choice(4, len(i), p=col_p)
        mb.leaves(pts[i], d, up[i], pin_len * prof[i] * rng.uniform(0.9, 1.1, len(i)), pin_w * (0.6 + 0.4 * prof[i]), col, mat, cup=0.05)


def make_tussock(name, seed, mats, h=0.75, n=260, r=0.2):
    rng = np.random.default_rng(seed)
    mb = MB()
    a = rng.uniform(0, 2 * math.pi, n)
    rr = r * np.sqrt(rng.random(n))
    P = np.stack([rr * np.cos(a), rr * np.sin(a), np.full(n, -0.04)], -1)
    oa = a + rng.normal(0, 0.5, n)
    out = np.stack([np.cos(oa), np.sin(oa), np.zeros(n)], -1)
    lean = rr / r
    hh = h * rng.uniform(0.55, 1.1, n) * (1 - 0.25 * lean)
    reach = hh * (0.15 + 0.75 * lean * rng.random(n))
    col = rng.choice(4, n, p=[0.3, 0.3, 0.25, 0.15])
    mb.blades(P, out, hh, reach, rng.uniform(0.014, 0.024, n), col, "tussock")
    # a few dry flowering stalks standing above the tuft
    m = 7
    a = rng.uniform(0, 2 * math.pi, m)
    P = np.stack([0.05 * np.cos(a), 0.05 * np.sin(a), np.full(m, -0.02)], -1)
    out = np.stack([np.cos(a), np.sin(a), np.zeros(m)], -1)
    mb.blades(P, out, h * rng.uniform(1.25, 1.6, m), h * 0.18, 0.008, np.full(m, 3), "tussock")
    return mb.build(name, mats)


def make_protea(name, seed, mats):
    rng = np.random.default_rng(seed)
    mb, tips = MB(), []
    c = dict(levels=2, seg=[0.18, 0.15, 0.12], wob=[0.16, 0.2, 0.2], up=[0.12, 0.2, 0.3], taper=[0.6, 0.6, 0.5],
             sides=[6, 5, 4], bark="bark", kids=[3, 2], **{"from": [0.35, 0.4]}, ang=[(20, 45), (20, 45)],
             len=[0.6, 0.6], rk=[0.7, 0.7], tile=0.3)
    for s in range(5):
        az = 2 * math.pi * s / 5 + rng.uniform(-0.4, 0.4)
        d = norm([math.cos(az) * 0.55, math.sin(az) * 0.55, 1.0])
        grow(mb, rng, (0.05 * math.cos(az), 0.05 * math.sin(az), -0.1), d, rng.uniform(0.8, 1.1), 0.03, 0, c, tips)
    for k, pts in enumerate(tips):
        tip, tw = pts[-1], norm(pts[-1] - pts[-2])
        m = 26  # leathery leaves spiralling up the last part of each shoot
        f = rng.random(m) ** 0.7
        idx = np.clip((f * (len(pts) - 1)).astype(int), 1, len(pts) - 1)
        P = pts[idx - 1] + (pts[idx] - pts[idx - 1]) * rng.random((m, 1))
        a = np.arange(m) * 2.4 + rng.uniform(0, 6)
        s1 = perp(tw, rng)
        s2 = np.cross(tw, s1)
        D = norm(np.cos(a)[:, None] * s1 + np.sin(a)[:, None] * s2 + tw * rng.uniform(0.7, 1.3, (m, 1)))
        mb.leaves(P, D, np.tile(tw, (m, 1)), rng.uniform(0.10, 0.14, m), rng.uniform(0.032, 0.042, m),
                  rng.choice(4, m, p=[0.4, 0.3, 0.25, 0.05]), "protea_leaf", cup=0.2)
        if k % 3 == 0:  # flower head: a cup of bracts around a dome
            nb = 22
            a = np.arange(nb) * 2.4
            ring = (np.arange(nb) % 3)[:, None]
            D = norm(np.cos(a)[:, None] * s1 + np.sin(a)[:, None] * s2 + tw * (1.5 - 0.45 * ring))
            mb.leaves(np.tile(tip, (nb, 1)), D, np.tile(tw, (nb, 1)), 0.065 + 0.01 * ring[:, 0], 0.024,
                      rng.choice(4, nb), "protea_bract", cup=0.25)
            a = np.linspace(0, 2 * math.pi, 8, endpoint=False)
            D = norm(np.cos(a)[:, None] * s1 * 0.25 + np.sin(a)[:, None] * s2 * 0.25 + tw)
            mb.leaves(np.tile(tip, (8, 1)), D, np.tile(s1, (8, 1)), 0.05, 0.03, np.full(8, 3), "protea_bract", cup=0.3)
    return mb.build(name, mats)


def make_tree_fern(name, seed, mats, trunk_h=3.2):
    rng = np.random.default_rng(seed)
    mb = MB()
    n = 9
    t = np.linspace(0, 1, n)
    pts = np.stack([0.18 * np.sin(t * 2.1) * t, 0.12 * t ** 2, -0.3 + (trunk_h + 0.3) * t], -1)
    mb.tube(pts, 0.10 * (1 - 0.25 * t) + 0.05 * np.exp(-t * 8), 9, "fern_trunk", tile=0.35)
    top = pts[-1]
    nf = 16
    for k in range(nf):
        az = k * 2.4 + rng.uniform(-0.2, 0.2)
        old = k / nf
        frond(mb, rng, top, az, math.radians(62 - 55 * old), rng.uniform(1.9, 2.4), math.radians(55 + 45 * old), 30,
              0.36, 0.055, "fern_leaf", "fern_trunk", stem_r=0.014, col_p=(0.45, 0.3, 0.2, 0.05) if old < 0.8 else (0.1, 0.1, 0.1, 0.7))
    return mb.build(name, mats)


def make_ground_fern(name, seed, mats):
    rng = np.random.default_rng(seed)
    mb = MB()
    for k in range(10):
        az = k * 2.4 + rng.uniform(-0.3, 0.3)
        frond(mb, rng, (0, 0, -0.02), az, math.radians(rng.uniform(40, 70)), rng.uniform(0.6, 0.95), math.radians(rng.uniform(50, 80)),
              18, 0.14, 0.03, "fern_leaf", "fern_trunk", stem_r=0.005)
    return mb.build(name, mats)


def make_oil_palm(name, seed, mats, trunk_h=7.5):
    rng = np.random.default_rng(seed)
    mb = MB()
    n = 12
    t = np.linspace(0, 1, n)
    pts = np.stack([0.25 * t ** 2, 0.1 * np.sin(t * 3), -0.3 + (trunk_h + 0.3) * t], -1)
    mb.tube(pts, 0.21 + 0.07 * np.exp(-t * 6) + 0.015 * np.sin(t * 60), 12, "palm_trunk", tile=0.7)
    top = pts[-1]
    nf = 30
    for k in range(nf):
        az = k * 2.4 + rng.uniform(-0.15, 0.15)
        old = k / nf
        frond(mb, rng, top + np.array([0, 0, 0.25 * (1 - old)]), az, math.radians(78 - 85 * old), rng.uniform(3.8, 4.6),
              math.radians(50 + 40 * old), 64, 0.80, 0.075, "palm_leaf", "palm_trunk", stem_r=0.04,
              col_p=(0.45, 0.3, 0.22, 0.03) if old < 0.85 else (0.05, 0.05, 0.1, 0.8), vee=0.45, pin_droop=0.35)
    return mb.build(name, mats)


def make_rock(name, seed, mats, size=(1.3, 1.0, 0.8), rough=0.28, sub=4, sharp=0.5, sink=0.25):
    """Displaced icosphere, flattened under the ground line; UVs by cube projection (computed here)."""
    import bmesh
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector(rng.uniform(0, 100, 3).tolist())
    for v in bm.verts:
        p = v.co.copy()
        n1 = mnoise.noise(p * 0.9 + off)
        n2 = mnoise.noise(p * 2.3 + off * 1.7)
        n3 = mnoise.noise(p * 6.0 + off * 0.3)
        # stepped big noise gives flat faces and breaks, like jointed rock
        d = rough * (1.6 * (round(n1 * 3) / 3 * sharp + n1 * (1 - sharp)) + 0.5 * n2 + 0.14 * n3)
        v.co = p * (1 + d)
    sx, sy, sz = size
    for v in bm.verts:
        v.co.x *= sx * 0.5
        v.co.y *= sy * 0.5
        v.co.z = v.co.z * sz * 0.5 + sz * (0.5 - sink)
        if v.co.z < -0.15:
            v.co.z = -0.15
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        ia, ib = [(1, 2), (0, 2), (0, 1)][ax]
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co[ia] / 1.6, lp.vert.co[ib] / 1.6)
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mats["rock"])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def join(name, obs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    return ob


def make_outcrop(name, seed, mats):
    rng = np.random.default_rng(seed)
    obs = []
    for k in range(5):
        s = rng.uniform(1.4, 3.4)
        o = make_rock(f"{name}_{k}", seed * 10 + k, mats, size=(s, s * rng.uniform(0.6, 0.9), s * rng.uniform(0.5, 0.95)), sharp=0.8, rough=0.3)
        a = rng.uniform(0, 6.28)
        rr = 0 if k == 0 else rng.uniform(1.0, 2.4)
        o.location = (rr * math.cos(a), rr * math.sin(a), -0.1 * k)
        o.rotation_euler = (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 6.28))
        obs.append(o)
    ob = join(name, obs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def make_scree(name, seed, mats):
    rng = np.random.default_rng(seed)
    obs = []
    for k in range(14):
        s = rng.uniform(0.12, 0.42)
        o = make_rock(f"{name}_{k}", seed * 10 + k, mats, size=(s, s * rng.uniform(0.6, 1), s * rng.uniform(0.4, 0.7)), sub=2, sharp=0.9, rough=0.35, sink=0.3)
        a, rr = rng.uniform(0, 6.28), 1.1 * math.sqrt(rng.random())
        o.location = (rr * math.cos(a), rr * math.sin(a), 0)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    ob = join(name, obs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def make_log(name, seed, mats):
    rng = np.random.default_rng(seed)
    mb = MB()
    n = 14
    t = np.linspace(0, 1, n)
    L = 5.5
    pts = np.stack([(t - 0.5) * L, 0.12 * np.sin(t * 4), 0.2 + 0.05 * np.sin(t * 7)], -1)
    rad = 0.26 * (1 - 0.3 * t) * (1 + 0.06 * rng.normal(size=n))
    mb.tube(pts, rad, 12, "bark_moss", tile=0.8, cap=True)
    for k in range(3):  # broken branch stubs
        i = rng.integers(3, n - 2)
        d = norm([rng.normal(0, 0.3), rng.choice([-1, 1]), rng.uniform(0.3, 1)])
        bl = rng.uniform(0.4, 0.9)
        bp = pts[i] + d[None] * np.linspace(0, bl, 4)[:, None]
        mb.tube(bp, np.linspace(0.07, 0.04, 4), 6, "bark_moss", tile=0.5, cap=True)
    return mb.build(name, mats)


# ---------------------------------------------------------------- catalogue

PARINARI = dict(height=23.0, trunk=0.6, radius=0.42, levels=3, seg=[1.4, 0.9, 0.6, 0.4], wob=[0.035, 0.12, 0.16, 0.2],
                up=[0.05, 0.06, 0.03, 0.0], taper=[0.6, 0.45, 0.45, 0.3], sides=[12, 8, 6, 4], bark="bark_grey",
                kids=[7, 5, 4], **{"from": [0.62, 0.3, 0.25]}, ang=[(40, 70), (25, 50), (25, 55)],
                len=[0.55, 0.55, 0.55], rk=[0.42, 0.6, 0.6], flare=0.9, leaves=280, spread=0.35,
                leaf=(0.40, 0.19), leafmat="parinari_leaf", tile=1.1)
MONTANE = dict(height=8.5, trunk=0.5, radius=0.2, levels=3, seg=[0.6, 0.5, 0.4, 0.3], wob=[0.14, 0.2, 0.22, 0.25],
               up=[0.1, 0.0, -0.02, 0.0], taper=[0.6, 0.5, 0.45, 0.3], sides=[10, 7, 5, 4], bark="bark_moss",
               kids=[5, 4, 4], **{"from": [0.35, 0.3, 0.3]}, ang=[(50, 80), (30, 60), (25, 55)],
               len=[0.75, 0.6, 0.6], rk=[0.55, 0.6, 0.6], flare=0.6, leaves=190, spread=0.22,
               leaf=(0.30, 0.15), leafmat="montane_leaf", tile=0.7)

CATALOGUE = [
    # id, FR, EN, zone use, note
    ("grass_tussock_a", "Touffe d'herbe d'altitude (A)", "Montane grass tussock (A)", "Z1 grassland", "Generic tussock form; species not identified."),
    ("grass_tussock_b", "Touffe d'herbe d'altitude (B, basse)", "Montane grass tussock (B, low)", "Z1 grassland", "Generic tussock form; species not identified."),
    ("protea_shrub", "Arbuste de type Protea", "Protea-type shrub", "Z1 transition belt", "Generic Protea habit; the Nimba species, leaf and flower colour are to validate against herbarium/Commons references."),
    ("montane_tree", "Arbre de forêt de montagne (moussu)", "Montane forest tree (mossy)", "Z1 ravines, Z2", "Generic low, gnarled, mossy cloud-forest tree; not a named species."),
    ("parinari_tree", "Grand arbre de forêt de montagne (type Parinari excelsa)", "Tall montane forest tree (Parinari excelsa type)", "Z2", "Tall bole and umbrella crown only; bark, leaves and fruit are to validate against references."),
    ("tree_fern", "Fougère arborescente", "Tree fern", "Z2 wet valleys", "Generic African tree-fern form; species to validate."),
    ("ground_fern", "Fougère de sous-bois", "Forest-floor fern", "Z2, Z4", "Generic fern rosette."),
    ("oil_palm", "Palmier à huile (Elaeis guineensis)", "Oil palm (Elaeis guineensis)", "Z3 Bossou (not in the summit test area)", "No fruit bunches or old leaf bases yet."),
    ("rock_boulder_a", "Bloc rocheux (A)", "Boulder (A)", "all zones", "Shape generated; colour to match summit photos."),
    ("rock_boulder_b", "Bloc rocheux (B, plat)", "Boulder (B, slab)", "all zones", "Shape generated; colour to match summit photos."),
    ("rock_outcrop", "Affleurement rocheux", "Rock outcrop", "Z1 ridges", "Shape generated; the real ridges are iron-rich quartzite, colour to validate."),
    ("rock_scree", "Éboulis", "Scree patch", "Z1 steep slopes", "Shape generated."),
    ("fallen_log", "Tronc tombé, moussu", "Fallen log, mossy", "Z2, Z4", "Generic."),
]


def build_all(only=None):
    prep_textures()
    mats = {
        "bark": material("bark", "bark_diff.jpg", "bark_nor.jpg", 0.9),
        "bark_grey": material("bark_grey", "barkGrey_diff.jpg", "barkGrey_nor.jpg", 0.9),
        "bark_moss": material("bark_moss", "barkMoss_diff.jpg", "bark_nor.jpg", 0.95),
        "fern_trunk": material("fern_trunk", "fernTrunk_diff.jpg", "palm_nor.jpg", 1.0),
        "palm_trunk": material("palm_trunk", "palm_diff.jpg", "palm_nor.jpg", 0.95, tint=(0.55, 0.47, 0.40)),
        "rock": material("rock", "rock_diff.jpg", "rock_nor.jpg", 0.9, tint=(0.62, 0.56, 0.52)),
        "parinari_leaf": material("parinari_leaf", "leaf_parinari.png", None, 0.45, True),
        "montane_leaf": material("montane_leaf", "leaf_montane.png", None, 0.5, True),
        "protea_leaf": material("protea_leaf", "leaf_protea.png", None, 0.6, True),
        "protea_bract": material("protea_bract", "bract_protea.png", None, 0.6, True),
        "fern_leaf": material("fern_leaf", "leaf_fern.png", None, 0.55, True),
        "palm_leaf": material("palm_leaf", "leaf_palm.png", None, 0.4, True),
        "tussock": material("tussock", "blade_tussock.png", None, 0.7, True),
    }
    makers = {
        "grass_tussock_a": lambda n: make_tussock(n, 1, mats),
        "grass_tussock_b": lambda n: make_tussock(n, 2, mats, h=0.42, n=220, r=0.24),
        "protea_shrub": lambda n: make_protea(n, 5, mats),
        "montane_tree": lambda n: tree(n, 11, MONTANE, mats),
        "parinari_tree": lambda n: tree(n, 4, PARINARI, mats),
        "tree_fern": lambda n: make_tree_fern(n, 8, mats),
        "ground_fern": lambda n: make_ground_fern(n, 9, mats),
        "oil_palm": lambda n: make_oil_palm(n, 12, mats),
        "rock_boulder_a": lambda n: make_rock(n, 21, mats),
        "rock_boulder_b": lambda n: make_rock(n, 22, mats, size=(2.2, 1.6, 0.7), sharp=0.85),
        "rock_outcrop": lambda n: make_outcrop(n, 23, mats),
        "rock_scree": lambda n: make_scree(n, 24, mats),
        "fallen_log": lambda n: make_log(n, 25, mats),
    }
    out = {}
    for cid, *_ in CATALOGUE:
        if only and cid not in only:
            continue
        out[cid] = makers[cid](cid)
        me = out[cid].data
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        log(f"{cid}: {len(me.vertices)} verts, {tris} tris")
    return out


def bbox(ob):
    co = np.zeros(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return co.min(0), co.max(0)


def export(obs):
    KIT.mkdir(parents=True, exist_ok=True)
    info = []
    meta = {c[0]: c for c in CATALOGUE}
    for cid, ob in obs.items():
        for o in bpy.context.scene.objects:
            o.select_set(o is ob)
        bpy.context.view_layer.objects.active = ob
        path = KIT / f"{cid}.glb"
        bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format="GLB", export_yup=True,
                                  export_apply=True, export_image_format="JPEG", export_jpeg_quality=85)
        lo, hi = bbox(ob)
        _, fr, en, zone, note = meta[cid]
        info.append({
            "id": cid, "file": f"{cid}.glb", "name_fr": fr, "name_en": en, "use": zone,
            "size_m": [round(float(v), 2) for v in (hi - lo)], "height_m": round(float(hi[2]), 2),
            "triangles": int(sum(len(p.vertices) - 2 for p in ob.data.polygons)),
            "materials": [m.name for m in ob.data.materials],
            "status": "draft – to validate", "note": note,
        })
        log(f"exported {path.name} {path.stat().st_size / 1e6:.2f} MB")
    return info


# ---------------------------------------------------------------- review renders

def review_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = 720
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = -1.6
    w = bpy.data.worlds.new("review")
    sc.world = w
    nt = w.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(140)
    sky.sun_intensity = 0.6
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.16
    # neutral ground
    bpy.ops.mesh.primitive_plane_add(size=20000)
    g = bpy.context.active_object
    g.name = "review_ground"
    m = bpy.data.materials.new("review_ground")
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.20, 0.19, 0.17, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    g.data.materials.append(m)
    # 1.7 m scale figure: a plain post with a head-height band (not a person model)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=1.7, location=(0, 0, 0.85))
    post = bpy.context.active_object
    post.name = "scale_post"
    pm = bpy.data.materials.new("post")
    pm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.25, 0.08, 1)
    post.data.materials.append(pm)
    cd = bpy.data.cameras.new("cam")
    cd.lens = 55
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam, post


def render_reviews(obs, info):
    SHOTS.mkdir(parents=True, exist_ok=True)
    cam, post = review_scene()
    sc = bpy.context.scene
    for o in obs.values():
        o.hide_render = True
    for it in info:
        ob = obs[it["id"]]
        ob.hide_render = False
        lo, hi = bbox(ob)
        c = (lo + hi) / 2
        size = float(max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - max(lo[2], 0)))
        size = max(size, 1.9)  # always keep the 1.7 m post in frame
        post.location = (float(hi[0]) + 0.35 + size * 0.05, float(lo[1]), 0.85)
        dist = size * 1.9
        az, el = math.radians(35), math.radians(12 if size > 4 else 20)
        tgt = Vector((float(c[0]) + size * 0.06, float(c[1]), max(float(hi[2]), 1.7) * 0.5))
        cam.location = tgt + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.clip_end = 30000
        sc.render.filepath = str(SHOTS / f"{it['id']}.png")
        bpy.ops.render.render(write_still=True)
        ob.hide_render = True
        log("rendered", it["id"])
    contact_sheet(info)


def contact_sheet(info):
    from PIL import ImageDraw, ImageFont
    f1 = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", 24)
    f2 = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Regular.otf", 18)
    cols, cell, cap = 4, 560, 120
    rows = math.ceil(len(info) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * (cell + cap) + 70), (22, 33, 15))
    d = ImageDraw.Draw(sheet)
    d.text((24, 20), "Monts Nimba – kit d'assets Blender (brouillon à valider) · le poteau orange mesure 1,70 m", font=f1, fill=(240, 235, 220))
    for k, it in enumerate(info):
        x, y = (k % cols) * cell, 70 + (k // cols) * (cell + cap)
        im = Image.open(SHOTS / f"{it['id']}.png").convert("RGB").resize((cell, cell), Image.LANCZOS)
        sheet.paste(im, (x, y))
        d.text((x + 14, y + cell + 10), it["name_fr"][:44], font=f1, fill=(240, 235, 220))
        d.text((x + 14, y + cell + 44), it["name_en"], font=f2, fill=(200, 196, 180))
        d.text((x + 14, y + cell + 70), f"{it['height_m']:.1f} m · {it['triangles']:,} triangles · {it['use']}"[:60], font=f2, fill=(227, 176, 75))
    sheet.save(SHOTS / "kit_sheet.jpg", quality=88)
    for it in info:
        p = SHOTS / f"{it['id']}.png"
        Image.open(p).convert("RGB").save(p.with_suffix(".jpg"), quality=86)
        p.unlink()
    log("contact sheet →", SHOTS / "kit_sheet.jpg")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--blend", help="also save the scene")
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obs = build_all(a.only)
    info = export(obs)
    if not a.only:
        (KIT / "kit.json").write_text(json.dumps({
            "note": "Asset kit generated by scripts/blender/nimba_kit.py. Units: metres, Z up in Blender, glTF Y up. "
                    "Origin at ground level, centre of the plant. All shapes are drafts to validate (see each note).",
            "textures": "CC0 scans from Poly Haven (see public/walk/tex/credits.json) and textures generated by the script.",
            "assets": info}, indent=1, ensure_ascii=False) + "\n")
    if not a.no_render:
        render_reviews(obs, info)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(pathlib.Path(a.blend).resolve()))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
