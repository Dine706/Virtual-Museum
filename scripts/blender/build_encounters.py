"""Original articulated wildlife and seated courtyard figures in metres, facing +Z in game space."""
import bpy, math, random
from mathutils import Vector
from pathlib import Path
from math import sin,cos,pi
out=Path(__file__).resolve().parents[2]/'public/walk/models'
def xyz(p):return Vector((p[0],-p[2],p[1]))
def start():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 global mat, groups, parts, pivot, joint
 mat=bpy.data.materials.new('pigment');mat.use_nodes=True
 shader=mat.node_tree.nodes.get('Principled BSDF')
 attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='surface'
 mat.node_tree.links.new(attr.outputs['Color'],shader.inputs['Base Color'])
 shader.inputs['Roughness'].default_value=.76
 groups=[];parts=[];pivot=(0,0,0);joint='body'
def finish():
 global parts
 if not parts:return
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
 o=parts[0];bpy.context.scene.cursor.location=xyz(pivot)
 bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o.name=joint;groups.append(o);parts=[]
def limb(name,p):
 global joint,pivot
 finish();joint=name;pivot=p
def save(name):
 finish();bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',export_animations=False)
def color(o,c):
 rgb=[int(c[i:i+2],16)/255 for i in (0,2,4)]
 rgb=[x/12.92 if x<.04045 else ((x+.055)/1.055)**2.4 for x in rgb]
 a=o.data.color_attributes.new(name='surface',type='FLOAT_COLOR',domain='POINT')
 for v in o.data.vertices:
  k=1+.06*sin(v.co.x*9+v.co.z*14)*cos(v.co.y*8)
  a.data[v.index].color=(*[min(1,x*k) for x in rgb],1)
 o.data.materials.append(mat)
 for f in o.data.polygons:f.use_smooth=True
 parts.append(o)
def ball(p,sz,c):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=xyz(p));o=bpy.context.object
 o.scale=(sz[0],sz[2],sz[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);color(o,c);return o
def rod(a,b,r,c,w=1):
 d=xyz(b)-xyz(a);m=(xyz(a)+xyz(b))/2
 o=ball((m.x,m.z,-m.y),(r,d.length*.55,r*w),c)
 o.rotation_euler=Vector((0,0,1)).rotation_difference(d.normalized()).to_euler()
def eye(x,y,z,r):
 ball((x,y,z),(r,r*.83,r*.63),'372519');ball((x,y,z+r*.45),(r*.56,r*.62,r*.36),'11100e')
 ball((x-r*.16,y+r*.22,z+r*.71),(r*.15,r*.15,r*.10),'d5c0a3')
def panel(points,faces,c):
 m=bpy.data.meshes.new('membrane');m.from_pydata([xyz(p) for p in points],[],faces);m.update()
 o=bpy.data.objects.new('membrane',m);bpy.context.collection.objects.link(o);color(o,c)
fur='302a24';skin='75574a';warm='494035'
start()
ball((0,.61,-.08),(.24,.34,.36),fur);ball((0,.79,.11),(.31,.27,.24),warm)
ball((0,1.02,.23),(.177,.192,.171),fur);ball((0,.985,.36),(.126,.108,.116),skin)
ball((0,.947,.402),(.110,.054,.086),'866352');ball((0,1.015,.424),(.058,.031,.036),'493a31')
for s in [-1,1]:
 ball((s*.164,1.015,.245),(.044,.059,.026),skin);ball((s*.169,1.015,.267),(.027,.038,.01),'49392e')
 ball((s*.059,1.089,.361),(.063,.025,.045),fur);eye(s*.055,1.065,.376,.022)
 limb('arm'+str(s),(s*.215,.83,.12))
 rod((s*.215,.83,.12),(s*.31,.47,.26),.10,fur);rod((s*.31,.47,.26),(s*.29,.105,.36),.071,warm)
 ball((s*.29,.095,.37),(.075,.066,.103),skin)
 for i in range(4):rod((s*(.246+i*.025),.094,.39),(s*(.25+i*.025),.06,.433),.016,skin)
 limb('leg'+str(s),(s*.15,.56,-.24))
 rod((s*.15,.56,-.24),(s*.19,.31,-.12),.114,fur);rod((s*.19,.31,-.12),(s*.17,.075,-.29),.07,warm)
 ball((s*.17,.065,-.24),(.066,.044,.131),skin);limb('faceDetail'+str(s),(0,0,0))
save('chimpanzee')
start()
ball((0,.061,0),(.044,.047,.068),'88754b');ball((0,.08,.045),(.043,.033,.045),'9d8859')
for s in [-1,1]:
 eye(s*.031,.103,.063,.011)
 rod((s*.03,.066,.024),(s*.052,.018,.053),.009,'98805c')
 rod((s*.027,.047,-.023),(s*.058,.04,-.057),.017,'91764d')
 rod((s*.058,.04,-.057),(s*.041,.013,-.009),.009,'695b3a')
 for i in range(3):rod((s*.052,.014,.055),(s*(.041+i*.010),.008,.073),.002,'a68f67')
r=random.Random(8)
for i in range(23):
 x=r.uniform(-.028,.028);z=r.uniform(-.045,.027)
 ball((x,.061+.046*math.sqrt(max(.1,1-(x/.044)**2-(z/.068)**2)),z),(.0028,.0018,.0037),'514737')
save('nimba-toad')
start()
ball((0,.066,-.02),(.047,.054,.116),'564638');ball((0,.078,.071),(.039,.039,.062),'5c4c3d')
ball((0,.075,.122),(.016,.016,.031),'695544')
for s in [-1,1]:
 eye(s*.026,.092,.098,.005)
 for z in [-.058,.043]:rod((s*.027,.053,z),(s*.048,.016,z+.026),.011,'705d4e')
 for i in range(3):rod((s*.01,.078,.14),(s*.049,.076+i*.004,.128+i*.009),.0007,'aa9b88')
rod((0,.054,-.10),(.018,.034,-.24),.021,'4b4037',.64);rod((.018,.034,-.22),(.03,.028,-.34),.012,'514538',.55)
save('otter-shrew')
start()
ball((0,0,0),(.029,.03,.056),'72553c');ball((0,.014,.046),(.023,.022,.023),'866a50')
ball((0,.014,.068),(.011,.012,.006),'a28771')
for s in [-1,1]:
 ball((s*.019,.043,.042),(.009,.021,.008),'83614b');eye(s*.012,.023,.063,.003)
 limb('wing'+str(s),(s*.023,0,0))
 pts=[(s*x,y,z) for x,y,z in [(0,0,.028),(.078,.024,.055),(.165,.006,.026),(.119,-.004,-.006),(.101,-.003,-.038),(.078,-.008,-.027),(.055,-.004,-.054),(.035,-.007,-.04),(.012,0,-.063)]]
 panel(pts,[(0,1,8)]+[(1,i,i+1) for i in range(2,8)],'75554c')
 for i in (2,4,6,8):rod(pts[1],pts[i],.0019,'594537')
save('roundleaf-bat')
for variant in range(3):
 start();sk=['694733','845b41','583c2e'][variant];top=['637b8b','b97943','74734d'][variant];cloth=['313e4c','674453','424e4c'][variant]
 ball((0,.55,-.04),(.175,.135,.160),cloth);ball((0,.81,-.045),(.194,.264,.132),top)
 for s in [-1,1]:
  rod((s*.09,.54,-.03),(s*.118,.48,.30),.097,cloth);rod((s*.118,.49,.30),(s*.133,.105,.29),.068,cloth)
  ball((s*.133,.073,.327),(.069,.05,.126),'46382d')
  rod((s*.154,.967,-.04),(s*.208,.731,.04),.074,top);rod((s*.208,.731,.04),(s*.134,.59,.235),.048,sk)
  ball((s*.129,.595,.25),(.048,.035,.07),sk)
 ball((0,1.044,-.039),(.065,.088,.068),sk);ball((0,1.182,-.044),(.102,.137,.101),sk)
 ball((0,1.252,-.056),(.104,.082,.105),'29231e');ball((0,1.164,.055),(.027,.036,.026),sk)
 ball((0,1.127,.046),(.036,.01,.012),'634238')
 for s in [-1,1]:
  eye(s*.039,1.192,.041,.012);ball((s*.096,1.175,-.040),(.020,.029,.015),sk)
  rod((s*.021,1.213,.051),(s*.061,1.212,.040),.007,'392b22')
 if variant==1:
  ball((0,1.276,-.06),(.11,.077,.108),'a47d40');ball((.067,1.31,-.10),(.054,.051,.053),'b1884e')
 for i in range(4):
  rod((-.128,.69+i*.031,.059),(.127,.69+i*.031,.059),.003,'cab998')
 save('resident-'+str(variant))
