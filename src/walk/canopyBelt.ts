// Solid crown silhouettes between the individual walking trees and the satellite-scale forest.
// A fixed cell owns each crown so looking around never rotates the tree towards the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from './noise';
import type { WalkData } from './data';
import { walkMaterial } from './env';

function crownShape(seed: number) {
  const lobes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position, colors: number[] = [];
    const angle = k * 1.57 + seed, radius = k ? .22 : 0;
    const size = k ? .27 + hash2(seed,k,72)*.09 : .38;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const jitter = 1 + .18*Math.sin(x*9+y*11+z*14+seed);
      p.setXYZ(i, Math.cos(angle)*radius + size*x*jitter, (k ? .69 : .80) + size*y*.59, Math.sin(angle)*radius + size*z*jitter);
      const shade = (.77 + y*.23) * (k ? .97 : 1.08);
      colors.push(.82*shade,shade,.73*shade);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    g.computeVertexNormals();
    lobes.push(g);
  }
  const crown = mergeGeometries(lobes)!;
  lobes.forEach(g=>g.dispose());
  return crown;
}

export class CanopyBelt {
  readonly group = new THREE.Group();
  private tiles = new Map<string,THREE.InstancedMesh>();
  private forms = [crownShape(13),crownShape(27),crownShape(42)];
  private lastX = Infinity;
  private lastZ = Infinity;
  private mat: THREE.MeshStandardMaterial;
  constructor(private data: WalkData, texture: THREE.Texture) {
    this.mat = walkMaterial(new THREE.MeshStandardMaterial({
      map:texture, vertexColors:true, roughness:.96
    }), 'none', shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCrownWorld;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 origin=instanceMatrix[3].xyz;
          float d=length(origin.xz-cameraPosition.xz);
          transformed.y *= smoothstep(405.,635.,d) * (1.-smoothstep(1650.,1820.,d));
          vCrownWorld=(instanceMatrix*vec4(transformed,1.)).xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vCrownWorld;')
        .replace('#include <map_fragment>',`vec3 leaf=texture2D(map,(vCrownWorld.xz+.18*vCrownWorld.y)/102.).rgb;
          diffuseColor.rgb *= .038 + leaf*.89;`);
    });
  }
  update(eye: THREE.Vector3) {
    const width = 192, cx=Math.floor(eye.x/width), cz=Math.floor(eye.z/width);
    if(cx===this.lastX && cz===this.lastZ) return;
    this.lastX=cx; this.lastZ=cz;
    const wanted = new Set<string>();
    const dummy = new THREE.Object3D();
    for(let j=cz-10;j<=cz+10;j++) for(let i=cx-10;i<=cx+10;i++) {
      const d=Math.hypot(i-cx,j-cz);
      if(d>10.5 || d<1) continue;
      const key=i+','+j; wanted.add(key);
      if(this.tiles.has(key)) continue;
      const mesh=new THREE.InstancedMesh(this.forms[Math.floor(hash2(i,j,10)*3)],this.mat,144);
      let n=0;
      for(let v=0;v<12;v++) for(let u=0;u<12;u++) {
        const a=i*12+u,b=j*12+v;
        const x=(a+hash2(a,b,46))*16,z=(b+hash2(a,b,38))*16;
        const canopy=this.data.attrAt(x,z).canopy;
        if(canopy<5 || hash2(a,b,90)>Math.min(.98,canopy/15)) continue;
        const h=canopy*(.84+.45*hash2(a,b,51));
        dummy.position.set(x,this.data.baseHeight(x,z)-1.8,z);
        dummy.rotation.y=hash2(a,b,61)*6.283;
        const spread=Math.max(9,h*(.7+.47*hash2(a,b,30)));
        dummy.scale.set(spread,h,spread*.91);
        dummy.updateMatrix();
        mesh.setMatrixAt(n++,dummy.matrix);
      }
      mesh.count=n; mesh.computeBoundingSphere();
      this.tiles.set(key,mesh); if(n) this.group.add(mesh);
    }
    for(const [key,mesh] of this.tiles) if(!wanted.has(key)){
      this.group.remove(mesh); mesh.dispose(); this.tiles.delete(key);
    }
  }
  dispose(){
    for(const m of this.tiles.values()) m.dispose();
    this.forms.forEach(g=>g.dispose()); this.mat.dispose();
  }
}
