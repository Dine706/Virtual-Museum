import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from './noise';
import { walkMaterial } from './env';
import type { TreeInst } from './forest';

// Suspended stems connect real tree instances. Both ends stay on their host trees.
export class Lianas {
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(),walkMaterial(
    new THREE.MeshStandardMaterial({color:0x655742,roughness:.88})));
  private last = new THREE.Vector3(Infinity,0,0);
  constructor(){this.mesh.receiveShadow=true;this.mesh.castShadow=true;}
  update(eye:THREE.Vector3,trees:TreeInst[]){
    if(this.last.distanceToSquared(eye)<64)return;
    this.last.copy(eye);
    const reach=30;
    const candidates=trees.filter(t=>t.h>8 && Math.hypot(t.x-eye.x,t.z-eye.z)<reach+12);
    const parts:THREE.BufferGeometry[]=[];
    for(const tree of candidates){
      const seed=hash2(Math.floor(tree.x*4),Math.floor(tree.z*4),234);
      if(seed>.31 || Math.hypot(tree.x-eye.x,tree.z-eye.z)>reach)continue;
      let next:TreeInst|undefined, nearest=11;
      for(const b of candidates){
        const d=Math.hypot(b.x-tree.x,b.z-tree.z);
        if(b.x>tree.x && d>3.4 && d<nearest){nearest=d;next=b;}
      }
      if(!next)continue;
      const a=new THREE.Vector3(tree.x,tree.y+tree.h*(.31+seed*.4),tree.z);
      const b=new THREE.Vector3(next.x,next.y+next.h*.39,next.z);
      const mid=a.clone().lerp(b,.54);
      mid.y=Math.max(Math.min(a.y,b.y)-nearest*(.22+seed),Math.max(tree.y,next.y)+2.5);
      mid.z+=.44*Math.sin(seed*52);
      const curve=new THREE.CatmullRomCurve3([a,a.clone().lerp(mid,.5).add(new THREE.Vector3(.19,-.37,0)),mid,b]);
      parts.push(new THREE.TubeGeometry(curve,15,.022+seed*.047,5,false));
    }
    const old=this.mesh.geometry;
    this.mesh.geometry=parts.length?mergeGeometries(parts)!:new THREE.BufferGeometry();
    this.mesh.visible=parts.length>0;
    parts.forEach(p=>p.dispose()); old.dispose();
  }
}
