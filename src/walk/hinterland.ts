// Outer watersheds, from the same Copernicus DSM tile as the walkable massif.
// The regional mesh is recessed beneath the detailed DEM at their shared edge.
import * as THREE from 'three';
import { lonLatToXZ, WORLD, WORLD_W, WORLD_D } from '../data/geo';
import { shared, FOG_TAU_GLSL } from './env';

export async function loadHinterland(base: string, sunDir: THREE.Vector3) {
  const response = await fetch(base + 'landscape/region.u16');
  if (!response.ok) throw new Error('Regional elevation unavailable');
  const elevations = new Uint16Array(await response.arrayBuffer());
  const n = 520;
  if (elevations.length !== n * n) throw new Error('Incomplete regional elevation');
  const [west, north] = lonLatToXZ(-8.93, 7.99);
  const [east, south] = lonLatToXZ(-8.01, 7.12);
  const geometry = new THREE.PlaneGeometry((east-west)*(1-1/n), (south-north)*(1-1/n), n-1, n-1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((east+west)/2, 0, (north+south)/2);
  const pos = geometry.attributes.position;
  for (let i=0; i<pos.count; i++) pos.setY(i, elevations[i] - 3);
  geometry.computeVertexNormals();
  const satellite=await new THREE.TextureLoader().loadAsync(base+"landscape/outer-watersheds.webp");
  satellite.colorSpace=THREE.SRGBColorSpace; satellite.anisotropy=4;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...shared, satellite:{value:satellite}, region:{value:new THREE.Vector4(west,north,east-west,south-north)}, sunDir: { value: sunDir }, bounds: {value: new THREE.Vector4(WORLD.minX,WORLD.minZ,WORLD_W,WORLD_D)} },
    vertexShader: `varying vec3 p,n,v;
      void main(){p=position;n=normal;vec4 mv=modelViewMatrix*vec4(p,1.);v=mv.xyz;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 p,n,v; uniform vec3 sunDir,uFogColor,uSunColor,uSunView;
      uniform vec4 bounds,region; uniform sampler2D satellite; uniform float uFogDensity,uHaze;
      ${FOG_TAU_GLSL}
      void main(){
        vec2 uv=(p.xz-bounds.xy)/bounds.zw;
        if(all(greaterThan(uv,vec2(0.))) && all(lessThan(uv,vec2(1.))))discard;
        float direct=max(dot(normalize(n),sunDir),0.);
        vec3 col=mix(vec3(.033,.064,.043),vec3(.10,.12,.063),smoothstep(850.,1350.,p.y))*(.56+direct);
        vec2 groundUV=(p.xz-region.xy)/region.zw;
        vec4 survey=texture2D(satellite,vec2(groundUV.x,1.-groundUV.y));
        col=mix(col,survey.rgb*(1.2+.75*direct),survey.a*.92);
        float tau=walkTau(length(v),uFogDensity,uHaze);
        vec3 haze=mix(uFogColor,uSunColor*1.15,.55*pow(max(dot(normalize(v),uSunView),0.),6.));
        gl_FragColor=vec4(mix(col,haze,1.-exp(-tau)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  return new THREE.Mesh(geometry,material);
}
