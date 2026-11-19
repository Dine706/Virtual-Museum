import{$ as e,A as t,Dt as n,Et as r,R as i,T as a,Tt as o,Z as s,_n as c,at as l,fn as u,g as d,gn as f,lt as p,mt as m,nn as h,on as g,ot as _,p as v,vn as y,w as b,xn as x}from"./index-C8mt17qb.js";var S=new t,C=new c,w=class extends l{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new s([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new s([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new _(t,6,1);return this.setAttribute(`instanceStart`,new p(n,3,0)),this.setAttribute(`instanceEnd`,new p(n,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new _(t,6,1);return this.setAttribute(`instanceColorStart`,new p(n,3,0)),this.setAttribute(`instanceColorEnd`,new p(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new x(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new t);let e=this.attributes.instanceStart,n=this.attributes.instanceEnd;e!==void 0&&n!==void 0&&(this.boundingBox.setFromBufferAttribute(e),S.setFromBufferAttribute(n),this.boundingBox.union(S))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new g),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)C.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(C)),C.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(C));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}};a.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new f},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},b.line={uniforms:u.merge([a.common,a.fog,a.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {

			// compute the interpolation factor needed to trim the segment so it terminates
			// between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column

			// we need different nearEstimate formula for reversed and default depth buffer
			// a is positive with a reversed depth buffer so it can be used for controlling the code flow
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );

			return ( nearEstimate - start.z ) / ( end.z - start.z );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH

				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;

			#endif

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );

					#endif

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );

					#ifdef USE_DASH

						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );

					#endif

				}

			}

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;

			#endif

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = perspective ? normalize( mix( start.xyz, end.xyz, 0.5 ) ) : vec3( 0.0, 0.0, - 1.0 );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;

				// only shift the depth of vertices in front of the camera (#35137)
				if ( clip.w > 0.0 ) clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				float len;

				if ( isOrthographic ) {

					// View rays are parallel to the z axis so the distance reduces to camera-space XY
					vec2 lineDir = worldEnd.xy - worldStart.xy;
					float t = clamp( dot( worldPos.xy - worldStart.xy, lineDir ) / dot( lineDir, lineDir ), 0.0, 1.0 );
					len = length( worldStart.xy + lineDir * t - worldPos.xy );

				} else {

					// Find the closest points on the view ray and the line segment
					vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
					vec3 lineDir = worldEnd - worldStart;
					vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

					vec3 p1 = worldStart + lineDir * params.x;
					vec3 p2 = rayEnd * params.y;
					vec3 delta = p1 - p2;
					len = length( delta );

				}

				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};var T=class extends h{constructor(e){super({type:`LineMaterial`,uniforms:u.clone(b.line.uniforms),vertexShader:b.line.vertexShader,fragmentShader:b.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return`WORLD_UNITS`in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return`USE_DASH`in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return`USE_ALPHA_TO_COVERAGE`in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE=``:delete this.defines.USE_ALPHA_TO_COVERAGE)}},E=new y,D=new c,O=new c,k=new y,A=new y,j=new y,M=new c,N=new r,P=new m,F=new c,I=new t,L=new g,R=new y,z,B;function V(e,t,n){return R.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),R.multiplyScalar(1/R.w),R.x=B/n.width,R.y=B/n.height,R.applyMatrix4(e.projectionMatrixInverse),R.multiplyScalar(1/R.w),Math.abs(Math.max(R.x,R.y))}function H(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){P.start.fromBufferAttribute(i,r),P.end.fromBufferAttribute(a,r),P.applyMatrix4(n);let o=new c,s=new c;z.distanceSqToSegment(P.start,P.end,s,o),s.distanceTo(o)<B*.5&&t.push({point:s,pointOnLine:o,distance:z.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,uv1:null})}}function U(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,s=e.geometry,l=s.attributes.instanceStart,u=s.attributes.instanceEnd,d=Math.min(s.instanceCount,l.count),f=-t.near;z.at(1,j),j.w=1,j.applyMatrix4(t.matrixWorldInverse),j.applyMatrix4(r),j.multiplyScalar(1/j.w),j.x*=i.x/2,j.y*=i.y/2,j.z=0,M.copy(j),N.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,s=d;t<s;t++){if(k.fromBufferAttribute(l,t),A.fromBufferAttribute(u,t),k.w=1,A.w=1,k.applyMatrix4(N),A.applyMatrix4(N),k.z>f&&A.z>f)continue;if(k.z>f){let e=k.z-A.z,t=(k.z-f)/e;k.lerp(A,t)}else if(A.z>f){let e=A.z-k.z,t=(A.z-f)/e;A.lerp(k,t)}k.applyMatrix4(r),A.applyMatrix4(r),k.multiplyScalar(1/k.w),A.multiplyScalar(1/A.w),k.x*=i.x/2,k.y*=i.y/2,A.x*=i.x/2,A.y*=i.y/2,P.start.copy(k),P.start.z=0,P.end.copy(A),P.end.z=0;let s=P.closestPointToPointParameter(M,!0);P.at(s,F);let d=o.lerp(k.z,A.z,s),p=d>=-1&&d<=1,m=M.distanceTo(F)<B*.5;if(p&&m){P.start.fromBufferAttribute(l,t),P.end.fromBufferAttribute(u,t),P.start.applyMatrix4(a),P.end.applyMatrix4(a);let r=new c,i=new c;z.distanceSqToSegment(P.start,P.end,i,r),n.push({point:i,pointOnLine:r,distance:z.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,uv1:null})}}}var W=class extends n{constructor(e=new w,t=new T({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)D.fromBufferAttribute(t,e),O.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+D.distanceTo(O);let i=new _(r,2,1);return e.setAttribute(`instanceDistanceStart`,new p(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new p(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;if(r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`),n===!1&&(this.material.resolution.x===0||this.material.resolution.y===0))return;let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;z=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;B=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),L.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?B*.5:V(r,Math.max(r.near,L.distanceToPoint(z.origin)),s.resolution),L.radius+=c,z.intersectsSphere(L)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),I.copy(o.boundingBox).applyMatrix4(a);let l;l=n?B*.5:V(r,Math.max(r.near,I.distanceToPoint(z.origin)),s.resolution),I.expandByScalar(l),z.intersectsBox(I)!==!1&&(n?H(this,t):U(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(E),this.material.uniforms.resolution.value.set(E.z,E.w))}},G=class extends w{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setColors(n),this}setFromPoints(e){let t=e.length-1,n=new Float32Array(6*t);for(let r=0;r<t;r++)n[6*r]=e[r].x,n[6*r+1]=e[r].y,n[6*r+2]=e[r].z||0,n[6*r+3]=e[r+1].x,n[6*r+4]=e[r+1].y,n[6*r+5]=e[r+1].z||0;return super.setPositions(n),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},K=class extends W{constructor(e=new G,t=new T({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},q={nature:{borders:0},culture:{borders:.3},conservation:{borders:.4}},J=40,Y=25,X=2600,Z=class{hf;exag;group=new e;materials=new Map;baseWidth=new Map;opacity={borders:0};constructor(e,t,n){this.hf=t,this.exag=n;for(let t of e.borders)for(let e of this.clipToInner(t))this.add(`borders`,e,{color:`#FFFFFF`,width:1.6,closed:!1,dash:[260,170]});this.group.renderOrder=3}clipToInner(e){let t=(e,t)=>{let[n,r]=d(e,t);return n>v.minX+X&&n<v.maxX-X&&r>v.minZ+X&&r<v.maxZ-X},n=[],r=[];for(let i of e)t(i[0],i[1])?r.push(i):r.length&&(r.length>1&&n.push(r),r=[]);return r.length>1&&n.push(r),n}add(e,t,n){let r=[],a=t.map(([e,t])=>d(e,t));if(n.closed&&a.length){let[e,t]=[a[0],a[a.length-1]];(e[0]!==t[0]||e[1]!==t[1])&&a.push(e)}let o=(e,t)=>r.push(e,(this.hf.heightAt(e,t)+Y)*this.exag,t);for(let e=0;e<a.length-1;e++){let[t,n]=a[e],[r,i]=a[e+1],s=Math.max(1,Math.ceil(Math.hypot(r-t,i-n)/J));for(let e=0;e<s;e++)o(t+(r-t)*e/s,n+(i-n)*e/s)}let s=a[a.length-1];o(s[0],s[1]);let c=new G;c.setPositions(r);let l=new T({color:new i(n.color).getHex(),linewidth:n.width,transparent:!0,opacity:0,depthWrite:!1,dashed:!!n.dash,dashSize:n.dash?.[0]??1,gapSize:n.dash?.[1]??1,worldUnits:!1});l.toneMapped=!1,this.baseWidth.set(l,n.width);let u=new K(c,l);n.dash&&u.computeLineDistances(),u.visible=!1,u.renderOrder=3,this.group.add(u),this.materials.has(e)||this.materials.set(e,[]),this.materials.get(e).push(l)}get state(){return{...this.opacity}}async precompile(e,t,n){for(let e of this.group.children)e.visible=!0;if(e.extensions.has(`KHR_parallel_shader_compile`))try{await e.compileAsync(this.group,n,t)}catch{e.compile(t,n)}else e.compile(t,n);this.apply()}setResolution(e,t){let n=Math.min(e,t)<600?.65:1;for(let r of this.materials.values())for(let i of r)i.resolution.set(e,t),i.linewidth=(this.baseWidth.get(i)??2)*n}apply(){for(let[e,t]of this.materials){let n=this.opacity[e];for(let e of t)e.opacity=n}for(let e of this.group.children)e.visible=e.material.opacity>.005}setMode(e,t=250){let n={...this.opacity},r=q[e];if(t<=0)return this.opacity={...r},this.apply(),null;let i=performance.now();return(e,a)=>{let o=Math.min(1,Math.max(0,(a-i)/t)),s=o*o*(3-2*o);for(let e of Object.keys(r))this.opacity[e]=n[e]+(r[e]-n[e])*s;return this.apply(),o<1}}};export{Z as Overlays};