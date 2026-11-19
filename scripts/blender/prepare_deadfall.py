"""Place a scanned trunk on its side and normalise its length for terrain placement."""
import sys
import bpy
import numpy as np
from mathutils import Vector

source, target = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
parts = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
points = np.array([list(obj.matrix_world @ v.co) for obj in parts for v in obj.data.vertices])
centre = np.mean(points, axis=0)
_, axes = np.linalg.eigh(np.cov((points-centre).T))
basis = axes[:, [2, 1, 0]]
if np.linalg.det(basis) < 0:
    basis[:, 1] *= -1
local = (points-centre) @ basis
length = np.ptp(local[:, 0])
floor = np.percentile(local[:, 2], 4)
for obj in parts:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world.identity()
    for v in obj.data.vertices:
        p = (np.array(world @ v.co)-centre) @ basis
        p[2] -= floor
        v.co = Vector(p / length)
    obj.matrix_world = world.Identity(4)
bpy.ops.export_scene.gltf(filepath=target, export_format='GLB', export_animations=False)
