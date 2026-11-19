"""Build Nimba understory growth forms in metres. Blender -b -P this_file."""
from pathlib import Path
from math import sin, cos, pi
from random import Random
import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
out = Path(__file__).resolve().parents[2]/'public/walk/models/forest-flora.glb'

class Plant:
    def __init__(self, seed):
        self.v, self.faces, self.uv, self.colors = [], [], [], []
        self.r = Random(seed)
    def point(self, p, uv, col):
        self.v.append(tuple(p)); self.uv.append(uv); self.colors.append((*col, 1))
        return len(self.v)-1
    def stalk(self, a, b, width):
        axis=(b-a).normalized(); side=axis.cross(Vector((0,1,0))).normalized()
        across=axis.cross(side); start=len(self.v)
        for p,size in ((a,width),(b,width*.67)):
            for j in range(6):
                ang=j*pi/3
                self.point(p+size*(cos(ang)*side+sin(ang)*across),(.04,.03),(.11,.17,.045))
        for j in range(6):
            k=(j+1)%6
            self.faces.append((start+j,start+k,start+6+k,start+6+j))
    def blade(self, start, az, length, width, rise, droop, palette, asym=False):
        front=Vector((cos(az),sin(az),0)); side=Vector((-sin(az),cos(az),0))
        rows,cols=(4,3) if length<.16 else (14,7); offset=len(self.v); roll=self.r.uniform(-.52,.52)
        light=self.r.uniform(.79,1.1)
        for j in range(rows+1):
            t=j/rows; envelope=max(.012,sin(pi*t)**(.67 if asym else .86))
            if asym: envelope*=1+.21*sin(t*pi*7)
            for i in range(cols):
                u=i/(cols-1)*2-1
                w=u*width*envelope*(1+.32*u if asym else 1)
                p=start+front*(t*length)+side*(w+.09*length*sin(t*pi)*sin(roll))
                p.z+=rise*t-droop*t*t+w*roll+.16*abs(w)-.07*width*cos(pi*t*12+abs(u)*2)*abs(u)
                c=tuple(k*light*(.82+.20*t) for k in palette)
                self.point(p,((u+1)*.5,t),c)
                if j and i:
                    ix=offset+j*cols+i; self.faces.append((ix-1,ix,ix-cols,ix-cols-1))
    def berry(self, center, size, color):
        start=len(self.v)
        for j in range(6):
            lat=pi*(j/5-.5)
            for i in range(8):
                a=2*pi*i/8
                self.point(center+size*Vector((cos(a)*cos(lat),sin(a)*cos(lat),sin(lat))),(.16,.11),color)
        for j in range(5):
            for i in range(8):
                k=start+j*8; nxt=(i+1)%8
                self.faces.append((k+i,k+nxt,k+8+nxt,k+8+i))
    def save(self,name):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(self.v,[],self.faces);mesh.update()
        uv=mesh.uv_layers.new()
        colors=mesh.color_attributes.new(name='COLOR_0',type='FLOAT_COLOR',domain='POINT')
        for i,c in enumerate(self.colors): colors.data[i].color=c
        for loop in mesh.loops: uv.data[loop.index].uv=self.uv[loop.vertex_index]
        for face in mesh.polygons: face.use_smooth=True
        ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob)

for variant in range(2):
    for index,kind in enumerate(['ginger','marantochloa','palisota','begonia']):
        p=Plant(574+variant*354+index*53); r=p.r
        for stem in range(3 if index<2 else 1):
            az=r.random()*2*pi
            root=Vector((cos(az)*.17,sin(az)*.17,-.035))
            leaves=[8,5,14,9][index]
            height=[1.67,1.14,.21,.55][index]*r.uniform(.85,1.13)
            tip=root+Vector((cos(az)*.24,sin(az)*.24,height))
            p.stalk(root,tip,.018 if index==0 else .014)
            for j in range(leaves):
                t=.2+.78*j/(leaves-1); a=az+j*([pi,.94*pi,2.39996,2.39996][index])+r.uniform(-.23,.23)
                origin=root.lerp(tip,t)
                petiole=[.06,.22,.07,.17][index]
                base=origin+Vector((cos(a)*petiole,sin(a)*petiole,petiole*.45))
                p.stalk(origin,base,.008)
                L=[.49,.55,.64,.27][index]*r.uniform(.76,1.16)*(1-.25*t)
                palette=[(.105,.245,.060),(.065,.22,.085),(.058,.183,.082),(.125,.218,.089)][index]
                p.blade(base,a,L,L*[.14,.32,.18,.48][index],L*(.45+t*.56),L*(.89-.52*t),palette,index==3)
        if variant==1 and kind=='palisota':
            a,b=Vector((0,0,.02)),Vector((.07,.07,.47))
            p.stalk(a,b,.009)
            for j in range(32):
                phase=j*2.39996
                center=b+Vector((.025*cos(phase),.025*sin(phase),.0036*j))
                p.berry(center,p.r.uniform(.008,.014),(.41,.020,.011))
        if variant==1 and kind=='begonia':
            tip=Vector((-.08,.08,.61))
            p.stalk(Vector((0,0,.24)),tip,.005)
            for j in range(5):
                phase=j*2.39996
                bud=tip+Vector((.09*cos(phase),.09*sin(phase),.05*sin(j)))
                p.stalk(tip,bud,.002)
                for i in range(4):
                    p.blade(bud,i*pi/2+phase,.019,.012,.009,.013,(.85,.66,.61))
                p.berry(bud,.005,(.85,.41,.035))
        p.save(kind+str(variant))
# Narrow, divided fronds spread from a compact fern growing on a trunk.
for variant in range(2):
    p=Plant(947+variant)
    for j in range(8):
        a=2.39996*j; length=p.r.uniform(.31,.59)
        axis=Vector((cos(a),sin(a),0))
        def stem(t):
            return axis*length*t+Vector((0,0,length*(1.03*t-.89*t*t)))
        for i in range(1,10):
            t=i/10; p.stalk(stem(t-.1),stem(t),.0028)
            for sign in (-1,1):
                L=length*(.055+.20*sin(pi*t))
                p.blade(stem(t),a+sign*(.87+.34*t),L,L*.15,L*.14,L*.32,(.08,.25,.085))
    p.save('asplenium'+str(variant))
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_attributes=True,export_animations=False)
