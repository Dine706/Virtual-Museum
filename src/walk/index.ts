// Walk mode: a first-person, ground-level view of the massif at any point of the 3D window.
// Lazy-loaded from main.ts; shares the app's WebGL renderer while the orbit view is suspended.
//
// Rendering: two passes with separate depth ranges (no z-fighting at ground level, 30 km views from the
// summit): far = sky, whole massif (DSM), outer clouds; near = ground patch, forest, cover, water, animals.
import * as THREE from 'three';
import { t, fmtMeters } from '../i18n';
import type { Content } from '../data/content';
import type { Heightfield } from '../scene/heightfield';
import type { Tier } from '../scene/tier';
import { AREA, WalkData } from './data';
import { WalkEnv, WALK_TIMES, shared, walkMaterial, type WalkTime } from './env';
import { Ground } from './ground';
import { Forest } from './forest';
import { GroundCover } from './groundcover';
import { Water } from './water';
import { Fauna, type Agent } from './fauna';
import { WalkControls } from './controls';
import { Hud, type Card } from './hud';
import { makeCards, type Hit } from './cards';
import { biomeAt, habitatOf, fogFor, type HabitatId } from './biome';
import { groundTextures } from './textures';
import { PostFX } from './post';
import { loadPhotos } from './photo';
import { loadModels } from './models';
import { Village } from './village';

export interface WalkContext {
  renderer: THREE.WebGLRenderer;
  hf: Heightfield;
  lcTex: THREE.Texture;
  content: Content;
  base: string;
  tier: Tier;
  start: { x: number; z: number; yaw?: number };
  reducedMotion: boolean;
  onExit: () => void;
  onPosition?: (x: number, z: number) => void;
}

export interface WalkHandle { exit(): void; debug: Record<string, unknown> }

const TIER_OPTS = {
  high: { seg: 320, R: 1500, shell: [380, 560], range: 420, near: 55, variants: 3, imp: 256, shadows: 2048, cover: 80, spacing: 0.55, rock: 160, birds: 8, flies: 14, dpr: 1.5, tex: 512 },
  mid: { seg: 224, R: 1300, shell: [240, 360], range: 260, near: 32, variants: 2, imp: 128, shadows: 1024, cover: 56, spacing: 0.75, rock: 110, birds: 6, flies: 10, dpr: 1.25, tex: 256 },
  low: { seg: 160, R: 1000, shell: [150, 240], range: 170, near: 20, variants: 2, imp: 128, shadows: 0, cover: 34, spacing: 1.0, rock: 70, birds: 4, flies: 6, dpr: 1, tex: 256 },
} as const;

const EYE = 1.65;

export async function enterWalk(ctx: WalkContext): Promise<WalkHandle> {
  const { renderer } = ctx;
  const O = TIER_OPTS[ctx.tier];
  const coarse = matchMedia('(pointer: coarse)').matches;
  const hud = new Hud(coarse);
  hud.veilOn();
  document.body.classList.add('walking');

  // ---- renderer state (restored on exit) ----
  const saved = {
    autoClear: renderer.autoClear, shadow: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type,
    exposure: renderer.toneMappingExposure, dpr: renderer.getPixelRatio(),
  };

  const data = new WalkData(ctx.base);
  await data.init();
  await Promise.all([data.loadWindow(ctx.start.x, ctx.start.z), data.loadPlaces()]);
  await data.loadOsm(ctx.start.x, ctx.start.z);
  data.updateStreams(ctx.start.x, ctx.start.z);
  data.updatePaths(ctx.start.x, ctx.start.z);
  await nextFrame();

  // ---- scene ----
  const params = new URLSearchParams(location.search);
  const time0 = (WALK_TIMES as string[]).includes(params.get('walktime') ?? '') ? params.get('walktime') as WalkTime : 'morning';
  // High-quality look: scanned textures, sky light, AO, bloom, light shafts, sharpening (high tier; ?fx=1/0 forces).
  const fxParam = params.get('fx');
  const fx = fxParam === '1' || (fxParam !== '0' && ctx.tier === 'high');
  const env = new WalkEnv(time0, fx ? Math.max(O.shadows, 4096) : O.shadows);
  const ground = new Ground(data, ctx.hf, ctx.lcTex, { segments: O.seg, radius: O.R, shellStart: O.shell[0], shellEnd: O.shell[1], shadows: O.shadows > 0 }, env.sunDir, { hemiSky: env.hemi.color, hemiGround: env.hemi.groundColor, sun: env.sun.color });
  hud.setVeilText(`${t('walk.loading')} 30 %`);
  await nextFrame();
  const forest = new Forest(data, { range: O.range, near: O.near, variants: O.variants, impostorRes: O.imp, shadows: O.shadows > 0 });
  forest.init(renderer);
  hud.setVeilText(`${t('walk.loading')} 60 %`);
  await nextFrame();
  const cover = new GroundCover(data, { radius: O.cover, spacing: O.spacing, shadows: O.shadows > 0, rockRadius: O.rock, texSize: O.tex, msaa: !!renderer.getContext().getContextAttributes()?.antialias });
  const water = new Water(data, env.hemi.color);
  const fauna = new Fauna(data, { birds: O.birds, butterflies: O.flies });
  const village = new Village(data, ctx.tier === 'high' ? 26 : ctx.tier === 'mid' ? 16 : 8);

  const far = new THREE.Scene();
  far.add(env.sky, ground.far);
  const near = new THREE.Scene();
  near.add(ground.mesh, forest.group, cover.group, water.mesh, fauna.group, village.group, ground.cloudNear, env.hemi, env.sun, env.sun.target);
  const farCam = new THREE.PerspectiveCamera(62, 1, 30, 60000);
  const cam = new THREE.PerspectiveCamera(62, 1, 0.1, Math.max(2600, O.R * 1.8));

  let exited = false;
  let post: PostFX | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  if (fx) {
    post = new PostFX(renderer, cam, near);
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    loadPhotos(ctx.base, aniso).then((p) => {
      if (exited) return;
      ground.usePhotos(p, aniso); forest.usePhotos(p); cover.usePhotos(p);
    }).catch((e) => console.warn('walk: scanned textures unavailable', e));
    loadModels(ctx.base, aniso, { single_root: 'root' }).then((m) => {
      if (exited) return;
      cover.useModels(m); forest.useModels(m);
    }).catch((e) => console.warn('walk: scanned models unavailable', e));
  }
  renderer.shadowMap.enabled = O.shadows > 0 || fx;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  const resize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, O.dpr * dprScale));
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    for (const c of [cam, farCam]) {
      c.aspect = w / h;
      c.fov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(36)) / (w / h)) * 180 / Math.PI, 55, 75);
      c.updateProjectionMatrix();
    }
  };
  let dprScale = 1;
  resize();
  window.addEventListener('resize', resize);

  // ---- walker ----
  const pos = new THREE.Vector3(ctx.start.x, 0, ctx.start.z);
  // Start next to the nearest open spot (not inside a trunk or a stream).
  pos.y = data.heightAt(pos.x, pos.z);
  const controls = new WalkControls(hud.root, coarse);
  controls.yaw = ctx.start.yaw ?? 0;
  controls.pitch = -0.05;
  let eyeY = pos.y + EYE;

  // Bossou: an illustrative nut-cracking site near the zone centre, next to an oil palm.
  const bossou = data.index.zones.find((z) => z.id === 'z3-bossou');
  const rockMat = walkMaterial(new THREE.MeshStandardMaterial({ map: groundTextures(O.tex).maps[3], roughness: 0.9 }));
  if (bossou) {
    const sx = bossou.cx + 140, sz = bossou.cz - 60;
    fauna.buildSite(new THREE.Vector3(sx, data.heightAt(sx, sz), sz), rockMat);
  }

  hud.setVeilText(`${t('walk.loading')} 80 %`);
  // Warm up: generate the nearest cells / tiles before revealing.
  const eye = new THREE.Vector3(pos.x, eyeY, pos.z);
  for (let k = 0; k < 8; k++) { forest.update(eye, 200); await nextFrame(); }
  // Start in the most open spot within ~14 m (not inside a bush or against a trunk).
  {
    let bestScore = Infinity, bx = pos.x, bz = pos.z;
    for (let k = 0; k < 48; k++) {
      const a = k * 2.39996, d = Math.sqrt(k / 48) * 22;
      const cx = ctx.start.x + Math.cos(a) * d, cz = ctx.start.z + Math.sin(a) * d;
      const st = data.streamAt(cx, cz);
      let score = st.dist < st.width * 1.5 ? 50 : 0;
      if (data.buildingAt(cx, cz, 1.5)) score += 100;
      for (const tr of forest.nearTrees) {
        const dd = Math.hypot(tr.x - cx, tr.z - cz);
        const reach = Math.max(1.2, tr.h * tr.crown * (tr.h < 6 ? 0.45 : 0.06));
        if (dd < reach + 1.2) score += 1 + (reach + 1.2 - dd);
      }
      score += d * 0.02;
      if (score < bestScore) { bestScore = score; bx = cx; bz = cz; }
    }
    pos.set(bx, data.heightAt(bx, bz), bz);
    eyeY = pos.y + EYE;
    eye.set(pos.x, eyeY, pos.z);
  }
  cover.update(eye);
  water.update(eye);
  fauna.viewYaw = controls.yaw;
  fauna.populate(eye);
  ground.update(eye);
  applyTime();

  // ---- loop ----
  let running = true, last = performance.now(), idleSince = performance.now();
  let lastFauna = eye.clone();
  let windowLoading = false;
  let relocating = false;
  let habitat: HabitatId = 'lowlandForest';
  let air: HabitatId = habitat; // habitat that sets fog and canopy light (open mapped ground clears the air)
  const fogTint = new THREE.Color();
  let fpsT = 0, fpsN = 0, fpsChecks = 0;

  controls.onActivity = () => { idleSince = performance.now(); };
  controls.onInspect = (x, y) => inspect(x, y);
  hud.onExit = () => exit();
  hud.onTime = () => {
    const i = (WALK_TIMES.indexOf(env.time) + 1) % WALK_TIMES.length;
    env.setTime(WALK_TIMES[i]);
    applyTime();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (hud.cardOpen) hud.hideCard(); else if (!controls.locked) exit(); }
  };
  window.addEventListener('keydown', onKey);
  const onVis = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', onVis);

  function applyTime() {
    if (fx) {
      envRT = env.envMap(renderer, envRT);
      near.environment = envRT.texture;
      near.environmentIntensity = env.time === 'mist' ? 0.3 : 0.22;
    }
    hud.setTime(t(`walk.time.${env.time}`));
    renderer.toneMappingExposure = env.exposure;
    ground.setClouds(env.time === 'mist' ? 1300 : 1220, env.time === 'mist' ? 0.95 : env.time === 'morning' ? 0.55 : 0.2);
    forest.setImpostorLight(env.time === 'mist' ? 0.62 : env.time === 'noon' ? 0.95 : 0.85);
  }

  // Mapped surface under the walker or within ~15 m (a lake shore counts as the lake), for the place label.
  function placeArea(): string | null {
    const names: Record<number, string> = { [AREA.water]: 'water', [AREA.mine]: 'mine', [AREA.enclave]: 'enclave', [AREA.rock]: 'rock', [AREA.sand]: 'sand', [AREA.wetland]: 'wetland', [AREA.field]: 'field' };
    let best = data.areaAt(pos.x, pos.z);
    for (let i = 0; i < 8 && best !== AREA.water; i++) {
      const a = (i / 8) * Math.PI * 2, c = data.areaAt(pos.x + Math.cos(a) * 15, pos.z + Math.sin(a) * 15);
      if (c === AREA.water || (!best && c)) best = c;
    }
    const n = names[best];
    if (n === 'mine' && pos.z > 8000) return 'lamco'; // the Liberian side, south of the massif (as in cards.ts)
    return n ?? null;
  }

  function updatePlace() {
    const b = biomeAt(data, pos.x, pos.z);
    habitat = habitatOf(b);
    const zone = data.zoneAt(pos.x, pos.z);
    const np = data.nearestPlace(pos.x, pos.z);
    const area = placeArea();
    air = area && area !== 'wetland' && area !== 'enclave' ? 'savanna' : habitat;
    hud.setPlace(t(area ? `walk.place.${area}` : `walk.habitat.${habitat}`), fmtMeters(Math.round(pos.y)), !!zone, np && np.d < 1500 ? np.place.name : undefined);
    ctx.onPosition?.(pos.x, pos.z);
  }
  updatePlace();
  let placeT = 0;
  let canopyFill = 0;

  const frame = (now: number) => {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    // Idle for 40 s: drop to ~15 fps (battery).
    if (now - idleSince > 40000 && now - last < 66) return;
    last = now;
    shared.uTime.value += dt;

    // Movement.
    const moving = controls.poll(dt);
    if (moving) idleSince = now;
    const speed = (controls.run ? 4.2 : 1.7) * (coarse ? 1.15 : 1);
    if (controls.move.lengthSq() > 0) {
      const fx = -Math.sin(controls.yaw), fz = -Math.cos(controls.yaw);
      const rx = Math.cos(controls.yaw), rz = -Math.sin(controls.yaw);
      const nx = pos.x + (fx * controls.move.y + rx * controls.move.x) * speed * dt;
      const nz = pos.z + (fz * controls.move.y + rz * controls.move.x) * speed * dt;
      const ex = data.extent;
      pos.x = THREE.MathUtils.clamp(nx, ex.min + 1600, ex.max - 1600);
      pos.z = THREE.MathUtils.clamp(nz, ex.min + 1600, ex.max - 1600);
      forest.collide(pos, 0.35);
      village.collide(pos, 0.35);
    }
    pos.y = data.heightAt(pos.x, pos.z);
    // Wade, don't sink: the eye follows the ground smoothly.
    const s = data.streamAt(pos.x, pos.z);
    const target = pos.y + EYE + (s.dist < s.width ? 0.25 : 0);
    eyeY += (target - eyeY) * (1 - Math.exp(-dt * 10));
    // Bob while walking.
    const bob = moving && !ctx.reducedMotion ? Math.sin(shared.uTime.value * (controls.run ? 11 : 7)) * (controls.run ? 0.05 : 0.025) : 0;
    eye.set(pos.x, eyeY + bob, pos.z);

    cam.position.copy(eye);
    cam.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    farCam.position.copy(eye);
    farCam.quaternion.copy(cam.quaternion);
    farCam.updateMatrixWorld();

    // Streaming.
    if (relocating) { renderer.clear(); return; }
    if (!windowLoading && data.windowStale(pos.x, pos.z)) {
      windowLoading = true;
      void data.loadWindow(pos.x, pos.z).then(() => { windowLoading = false; });
    }
    if (data.streamStale(pos.x, pos.z)) { data.updateStreams(pos.x, pos.z); water.update(eye); }
    if (data.pathStale(pos.x, pos.z)) {
      data.updatePaths(pos.x, pos.z);
      void data.loadOsm(pos.x, pos.z).then(() => { data.updatePaths(pos.x, pos.z); data.updateStreams(pos.x, pos.z); water.update(eye, 420, true); village.reset(); });
    }
    forest.update(eye);
    cover.update(eye);
    water.update(eye);
    ground.update(eye);
    fauna.viewYaw = controls.yaw;
    if (eye.distanceTo(lastFauna) > 200) { fauna.populate(eye); lastFauna.copy(eye); }
    fauna.update(dt, eye, shared.uTime.value);
    village.update(eye, dt, shared.uTime.value);
    placeT += dt;
    if (placeT > 0.5) { placeT = 0; updatePlace(); }
    const fog = fogFor(air, pos.y, fogTint);
    env.update(cam, eye, fog, fogTint, dt);
    // Under a closed canopy the sun barely reaches the floor: lift the sky fill a little (eyes adapt).
    const closed = air === 'lowlandForest' || air === 'cloudForest' || air === 'gallery' ? 1 : 0;
    canopyFill += (closed - canopyFill) * (1 - Math.exp(-dt * 0.7));
    env.hemi.intensity = env.preset.hemi * (1 + canopyFill * 0.7) * (fx ? 0.85 : 1);
    renderer.toneMappingExposure = env.exposure * (1 + canopyFill * 0.38);

    const drawScene = () => { renderer.clear(); renderer.render(far, farCam); renderer.clearDepth(); renderer.render(near, cam); };
    if (post) {
      // light shafts only under a canopy (in the open the whole sky would glare)
      post.render(drawScene, env.sunDir, env.sun.color, (env.time === 'noon' ? 0.45 : env.time === 'mist' ? 0.8 : 1) * canopyFill);
    } else {
      renderer.setRenderTarget(null);
      drawScene();
    }

    // Adapt: if the first seconds run below ~24 fps, lower the resolution (once or twice).
    fpsT += dt; fpsN++;
    if (fpsT > 3 && fpsChecks < 2) {
      const fps = fpsN / fpsT;
      if (fps < 24 && dprScale > 0.6 && !navigator.webdriver) { dprScale *= 0.75; resize(); }
      fpsT = 0; fpsN = 0; fpsChecks++;
    }
  };
  requestAnimationFrame((n) => { last = n; frame(n); });
  hud.veilOff();

  /** Jump far (deep link, debug): wait for the data there, then rebuild everything around it. */
  async function relocate(x: number, z: number) {
    hud.veilOn();
    relocating = true;
    await data.loadWindow(x, z);
    await data.loadOsm(x, z);
    data.updateStreams(x, z);
    data.updatePaths(x, z);
    forest.reset();
    cover.reset();
    village.reset();
    pos.set(x, data.heightAt(x, z), z);
    eyeY = pos.y + EYE;
    eye.set(pos.x, eyeY, pos.z);
    ground.update(eye);
    for (let k = 0; k < 8; k++) { forest.update(eye, 200); await nextFrame(); }
    cover.update(eye);
    water.update(eye, 420, true);
    fauna.populate(eye);
    lastFauna.copy(eye);
    relocating = false;
    updatePlace();
    hud.veilOff();
  }

  // ---- inspect ----
  const ray = new THREE.Raycaster();
  function inspect(sx: number, sy: number) {
    const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    let best = Infinity;
    let hit: Hit | null = null;
    const sphere = (c: THREE.Vector3, r: number) => {
      const oc = new THREE.Vector3().subVectors(o, c);
      const b = oc.dot(d), cc = oc.lengthSq() - r * r;
      const disc = b * b - cc;
      if (disc < 0) return Infinity;
      const tt = -b - Math.sqrt(disc);
      return tt > 0 ? tt : Infinity;
    };
    for (const a of fauna.agents) {
      if (!a.obj.visible) continue;
      const dist = a.pos.distanceTo(o);
      const tt = sphere(a.pos, Math.max(a.size * 2.2, dist * 0.025));
      if (tt < best) { best = tt; hit = { kind: 'animal', agent: a }; }
    }
    const vp = village.pick(ray.ray);
    if (vp && vp.t < best) { best = vp.t; hit = vp.kind === 'person' ? { kind: 'person', person: vp.p } : { kind: 'house', round: vp.h.round }; }
    if (fauna.sitePos) {
      const tt = sphere(fauna.sitePos.clone().add(new THREE.Vector3(0, 0.2, 0)), 1.1);
      if (tt < best) { best = tt; hit = { kind: 'site' }; }
    }
    for (const tr of forest.nearTrees) {
      const crownR = tr.h * tr.crown * (tr.type === 'emergent' || tr.type === 'montane' ? 0.36 : tr.type === 'treefern' || tr.type === 'oilpalm' || tr.type === 'raphia' ? 0.4 : 0.3);
      const cy = tr.y + tr.h * (tr.type === 'raphia' ? 0.55 : tr.type === 'protea' || tr.type === 'regrowth' ? 0.55 : 0.75);
      let tt = sphere(new THREE.Vector3(tr.x, cy, tr.z), crownR * 0.85);
      // trunk: closest approach between the ray and the vertical axis
      const w = new THREE.Vector3(o.x - tr.x, 0, o.z - tr.z);
      const dd = new THREE.Vector3(d.x, 0, d.z);
      const a2 = dd.lengthSq();
      if (a2 > 1e-6) {
        const ta = -w.dot(dd) / a2;
        if (ta > 0) {
          const px = o.x + d.x * ta - tr.x, pz = o.z + d.z * ta - tr.z, py = o.y + d.y * ta;
          const rad = Math.max(0.35, tr.h * tr.crown * 0.035);
          if (Math.hypot(px, pz) < rad && py > tr.y - 0.5 && py < cy) tt = Math.min(tt, ta);
        }
      }
      if (tt < best) { best = tt; hit = { kind: 'tree', tree: tr }; }
    }
    // Ground: ray-march.
    let prev = 0;
    for (let tt = 0.5; tt < Math.min(best, 300); tt += tt < 30 ? 0.25 : 1) {
      const px = o.x + d.x * tt, py = o.y + d.y * tt, pz = o.z + d.z * tt;
      if (py <= data.heightAt(px, pz)) {
        let lo = prev, hi = tt;
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; const qx = o.x + d.x * m, qz = o.z + d.z * m; if (o.y + d.y * m <= data.heightAt(qx, qz)) hi = m; else lo = m; }
        if (hi < best) { best = hi; hit = { kind: 'ground', p: new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi) }; }
        break;
      }
      prev = tt;
    }
    if (!hit) return;
    hud.showMarker(sx, sy);
    if (navigator.vibrate && coarse) navigator.vibrate(8);
    hud.showCard(cardFromHit(hit));
  }

  const cardFor = makeCards(data, ctx.content);
  const cardFromHit = (hit: Hit): Card => cardFor(hit, { habitat, village: data.nearestPlace(pos.x, pos.z)?.place.name ?? '' });

  // ---- exit ----
  function exit() {
    if (exited) return;
    exited = true;
    running = false;
    controls.dispose();
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    const disposeTree = (o: THREE.Object3D) => o.traverse((m) => {
      const mm = m as THREE.Mesh;
      if (mm.geometry) mm.geometry.dispose();
      const mat = mm.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of mats) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
    disposeTree(near); disposeTree(far);
    data.heightTex.dispose(); data.attrTex.dispose(); data.streamTex.dispose();
    env.sun.shadow.map?.dispose();
    post?.dispose();
    envRT?.dispose();
    renderer.autoClear = saved.autoClear;
    renderer.shadowMap.enabled = saved.shadow;
    renderer.shadowMap.type = saved.shadowType;
    renderer.toneMappingExposure = saved.exposure;
    renderer.setPixelRatio(saved.dpr);
    document.body.classList.remove('walking');
    hud.dispose();
    ctx.onExit();
  }

  return {
    exit,
    debug: {
      get pos() { return pos.clone(); },
      get stats() { return forest.stats; },
      get habitat() { return habitat; },
      water, data,
      look(yaw: number, pitch: number) { controls.yaw = yaw; controls.pitch = pitch; },
      teleport: (x: number, z: number) => relocate(x, z),
      setTime(tm: WalkTime) { env.setTime(tm); applyTime(); },
      fx,
      /** Face the nearest visible animal of a kind (or any); returns its kind and distance. */
      lookAtAnimal(kind?: string) {
        let best: Agent | null = null, bd = Infinity;
        for (const a of fauna.agents) {
          if (!a.obj.visible || (kind && a.kind !== kind)) continue;
          const d = a.pos.distanceTo(eye);
          if (d < bd) { bd = d; best = a; }
        }
        if (!best) return null;
        const v = new THREE.Vector3().subVectors(best.pos, eye);
        controls.yaw = Math.atan2(-v.x, -v.z);
        controls.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
        return { kind: best.kind, d: bd };
      },
      animals() { return fauna.agents.map((a) => ({ kind: a.kind, visible: a.obj.visible, d: Math.round(a.pos.distanceTo(eye)) })); },
      village() { return { houses: village.houses.length, people: village.people.map((p) => ({ a: p.activity, d: Math.round(p.pos.distanceTo(eye)) })) }; },
      lookAt(x: number, y: number, z: number) { const v = new THREE.Vector3(x - eye.x, y - eye.y, z - eye.z); controls.yaw = Math.atan2(-v.x, -v.z); controls.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)); },
      people() { return village.people.map((p) => ({ a: p.activity, x: p.pos.x, y: p.pos.y, z: p.pos.z })); },
      inspect,
    },
  };
}

function nextFrame() { return new Promise<void>((r) => requestAnimationFrame(() => r())); }
