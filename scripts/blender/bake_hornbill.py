"""Bake one wing hinge cycle at 24 fps for the lightweight runtime bird rig."""
import bpy
import json
from pathlib import Path

hinge = bpy.data.objects.new("Hornbill wing hinge", None)
bpy.context.collection.objects.link(hinge)
for frame, angle in [(0, .12), (3, .9), (6, -.78), (10, .8), (13, -.7),
                     (17, .65), (20, -.55), (24, .26), (36, .18), (52, .08), (64, .12)]:
    hinge.rotation_euler.z = angle
    hinge.keyframe_insert(data_path="rotation_euler", index=2, frame=frame)
samples = []
for frame in range(64):
    bpy.context.scene.frame_set(frame)
    samples.append(round(hinge.rotation_euler.z, 5))
path = Path(__file__).resolve().parents[2] / 'src/walk/hornbill-flight.json'
path.write_text(json.dumps(samples) + '\n')
