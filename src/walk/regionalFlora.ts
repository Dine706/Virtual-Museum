import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { trailK, type WalkData } from './data';
import { walkMaterial } from './env';
import { hash2, vnoise } from './noise';
import type { TreeInst } from './forest';
import type { Card } from './hud';
import { getLang } from '../i18n';

const species = {
  ginger: ['Aframomum chrysanthum','2758878','Ginger shoots carry narrow leaves in two ranks.','Les pousses de gingembre portent deux rangées de feuilles étroites.'],
  marantochloa: ['Marantochloa leucantha','2761169','Broad blades spread above long leaf stalks in the lowland shade.','De larges limbes se déploient sur de longs pétioles dans les sous-bois de basse altitude.'],
  palisota: ['Palisota barteri','2763803','Arching leaves form low rosettes beneath the canopy.','Des feuilles arquées forment des rosettes basses sous la canopée.'],
  begonia: ['Begonia quadrialata','7303227','Look for the lopsided bases and lobed outlines of the leaves.','Observez la base asymétrique et les contours lobés des feuilles.'],
  asplenium: ['Asplenium mannii','7417555','Divided fern fronds spread from pockets on montane trees.','Des frondes divisées se déploient sur les arbres de la forêt montagnarde.'],
} as const;
type Form = keyof typeof species;

export class RegionalFlora {
  readonly group = new THREE.Group();
  private batches = new Map<string, THREE.InstancedMesh>();
  private last = new THREE.Vector3(Infinity,0,0);
  private pose = new THREE.Object3D();
  private disposed = false;
  private ready = false;
  constructor(private data: WalkData, private radius: number) {}

  async load(base: string, anisotropy: number) {
    const textures = new THREE.TextureLoader();
    const [asset,map,normalMap] = await Promise.all([
      new GLTFLoader().loadAsync(base+'walk/models/forest-flora.glb'),
      textures.loadAsync(base+'walk/tex/forest-leaf.webp'),
      textures.loadAsync(base+'walk/tex/forest-leaf-normal.webp'),
    ]);
    map.colorSpace=THREE.SRGBColorSpace;
    map.anisotropy=normalMap.anisotropy=anisotropy;
    const mat=walkMaterial(new THREE.MeshStandardMaterial({
      map,normalMap,normalScale:new THREE.Vector2(.67,.67),roughness:.56,
      side:THREE.DoubleSide,vertexColors:true,
    }),'leaf');
    asset.scene.updateMatrixWorld();
    asset.scene.traverse(o=>{
      if(!(o instanceof THREE.Mesh)) return;
      o.material.dispose();
      if(this.disposed){o.geometry.dispose();return;}
      o.geometry.applyMatrix4(o.matrixWorld);
      o.geometry.computeBoundingBox();
      const mesh=new THREE.InstancedMesh(o.geometry,mat,900);
      mesh.name=o.name; mesh.count=0; mesh.frustumCulled=false;
      mesh.castShadow=this.radius>22; mesh.receiveShadow=true;
      this.batches.set(o.name,mesh); this.group.add(mesh);
    });
    if(this.disposed){mat.dispose();map.dispose();normalMap.dispose();return;}
    this.ready=true;
  }

  private plant(kind:Form, x:number,y:number,z:number, scale:number,seed:number) {
    const mesh=this.batches.get(kind+(seed>(kind==='begonia'||kind==='palisota'?.80:.50)?'1':'0'))!;
    if(mesh.count>=mesh.instanceMatrix.count) return;
    this.pose.position.set(x,y,z); this.pose.scale.setScalar(scale);
    this.pose.rotation.set(.08*Math.sin(seed*22),seed*71,.08*Math.cos(seed*37),'YXZ');
    this.pose.updateMatrix();
    mesh.setMatrixAt(mesh.count++,this.pose.matrix);
  }

  update(eye:THREE.Vector3,trees:TreeInst[]) {
    if(!this.ready || eye.distanceToSquared(this.last)<6.25) return;
    this.last.copy(eye);
    for(const mesh of this.batches.values()) mesh.count=0;
    const step=1.65, radius=this.radius;
    for(let j=Math.floor((eye.z-radius)/step);j<=Math.ceil((eye.z+radius)/step);j++){
      for(let i=Math.floor((eye.x-radius)/step);i<=Math.ceil((eye.x+radius)/step);i++){
        const x=(i+hash2(i,j,104))*step,z=(j+hash2(i,j,105))*step;
        const distance=Math.hypot(x-eye.x,z-eye.z);
        if(distance>radius || this.data.inWildlifeOpening(x,z)) continue;
        const a=this.data.attrAt(x,z);
        if(a.canopy<4 || a.cls===50 || a.cls===80 || this.data.areaAt(x,z)!==0 ||
          this.data.pathAt(x,z).dist<.6 || this.data.buildingAt(x,z,1) || trailK(x,z,1)>.3) continue;
        const stream=this.data.streamAt(x,z); if(stream.dist<stream.width+.15) continue;
        const clump=vnoise(x/6,z/6,812), cover=THREE.MathUtils.smoothstep(a.canopy,4,15);
        if(hash2(i,j,107)>(.56+.36*clump)*(.35+.65*cover)) continue;
        const h=this.data.heightAt(x,z);
        const patch=vnoise(x/9,z/9,709)+hash2(i,j,110)*.37;
        const kind=patch>.42?'ginger':patch<-.13?(h<850?'marantochloa':'begonia'):'palisota';
        const size=(.68+.64*hash2(i,j,115))*(1-THREE.MathUtils.smoothstep(distance,radius-5,radius));
        this.plant(kind,x,h-.025,z,size,hash2(i,j,116));
        // Young plants gather at the foot of mature clumps in pockets of shade.
        if(distance<18 && clump>.12 && a.canopy>10) {
          const offset=hash2(i,j,118)*6.28;
          const px=x+.48*Math.cos(offset), pz=z+.48*Math.sin(offset);
          this.plant(kind,px,this.data.heightAt(px,pz)-.015,pz,size*.48,hash2(i,j,119));
        }
      }
    }
    for(const t of trees){
      if(t.h<8 || Math.hypot(eye.x-t.x,eye.z-t.z)>radius || t.y<800) continue;
      const seed=hash2(Math.floor(t.x*3),Math.floor(t.z*3),320);
      if(seed>.48) continue;
      const angle=t.rot+seed*6, r=t.h*.023;
      this.plant('asplenium',t.x+r*Math.cos(angle),t.y+.35+seed*4,t.z+r*Math.sin(angle),.85+seed,hash2(Math.floor(t.x),Math.floor(t.z),321));
    }
    for(const m of this.batches.values()){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}
  }

  nearestLeaf(eye:THREE.Vector3) {
    const m=new THREE.Matrix4(), v=new THREE.Vector3();
    let best=Infinity, leaf:THREE.Vector3|null=null;
    for(const mesh of this.batches.values()){
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,m);
        v.setFromMatrixPosition(m);
        const d=v.distanceTo(eye);
        if(d<1 || d>best) continue;
        leaf=mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m);
        best=d;
      }
    }
    return leaf;
  }

  pick(ray:THREE.Raycaster, limit:number):Card|null {
    ray.far=Math.min(7,limit);
    let form=ray.intersectObjects(this.group.children,false)[0]?.object.name;
    // A leaf moves in the wind and much of a frond is open space. Let a tap between
    // nearby leaves identify the plant while respecting nearer terrain and tree hits.
    if(!form){
      const matrix=new THREE.Matrix4(), center=new THREE.Vector3(), hit=new THREE.Vector3();
      const sphere=new THREE.Sphere();
      let nearest=ray.far;
      for(const mesh of this.batches.values()){
        const box=mesh.geometry.boundingBox!;
        for(let i=0;i<mesh.count;i++){
          mesh.getMatrixAt(i,matrix);
          box.getCenter(center).applyMatrix4(matrix);
          if(center.distanceToSquared(ray.ray.origin)>64)continue;
          const scale=matrix.getMaxScaleOnAxis();
          sphere.center.copy(center);
          sphere.radius=Math.max(.10,Math.min(.60,(box.max.y-box.min.y)*.48)*scale);
          if(!ray.ray.intersectSphere(sphere,hit))continue;
          const d=hit.distanceTo(ray.ray.origin);
          if(d<nearest){nearest=d;form=mesh.name;}
        }
      }
    }
    ray.far=Infinity;
    if(!form)return null;
    const [name,id,en,fr]=species[form.slice(0,-1) as Form];
    return {kicker:getLang()==='fr'?'Flore du Nimba':'Nimba flora',title:name,
      lines:[getLang()==='fr'?fr:en],sources:[{label:'GBIF',url:'https://www.gbif.org/species/'+id}]};
  }
  get counts(){return Object.fromEntries([...this.batches].map(([id,m])=>[id,m.count]));}
  dispose(){this.disposed=true;for(const mesh of this.batches.values())mesh.dispose();}
}
