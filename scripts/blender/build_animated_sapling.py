"""Build a generic reconstructed sapling with generated textures and a looping branch animation.

Run: /workspace/.tools/nimba-blender/bin/python scripts/blender/build_animated_sapling.py
The plant is a generic filler, not an identified Nimba species. Blender 5.3 exports a real glTF animation.
"""
import json
import math
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'public/walk/art'
OUT = ROOT / 'scripts/blender/out'


def material(name, image, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value = 0.72 if alpha else 0.92
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(str(ART / image))
    m.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
    if alpha:
        m.node_tree.links.new(t.outputs['Alpha'], p.inputs['Alpha'])
        m.blend_method = 'CLIP'
        m.alpha_threshold = 0.45
    return m


def stick(name, a, b, radius, mat, parent):
    from mathutils import Vector
    v = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=radius, radius2=radius * 0.35,
                                    depth=v.length, location=(Vector(a) + Vector(b)) / 2)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = v.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(mat)
    ob.parent = parent
    for f in ob.data.polygons:
        f.use_smooth = True
    return ob


def leaf_card(name, parent, position, angle, mat):
    mesh = bpy.data.meshes.new(name)
    # Small spray of seven leaves, at plausible understorey scale (each leaf a few centimetres).
    mesh.from_pydata([(-0.17, 0, 0), (0.17, 0, 0), (0.17, 0, 0.40), (-0.17, 0, 0.40)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for d, co in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        d.uv = co
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    ob.location = position
    ob.rotation_euler = (math.radians(28), 0, angle)
    mesh.materials.append(mat)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'Forest breeze'
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, 49
    bark = material('Reconstructed bark', 'bark.webp')
    leaves = material('Reconstructed foliage', 'foliage.webp', True)
    root = bpy.data.objects.new('Generic reconstructed sapling', None)
    bpy.context.collection.objects.link(root)
    root['provenance'] = 'Tech Guinée — digital reconstruction; generic filler, not a species identification'
    stick('Trunk', (0, 0, 0), (0.035, 0, 2.4), 0.028, bark, root)
    for i in range(5):
        angle = i * 2.399963
        dx, dy = math.cos(angle), math.sin(angle)
        stick(f'Root flare {i}', (0, 0, 0.10), (dx*0.09, dy*0.09, 0.025), 0.023, bark, root)
        stick(f'Root tip {i}', (dx*0.09, dy*0.09, 0.025), (dx*0.22, dy*0.22, -0.008), 0.011, bark, root)
    for i in range(9):
        angle = i * 2.399963
        pivot = bpy.data.objects.new(f'Branch pivot {i:02}', None)
        bpy.context.collection.objects.link(pivot)
        pivot.parent = root
        pivot.location = (0, 0, 0.65 + i * 0.17)
        pivot.rotation_euler[2] = angle
        length = 0.52 - i * 0.025
        stick(f'Twig {i:02}', (0, 0, 0), (length, 0, 0.22), 0.009, bark, pivot)
        for j in range(3):
            leaf_card(f'Leaf spray {i:02} {j}', pivot, (length * (0.45 + 0.22 * j), 0, 0.10 + j * 0.06),
                      (-0.65 if j % 2 else 0.65), leaves)
        for frame in [1, 13, 25, 37, 49]:
            phase = (frame - 1) / 48 * math.tau + i * 0.48
            pivot.rotation_euler[0] = math.sin(phase) * 0.045
            pivot.rotation_euler[1] = math.cos(phase) * 0.025
            pivot.keyframe_insert(data_path='rotation_euler', frame=frame)
    OUT.mkdir(parents=True, exist_ok=True)
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'generated_sapling.blend'))
    target = ROOT / 'public/walk/models/generated_sapling.glb'
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animations=True,
                              export_animation_mode='SCENE', export_anim_scene_split_object=False,
                              export_force_sampling=True, export_frame_range=True, export_yup=True)
    blob = target.read_bytes()
    size = int.from_bytes(blob[12:16], 'little')
    gltf = json.loads(blob[20:20 + size])
    assert gltf.get('animations'), 'Export must contain a real animation clip'
    channels = sum(len(a['channels']) for a in gltf['animations'])
    assert channels >= 9, 'Each branch should animate'
    print(json.dumps({'blender': bpy.app.version_string, 'file': str(target), 'animations': len(gltf['animations']),
                      'channels': channels, 'bytes': len(blob)}, indent=2))


if __name__ == '__main__':
    main()
