"""Render the actual Blender branch-animation timeline as PNG frames for a review video."""
import math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'scripts/blender/out'
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'generated_sapling.blend'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, 48
world = bpy.data.worlds.new('Soft forest fill')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.34, 0.40, 0.30, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
scene.world = world
bpy.ops.object.camera_add(location=(3.2, -4.5, 2.0))
camera = bpy.context.object
camera.rotation_euler = (Vector((0.1, 0, 1.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 52
scene.camera = camera
for name, position, power, size in [('Canopy opening', (1, -3, 5), 750, 4), ('Fill', (-3, 0, 3), 220, 3)]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.shape, light.size = power, 'DISK', size
    ob = bpy.data.objects.new(name, light)
    scene.collection.objects.link(ob)
    ob.location = position
    ob.rotation_euler = (Vector((0, 0, 1)) - ob.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.name = 'Review stage — not a measured habitat'
mat = bpy.data.materials.new('Quiet forest background')
mat.use_nodes = True
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.035, 0.055, 0.025, 1)
mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
floor.data.materials.append(mat)
scene.view_settings.view_transform = 'AgX'
(OUT / 'sapling_frames').mkdir(exist_ok=True)
scene.render.filepath = str(OUT / 'sapling_frames/frame_')
bpy.ops.render.render(animation=True)
