import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WalkData } from './data';
import type { TreeInst } from './forest';
import type { WalkControls } from './controls';
import { walkMaterial } from './env';
import { t } from '../i18n';
import type { Card } from './hud';

const names: Record<string,string> = {'chimpanzee':'Pan troglodytes verus','roundleaf-bat':'Hipposideros lamottei','otter-shrew':'Micropotamogale lamottei','nimba-toad':'Nimbaphrynoides occidentalis'};
export function facePoint(controls:WalkControls, eye:THREE.Vector3, target:THREE.Vector3){
  controls.yaw=Math.atan2(eye.x-target.x,eye.z-target.z);
  controls.pitch=Math.atan2(target.y-eye.y,Math.hypot(target.x-eye.x,target.z-eye.z));
}
type State='watching'|'running'|'climbing'|'aloft'|'hopping'|'diving'|'flying'|'resting';
export class Encounter {
  readonly group=new THREE.Group();
  state:State='watching';
  private anchor?:Pick<TreeInst,'x'|'y'|'z'|'h'>;
  companion?:Encounter;
  private timer=0;
  private end=new THREE.Vector3();
  private origin=new THREE.Vector3();
  private distance=0;
  private limbs:THREE.Object3D[]=[];
  constructor(readonly kind:string,private data:WalkData){}
  static supported(kind:string){return kind in names;}
  async enter(base:string,eye:THREE.Vector3,controls:WalkControls,trees:TreeInst[]){
    const asset=await new GLTFLoader().loadAsync(base+'walk/models/'+this.kind+'.glb');
    asset.scene.traverse(o=>{
      if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;o.material.side=THREE.DoubleSide;walkMaterial(o.material);}
      if(/^(arm|leg|wing)/.test(o.name))this.limbs.push(o);
    });
    this.group.add(asset.scene);
    const ape=this.kind==='chimpanzee', bat=this.kind==='roundleaf-bat', toad=this.kind==='nimba-toad';
    const radius=ape?4.4:bat?3.5:toad?.98:2.3;
    if(toad)this.group.scale.setScalar(.37);
    let best=-Infinity;
    for(let i=0;i<48;i++){
      const a=controls.yaw+i*2.4, x=eye.x-Math.sin(a)*radius,z=eye.z-Math.cos(a)*radius;
      const h=this.data.heightAt(x,z),stream=this.data.streamAt(x,z);
      let score=-Math.abs(h-(eye.y-1.65))*.8-Math.min(4,this.data.attrAt(x,z).canopy*.025);
      if(this.data.buildingAt(x,z,.7))score-=80;
      if(this.kind==='otter-shrew')score-=Math.min(20,Math.abs(stream.dist-stream.width))*.4;
      for(let k=1;k<9;k++){const u=k/9;if(this.data.heightAt(eye.x+(x-eye.x)*u,eye.z+(z-eye.z)*u)>eye.y+(h+.12-eye.y)*u)score-=12;}
      const anchor=ape?trees.filter(tr=>tr.h>5 && Math.hypot(tr.x-x,tr.z-z)>2).sort((p,q)=>Math.hypot(p.x-x,p.z-z)-Math.hypot(q.x-x,q.z-z))[0]:undefined;
      if(anchor)score-=Math.abs(Math.hypot(anchor.x-x,anchor.z-z)-6)*.22;
      if(score>best){best=score;this.anchor=anchor;this.group.position.set(x,h+(bat?1.85:.02),z);}
    }
    if(ape){
      if(!this.anchor || Math.hypot(this.anchor.x-this.group.position.x,this.anchor.z-this.group.position.z)>13){
        const {loadCrown}=await import('./crownModels');
        const tree=new THREE.Group(), height=10.5;
        for(const part of await loadCrown(base,'02'))tree.add(new THREE.Mesh(part.geometry,part.material));
        const away=this.group.position.clone().sub(eye);away.y=0;away.normalize();
        const x=this.group.position.x+away.x*6,z=this.group.position.z+away.z*6,y=this.data.heightAt(x,z);
        this.anchor={x,y,z,h:height};tree.position.set(x,y,z);tree.scale.setScalar(height);
        this.support=tree;
      }
      const other=new Encounter(this.kind,this.data);
      other.anchor=this.anchor;
      const copy=asset.scene.clone(true);other.group.add(copy);other.group.scale.setScalar(.75);
      copy.traverse(o=>{if(/^(arm|leg)/.test(o.name))other.limbs.push(o);});
      const x=this.group.position.x+1.45*Math.cos(controls.yaw),z=this.group.position.z-1.45*Math.sin(controls.yaw);
      other.group.position.set(x,this.data.heightAt(x,z)+.02,z);
      other.origin.copy(other.group.position);other.group.rotation.y=controls.yaw+.8;this.companion=other;
    }
    this.group.rotation.y=Math.atan2(eye.x-this.group.position.x,eye.z-this.group.position.z)+.3;
    this.origin.copy(this.group.position);
    facePoint(controls,eye,this.focus);
  }
  support?:THREE.Group;
  get focus(){return this.group.position.clone().add(new THREE.Vector3(0,this.kind==='chimpanzee'?.68:this.kind==='otter-shrew'?.07:.02,0));}
  card():Card{return {title:t('walk.animal.'+this.kind),sci:names[this.kind],kicker:t('walk.encounter'),lines:[],note:t('walk.animalNote'),sources:[]};}
  update(dt:number,eye:THREE.Vector3){
    this.companion?.update(dt,eye);
    if(!this.group.visible)return;
    const p=this.group.position,ape=this.kind==='chimpanzee',bat=this.kind==='roundleaf-bat',toad=this.kind==='nimba-toad';
    const planar=Math.hypot(p.x-eye.x,p.z-eye.z);
    this.timer+=dt;
    if((this.state==='watching'||(this.state==='resting' && this.timer>1.5)) && planar<(ape?3.15:bat?2.6:toad?.68:1.65)){
      this.origin.copy(p); this.timer=0;
      const away=new THREE.Vector3(p.x-eye.x,0,p.z-eye.z).normalize();
      this.end.copy(p).addScaledVector(away,ape?9:bat?7:toad?.52:3.4);
      if(ape && this.anchor)this.end.set(this.anchor.x+.20,this.anchor.y,this.anchor.z);
      if(this.kind==='otter-shrew'){
        let cost=Infinity;
        for(let i=0;i<16;i++){
          const a=i*Math.PI/8,x=p.x+3.4*Math.sin(a),z=p.z+3.4*Math.cos(a);
          const s=this.data.streamAt(x,z),c=s.dist-s.width+.6*Math.max(0,(eye.x-p.x)*(x-p.x)+(eye.z-p.z)*(z-p.z));
          if(c<cost){cost=c;this.end.set(x,this.data.heightAt(x,z),z);}
        }
      }
      this.distance=Math.max(.3,Math.hypot(this.end.x-p.x,this.end.z-p.z));
      this.group.rotation.y=Math.atan2(this.end.x-p.x,this.end.z-p.z);
      this.state=ape?'running':bat?'flying':toad?'hopping':'diving';
    }
    if(this.state==='climbing'){
      p.y=Math.min(this.origin.y+Math.min(6,(this.anchor?.h??6)*.67),p.y+dt*1.4);
      this.group.rotation.x=-.83;
      if(p.y>=this.origin.y+Math.min(6,(this.anchor?.h??6)*.67)-.01)this.state='aloft';
    }else if(['running','flying','hopping','diving'].includes(this.state)){
      const u=Math.min(1,this.timer*(ape?3.3:bat?3.1:toad?1.25:1.7)/this.distance);
      p.lerpVectors(this.origin,this.end,u);
      p.y=this.data.heightAt(p.x,p.z)+(bat?1.85+u*1.4:toad?.19*Math.sin(u*Math.PI):ape?.032*Math.abs(Math.sin(u*23)):.018);
      if(u>=1){this.state=ape&&this.anchor?'climbing':'resting';this.origin.copy(p);this.timer=0;}
    }else if(bat){p.y=this.origin.y+.12*Math.sin(this.timer*3.5);}
    for(const limb of this.limbs){
      const side=limb.name.includes('-')?-1:1;
      if(bat)limb.rotation.z=side*Math.sin(this.timer*18)*.65;
      else limb.rotation.x=(limb.name.startsWith('leg')?-1:1)*side*Math.sin(this.timer*9)*(this.state==='running'?.52:this.state==='climbing'?.68:.016);
    }
  }
}
