// Bands of iron-rich bedrock and tussock meadow across exposed upland slopes.
import * as THREE from 'three';
import { hash2,vnoise } from './noise';
import { walkMaterial } from './env';
import type { WalkData } from './data';

function tussocks(){
  const vertices:number[]=[],colors:number[]=[];
  for(let k=0;k<48;k++){
    const a=k*2.39996, r=.65*Math.sqrt(hash2(k,1,19)),h=.35+.60*hash2(k,2,13);
    const dx=Math.cos(a),dz=Math.sin(a),x=dx*r,z=dz*r,w=.034+hash2(k,3,12)*.032;
    vertices.push(x-w*dz,0,z+w*dx,x+w*dz,0,z-w*dx,x+dx*.19,h*.65,z+dz*.19,
      x+dx*.19,h*.65,z+dz*.19,x+w*dz,0,z-w*dx,x+dx*.39,h,z+dz*.39);
    for(let j=0;j<6;j++){const c=new THREE.Color(j===5?0xb3a169:j===2||j===3?0x928950:0x514d31);colors.push(c.r,c.g,c.b);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
export class RidgeMosaic {
  readonly group=new THREE.Group();
  private rock:THREE.InstancedMesh;
  private grass:THREE.InstancedMesh;
  private last=new THREE.Vector3(Infinity,0,0);
  constructor(private data:WalkData,base:string){
    const stone=new THREE.DodecahedronGeometry(1,1);
    const pos=stone.attributes.position;
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      pos.setXYZ(i,x+.16*Math.sin(z*5+y*4),y+.10*Math.sin(x*8+z*2),z);
    }
    stone.computeVertexNormals();
    const tex=new THREE.TextureLoader().load(base+'walk/tex/rock_diff.webp');tex.colorSpace=THREE.SRGBColorSpace;
    this.rock=new THREE.InstancedMesh(stone,walkMaterial(new THREE.MeshStandardMaterial({map:tex,roughness:.95})),6000);
    this.grass=new THREE.InstancedMesh(tussocks(),walkMaterial(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.88}),'grass'),20000);
    for(const m of [this.rock,this.grass]){m.count=0;m.receiveShadow=true;this.group.add(m);}
  }
  update(eye:THREE.Vector3){
    if(eye.distanceToSquared(this.last)<144)return;this.last.copy(eye);
    this.rock.count=0;this.grass.count=0;
    if(eye.y<940)return;
    const pose=new THREE.Object3D(), color=new THREE.Color(), cell=13,r=42;
    const cx=Math.floor(eye.x/cell),cz=Math.floor(eye.z/cell);
    for(let j=cz-r;j<=cz+r;j++)for(let i=cx-r;i<=cx+r;i++){
      const x=(i+hash2(i,j,85))*cell,z=(j+hash2(i,j,90))*cell;
      const d=Math.hypot(x-eye.x,z-eye.z);if(d>r*cell)continue;
      const h=this.data.baseHeight(x,z);if(h<1100)continue;
      const a=this.data.attrAt(x,z);if(a.canopy>5 || a.cls===50 || a.cls===80)continue;
      const seam=vnoise((x+z*.68)/25,(z-x*.68)/124,59);
      const seed=hash2(i,j,361);
      const fade=1-THREE.MathUtils.smoothstep(d,480,545);
      if((seam>.41||a.rock>.6)&&this.rock.count<6000){
        pose.position.set(x,this.data.heightAt(x,z)-.18,z);
        pose.scale.set(1.3+seed*3.8,(.38+seed*.95)*fade,.65+seed*1.7);
        pose.rotation.set(.15,-.68+.52*seed,-.2);pose.updateMatrix();
        this.rock.setMatrixAt(this.rock.count,pose.matrix);this.rock.setColorAt(this.rock.count++,color.setHSL(.071,.15,.66+.16*seed));
      }else if(seam<.34){
        for(let k=0;k<4;k++){
          if(this.grass.count>=20000)break;
          const xx=x+hash2(i*4+k,j,41)*4,zz=z+hash2(i,j*4+k,62)*4;
          pose.position.set(xx,this.data.heightAt(xx,zz)-.07,zz);
          pose.rotation.set(.1,seed*6+k,.06);pose.scale.set(1.5+seed*1.3,(.6+.6*seed)*fade,1.5+seed);pose.updateMatrix();this.grass.setMatrixAt(this.grass.count++,pose.matrix);
        }
      }
    }
    for(const m of [this.rock,this.grass]){m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();}
    if(this.rock.instanceColor)this.rock.instanceColor.needsUpdate=true;
  }
}
