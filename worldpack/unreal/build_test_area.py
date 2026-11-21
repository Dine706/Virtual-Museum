"""Unreal Editor script: builds the Nimba test area from the Blender kit.

STATUS: written in a cloud session that has no Unreal Engine. It has NOT been run. Expect to fix small API
differences on first run (the README next to this file says how, with Claude Code connected to the editor).

Run inside Unreal Editor 5.x (Python Editor Script Plugin enabled), Output Log, "Cmd" box set to Python:

    py "D:/path/to/Virtual-Museum/worldpack/unreal/build_test_area.py"

What it does:
  1. imports worldpack/kit/*.glb and worldpack/testarea/terrain.glb into /Game/Nimba
  2. creates the level /Game/Nimba/Maps/TestArea and places the terrain mesh at the origin
  3. works out the axis mapping between the files and Unreal by tracing the terrain at known check points
  4. spawns one instanced-mesh actor per kit asset with the transforms from placements.bin
  5. adds sun, sky atmosphere, sky light, height fog, volumetric clouds and a Player Start at the first viewpoint

Units: the files are in metres (x east, y north, z up); Unreal is in centimetres.
"""
import json
import math
import os
import struct

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
WORLDPACK = os.path.dirname(HERE)
KIT_DIR = os.path.join(WORLDPACK, "kit")
AREA_DIR = os.path.join(WORLDPACK, "testarea")
GAME = "/Game/Nimba"
MAP = GAME + "/Maps/TestArea"

# view distances (cm) after which instances are not drawn; grass is the expensive one
CULL_CM = {"grass_tussock_a": 9000, "grass_tussock_b": 9000, "ground_fern": 12000, "rock_scree": 15000}


def log(msg):
    unreal.log("[nimba] " + str(msg))


def import_glb(path, dest):
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = dest
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    meshes = []
    for p in task.get_editor_property("imported_object_paths"):
        a = unreal.load_asset(p)
        if isinstance(a, unreal.StaticMesh):
            meshes.append(a)
    if not meshes:  # some importers do not report paths: look in the folder
        for p in unreal.EditorAssetLibrary.list_assets(dest, recursive=True):
            a = unreal.load_asset(p)
            if isinstance(a, unreal.StaticMesh):
                meshes.append(a)
    if not meshes:
        raise RuntimeError("no static mesh imported from " + path)
    return meshes[0]


def spawn(cls, loc=(0, 0, 0), rot=(0, 0, 0), label=None):
    sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    a = sub.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(*rot))
    if label:
        a.set_actor_label(label)
    return a


# The eight ways the files' horizontal axes could land in Unreal (which depends on the glTF importer version).
MAPPINGS = [(sx, sy, swap) for swap in (False, True) for sx in (1, -1) for sy in (1, -1)]


def to_ue(x, y, z, m):
    sx, sy, swap = m
    a, b = (y, x) if swap else (x, y)
    return unreal.Vector(a * sx * 100.0, b * sy * 100.0, z * 100.0)


def trace_z(world, v):
    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(v.x, v.y, 100000.0), unreal.Vector(v.x, v.y, -100000.0),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [], unreal.DrawDebugTrace.NONE, True)
    if not hit:
        return None
    t = hit.to_tuple()
    for item in t:  # the hit location is the first Vector that is not the trace start
        if isinstance(item, unreal.Vector) and abs(item.z - 100000.0) > 1.0:
            return item.z
    return None


def calibrate(world, checks):
    best, best_err = MAPPINGS[1], None  # default: Unreal Y = -north (the usual Blender → Unreal result)
    for m in MAPPINGS:
        err, n = 0.0, 0
        for c in checks:
            z = trace_z(world, to_ue(c["x"] * 0.97, c["y"] * 0.97, 0, m))
            if z is not None:
                err += abs(z - c["z"] * 100.0)
                n += 1
        if n >= 4:
            err /= n
            log("mapping %s: mean height error %.0f cm over %d points" % (str(m), err, n))
            if best_err is None or err < best_err:
                best, best_err = m, err
    if best_err is None:
        unreal.log_warning("[nimba] could not trace the terrain; using the default axis mapping. Check that plants sit on the ground.")
    elif best_err > 300:
        unreal.log_warning("[nimba] best axis mapping is still %.0f cm off; check the terrain import scale." % best_err)
    return best


def add_instances(actor_label, mesh, recs, m, cull):
    """One actor with a HierarchicalInstancedStaticMeshComponent holding every instance of one asset."""
    actor = spawn(unreal.Actor, label=actor_label)
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    root = sds.k2_gather_subobject_data_for_instance(actor)[0]
    params = unreal.AddNewSubobjectParams()
    params.set_editor_property("parent_handle", root)
    params.set_editor_property("new_class", unreal.HierarchicalInstancedStaticMeshComponent)
    params.set_editor_property("blueprint_context", None)
    handle, fail = sds.add_new_subobject(params)
    comp = unreal.SubobjectDataBlueprintFunctionLibrary.get_object(sds.k2_find_subobject_data_from_handle(handle))
    comp.set_static_mesh(mesh)
    comp.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
    if cull:
        comp.set_cull_distances(int(cull * 0.8), int(cull))
    e0 = to_ue(1, 0, 0, m)
    a0 = math.atan2(e0.y, e0.x)  # where the files' +x axis points in Unreal
    xf = []
    for (x, y, z, yaw, s) in recs:
        d = to_ue(math.cos(yaw), math.sin(yaw), 0, m)
        deg = math.degrees(math.atan2(d.y, d.x) - a0)
        xf.append(unreal.Transform(to_ue(x, y, z, m), unreal.Rotator(0.0, 0.0, deg), unreal.Vector(s, s, s)))
    comp.add_instances(xf, False, True)
    return actor


def main():
    with open(os.path.join(AREA_DIR, "testarea.json"), encoding="utf-8") as f:
        area = json.load(f)
    with open(os.path.join(KIT_DIR, "kit.json"), encoding="utf-8") as f:
        kit = json.load(f)
    with open(os.path.join(AREA_DIR, "placements.bin"), "rb") as f:
        raw = f.read()
    floats = struct.unpack("<%df" % (len(raw) // 4), raw)

    # 1. import
    meshes = {}
    for a in kit["assets"]:
        meshes[a["id"]] = import_glb(os.path.join(KIT_DIR, a["file"]), GAME + "/Kit/" + a["id"])
        log("imported " + a["id"])
    terrain_mesh = import_glb(os.path.join(AREA_DIR, "terrain.glb"), GAME + "/TestArea/Terrain")

    # 2. level + terrain
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(MAP):
        les.load_level(MAP)
        sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        for a in sub.get_all_level_actors():
            if a.get_actor_label().startswith("Nimba_"):
                sub.destroy_actor(a)
    else:
        les.new_level(MAP)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    ta = spawn(unreal.StaticMeshActor, label="Nimba_Terrain")
    ta.static_mesh_component.set_static_mesh(terrain_mesh)
    # trace against the render triangles (the imported mesh has no simple collision)
    body = terrain_mesh.get_editor_property("body_setup")
    if body:
        body.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)

    # 3. axes
    m = calibrate(world, area["check_points"])
    log("axis mapping (sign x, sign y, swap) = " + str(m))

    # 4. plants and rocks
    for p in area["placements"]:
        o, n = p["offset_floats"], p["count"]
        recs = [floats[o + 5 * i:o + 5 * i + 5] for i in range(n)]
        add_instances("Nimba_" + p["asset"], meshes[p["asset"]], recs, m, CULL_CM.get(p["asset"], 0))
        log("%s: %d instances" % (p["asset"], n))

    # 5. light and atmosphere (sun from the same preset as the Blender stills)
    sun = area["sun"]
    north = to_ue(0, 1, 0, m)
    east = to_ue(1, 0, 0, m)
    az = math.radians(sun["azimuth_deg_from_north_clockwise"])
    dx = math.sin(az) * east.x + math.cos(az) * north.x
    dy = math.sin(az) * east.y + math.cos(az) * north.y
    yaw_to_sun = math.degrees(math.atan2(dy, dx))
    light = spawn(unreal.DirectionalLight, (0, 0, 30000), (0, 0, 0), "Nimba_Sun")
    light.set_actor_rotation(unreal.Rotator(0.0, -sun["elevation_deg"], yaw_to_sun + 180.0), False)
    light.light_component.set_editor_property("atmosphere_sun_light", True)
    light.light_component.set_intensity(8.0)
    spawn(unreal.SkyAtmosphere, label="Nimba_SkyAtmosphere")
    sky = spawn(unreal.SkyLight, label="Nimba_SkyLight")
    sky.light_component.set_editor_property("real_time_capture", True)
    fog = spawn(unreal.ExponentialHeightFog, (0, 0, 5000), label="Nimba_Fog")
    fog.component.set_editor_property("fog_density", 0.012)
    fog.component.set_editor_property("fog_height_falloff", 0.05)
    fog.component.set_editor_property("volumetric_fog", True)
    try:
        spawn(unreal.VolumetricCloud, label="Nimba_Clouds")
    except Exception as e:  # class name differs between versions
        unreal.log_warning("[nimba] volumetric clouds not added: %s" % e)

    v = area["viewpoints"][0]
    ps = spawn(unreal.PlayerStart, label="Nimba_PlayerStart")
    loc = to_ue(v["x"], v["y"], v["z"] + 0.5, m)
    fwd = to_ue(-math.sin(v["yaw"]), math.cos(v["yaw"]), 0, m)
    ps.set_actor_location_and_rotation(loc, unreal.Rotator(0.0, 0.0, math.degrees(math.atan2(fwd.y, fwd.x))), False, False)

    les.save_current_level()
    log("done: %s  (centre %s, base altitude %s m)" % (MAP, area["centre_lonlat"], area["base_alt_m"]))


main()
