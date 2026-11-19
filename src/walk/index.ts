// Walk mode: a first-person, ground-level view of the massif at any point of the 3D window.
// Lazy-loaded from main.ts; shares the app's WebGL renderer while the orbit view is suspended.
//
// Rendering: two passes with separate depth ranges (no z-fighting at ground level, 30 km views from the
// summit): far = sky, whole massif (DSM), outer clouds; near = ground patch, forest, cover, water, animals.
import * as THREE from 'three';
import { t, fmtMeters, getLang, onLang } from '../i18n';
import { lonLatToXZ } from '../data/geo';
import type { Content } from '../data/content';
import type { Heightfield } from '../scene/heightfield';
import type { Tier } from '../scene/tier';
import { AREA, WalkData } from './data';
import { WalkEnv, WALK_TIMES, shared, walkMaterial, type WalkTime } from './env';
import { Ground } from './ground';
import { CanopyBelt } from './canopyBelt';
import { loadCrown } from './crownModels';
import { loadHinterland } from './hinterland';
import { RegionalFlora } from './regionalFlora';
import { Lianas } from './lianas';
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
import { readSettings } from './settings';
import { WalkMenu } from './menu';
import { advanceWalker, type Walker } from './movement';
import { AnimatedPlants } from './animatedPlants';
import { loadLandscape, type LandscapeMaps } from '../scene/landscape';
import { LandscapeForest } from '../scene/landscapeForest';

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

export interface WalkTour {
  go(x: number, z: number, yaw: number, pitch: number, time: WalkTime): Promise<void>;
  look(yaw: number, pitch: number, time?: WalkTime): void;
  facePeople(): boolean;
  openPano(): Promise<void>;
  readonly hasPano: boolean;
  autopilot(speed: number, turn?: number): void;
}
export interface WalkHandle { exit(): void; tour: WalkTour; debug: Record<string, unknown> }

const TIER_OPTS = {
  high: { seg: 512, R: 2400, shell: [650, 950], range: 650, near: 110, variants: 3, imp: 512, shadows: 4096, cover: 120, spacing: 0.48, rock: 220, birds: 12, flies: 18, dpr: 2, tex: 1024 },
  mid: { seg: 224, R: 1300, shell: [240, 360], range: 260, near: 32, variants: 2, imp: 128, shadows: 1024, cover: 56, spacing: 0.75, rock: 110, birds: 6, flies: 10, dpr: 1.25, tex: 256 },
  low: { seg: 160, R: 1000, shell: [150, 240], range: 170, near: 20, variants: 2, imp: 128, shadows: 0, cover: 34, spacing: 1.0, rock: 70, birds: 4, flies: 6, dpr: 1, tex: 256 },
} as const;

const EYE = 1.65;

export async function enterWalk(ctx: WalkContext): Promise<WalkHandle> {
  const { renderer } = ctx;
  const settings = readSettings();
  const quality = new URLSearchParams(location.search).has('tier') || settings.quality === 'auto' ? ctx.tier : settings.quality;
  const O = TIER_OPTS[quality];
  const reduceMotion = () => ctx.reducedMotion || settings.reducedMotion;
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
  try {
    await data.init();
    await Promise.all([data.loadWindow(ctx.start.x, ctx.start.z), data.loadPlaces()]);
    await data.loadOsm(ctx.start.x, ctx.start.z);
  } catch (error) {
    data.dispose(); hud.dispose(); document.body.classList.remove('walking');
    throw error;
  }
  data.updateStreams(ctx.start.x, ctx.start.z);
  data.updatePaths(ctx.start.x, ctx.start.z);
  await nextFrame();

  // ---- scene ----
  const params = new URLSearchParams(location.search);
  const time0 = (WALK_TIMES as string[]).includes(params.get('walktime') ?? '') ? params.get('walktime') as WalkTime : 'morning';
  // High-quality look: generated textures, sky light, AO, bloom, light shafts, sharpening (?fx=1/0 forces).
  const fxParam = params.get('fx');
  const fx = fxParam === '1' || (fxParam !== '0' && quality === 'high');
  let foliage: THREE.Texture | undefined;
  let exited = false;
  let forestReady = false;
  if (fx) void new THREE.TextureLoader().loadAsync(`${ctx.base}walk/art/canopy.webp`).then(texture => {
    if (exited) { texture.dispose(); return; }
    foliage = texture;
    if (forestReady) forest.useFoliage(texture);
  }).catch(e => console.warn('walk: optional foliage unavailable', e));
  const env = new WalkEnv(time0, fx ? Math.max(O.shadows, 4096) : O.shadows);
  const ground = new Ground(data, ctx.hf, ctx.lcTex, { segments: O.seg, radius: O.R, shellStart: O.shell[0], shellEnd: O.shell[1], shadows: O.shadows > 0 }, env.sunDir, { hemiSky: env.hemi.color, hemiGround: env.hemi.groundColor, sun: env.sun.color });
  hud.setVeilText(`${t('walk.loading')} 30 %`);
  await nextFrame();
  const forest = new Forest(data, { range: O.range, near: O.near, variants: O.variants, impostorRes: O.imp, shadows: O.shadows > 0 });
  forest.init(renderer, foliage);
  forestReady = true;
  hud.setVeilText(`${t('walk.loading')} 60 %`);
  await nextFrame();
  const cover = new GroundCover(data, { radius: O.cover, spacing: O.spacing, shadows: O.shadows > 0, rockRadius: O.rock, texSize: O.tex, msaa: !!renderer.getContext().getContextAttributes()?.antialias });
  const water = new Water(data, env.hemi.color);
  const fauna = new Fauna(data, { birds: O.birds, butterflies: O.flies });
  const village = new Village(data, quality === 'high' ? 26 : quality === 'mid' ? 16 : 8, quality === 'high' ? ctx.base : undefined);

  const far = new THREE.Scene();
  far.add(env.sky, ground.far);
  const near = new THREE.Scene();
  near.add(ground.mesh, forest.group, cover.group, water.mesh, fauna.group, village.group, ground.cloudNear, env.hemi, env.sun, env.sun.target);
  const animatedPlants = fx ? new AnimatedPlants() : null;
  let landscapeMaps: LandscapeMaps | null = null;
  let canopyBelt: CanopyBelt | null = null;
  let distantForest: LandscapeForest | null = null;
  if (animatedPlants) near.add(animatedPlants.group);
  const farCam = new THREE.PerspectiveCamera(62, 1, 30, 60000);
  const cam = new THREE.PerspectiveCamera(62, 1, 0.1, Math.max(2600, O.R * 1.8));

  let post: PostFX | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let scansPending = fx ? 3 : 0;
  const flora = new RegionalFlora(data, quality === 'high' ? 31 : quality === 'mid' ? 19 : 12);
  const lianas = new Lianas();
  near.add(flora.group,lianas.mesh);
  scansPending++;
  void flora.load(ctx.base, Math.min(12,renderer.capabilities.getMaxAnisotropy()))
    .catch(e=>console.warn('walk: local flora unavailable',e)).finally(()=>scansPending--);
  if (quality === 'high') {
    scansPending += 3;
    void loadHinterland(ctx.base, env.sunDir).then(mesh => {
      if (exited) { mesh.geometry.dispose(); mesh.material.dispose(); return; }
      far.add(mesh);
    }).catch(e => console.warn('walk: regional terrain unavailable', e)).finally(() => scansPending--);
    for (const [variant, id] of ['02', '03'].entries()) {
      void loadCrown(ctx.base, id).then(parts => {
        if (exited) { for (const p of parts) { p.geometry.dispose(); p.material.dispose(); } return; }
        forest.installCrown(renderer, parts, variant);
      }).catch(e => console.warn('walk: broadleaf model unavailable', e)).finally(() => scansPending--);
    }
    scansPending++;
    void loadLandscape(ctx.base, Math.min(16, renderer.capabilities.getMaxAnisotropy())).then(maps => {
      if (exited) { for (const texture of Object.values(maps)) texture.dispose(); return; }
      landscapeMaps = maps;
      env.skyUniforms.uPhotoSky.value = maps.sky;
      env.skyUniforms.uPhotoSkyStrength.value = .96;
      ground.useLandscape(maps);
      canopyBelt = new CanopyBelt(data, maps.canopy);
      near.add(canopyBelt.group);
      cover.useGrass(maps.grass);
      distantForest = new LandscapeForest(ctx.hf, ctx.lcTex, maps.tree, {
        atmosphere: 'walk', uniforms: shared, inner: 550, outer: 22000,
      });
      far.add(distantForest.mesh);
    }).catch(e => console.warn('walk: optional landscape unavailable', e)).finally(() => { scansPending--; });
  }
  if (fx) {
    post = new PostFX(renderer, cam, near);
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    loadPhotos(ctx.base, aniso).then((p) => {
      if (exited) return;
      ground.usePhotos(p, aniso); forest.usePhotos(p); cover.usePhotos(p);
    }).catch((e) => console.warn('walk: scanned textures unavailable', e)).finally(() => { scansPending--; });
    loadModels(ctx.base, aniso, { single_root: 'root' }).then((m) => {
      if (exited) return;
      cover.useModels(m); forest.useModels(m);
    }).catch((e) => console.warn('walk: scanned models unavailable', e)).finally(() => { scansPending--; });
    void animatedPlants!.init(ctx.base).catch((e) => console.warn('walk: animation unavailable', e)).finally(() => { scansPending--; });
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
      // Settings specify horizontal FOV. Preserve a useful vertical FOV on portrait screens.
      c.fov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov / 2)) / (w / h)) * 180 / Math.PI, 45, 100);
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
  const menu = new WalkMenu(settings);
  controls.sensitivity = settings.sensitivity;
  menu.onChange = () => { controls.sensitivity = settings.sensitivity; resize(); };
  menu.onOpen = (open) => { controls.paused = open; controls.resetInput(); };
  hud.onMenu = (button) => menu.show(button);
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
  for (let k = 0; k < 8; k++) { forest.update(eye, 200); cover.update(eye); await nextFrame(); }
  // Start in the most open spot within ~22 m (not inside a bush, a house or a stream, not against a trunk).
  function openSpot(x0: number, z0: number): [number, number] {
    let bestScore = Infinity, bx = x0, bz = z0;
    for (let k = 0; k < 48; k++) {
      const a = k * 2.39996, d = Math.sqrt(k / 48) * 22;
      const cx = x0 + Math.cos(a) * d, cz = z0 + Math.sin(a) * d;
      const st = data.streamAt(cx, cz);
      let score = st.dist < st.width * 1.5 ? 50 : 0;
      const gx = (data.heightAt(cx + 1, cz) - data.heightAt(cx - 1, cz)) / 2;
      const gz = (data.heightAt(cx, cz + 1) - data.heightAt(cx, cz - 1)) / 2;
      if (Math.hypot(gx, gz) > Math.tan(35 * Math.PI / 180)) score += 80;
      if (data.buildingAt(cx, cz, 1.5)) score += 100;
      for (const tr of forest.nearTrees) {
        const dd = Math.hypot(tr.x - cx, tr.z - cz);
        const reach = Math.max(1.2, tr.h * tr.crown * (tr.h < 6 ? 0.45 : 0.06));
        if (dd < reach + 1.2) score += 1 + (reach + 1.2 - dd);
      }
      score += d * 0.02;
      if (score < bestScore) { bestScore = score; bx = cx; bz = cz; }
    }
    return [bx, bz];
  }
  {
    const [bx, bz] = openSpot(ctx.start.x, ctx.start.z);
    pos.set(bx, data.heightAt(bx, bz), bz);
    eyeY = pos.y + EYE;
    eye.set(pos.x, eyeY, pos.z);
  }
  const walker: Walker = { x: pos.x, y: pos.y, z: pos.z, vy: 0, grounded: true };
  const collisionPos = new THREE.Vector3();
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
  const frameTimes: number[] = [];
  let walkDistance = 0;
  let jumps = 0, jumpPeak = 0;
  let terrainError = false;
  let streamRetryAt = 0;
  let capturePaused = false;
  let captureNext: (() => void) | null = null;
  // Guided tour: walk slowly forward while turning gently (the user's own input always wins).
  const auto = { on: false, speed: 0, turn: 0 };

  controls.onActivity = () => { idleSince = performance.now(); };
  controls.onInspect = (x, y) => inspect(x, y);
  hud.onExit = () => exit();
  hud.onTime = () => {
    const i = (WALK_TIMES.indexOf(env.time) + 1) % WALK_TIMES.length;
    env.setTime(WALK_TIMES[i]);
    applyTime();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !menu.open) { if (hud.cardOpen) hud.hideCard(); else if (!controls.locked) exit(); }
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
    ground.setClouds(env.time === 'mist' ? 1300 : 1220, env.time === 'mist' ? 0.95 : env.time === 'morning' ? 0.12 : 0.05);
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

  // Photo-real 360° panoramas rendered offline (public/pano/): offered within 400 m of their spot.
  let panos: import('../ui/pano').PanoEntry[] = [];
  let panoHere: import('../ui/pano').PanoEntry | null = null;
  let panoOpen = false;
  void import('../ui/pano').then((m) => m.loadPanos(ctx.base)).then((l) => { panos = l; updatePlace(); });
  hud.onPano = () => {
    if (!panoHere || panoOpen) return;
    panoOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    void import('../ui/pano').then((m) => m.openPano(panoHere!, ctx.base, getLang(), reduceMotion())).finally(() => { panoOpen = false; last = performance.now(); });
  };

  function updatePlace() {
    const b = biomeAt(data, pos.x, pos.z);
    habitat = habitatOf(b);
    const zone = data.zoneAt(pos.x, pos.z);
    const np = data.nearestPlace(pos.x, pos.z);
    const area = placeArea();
    air = area && area !== 'wetland' && area !== 'enclave' ? 'savanna' : habitat;
    hud.setPlace(t(area ? `walk.place.${area}` : `walk.habitat.${habitat}`), fmtMeters(Math.round(pos.y)), !!zone, np && np.d < 1500 ? np.place.name : undefined);
    panoHere = null;
    for (const pe of panos) {
      const [px, pz] = lonLatToXZ(pe.lon, pe.lat);
      if (Math.hypot(px - pos.x, pz - pos.z) < 400) { panoHere = pe; break; }
    }
    hud.setPano(!!panoHere);
    ctx.onPosition?.(pos.x, pos.z);
  }
  updatePlace();
  const offLang = onLang(() => { updatePlace(); hud.setTime(t(`walk.time.${env.time}`)); hud.hideCard(); });
  let placeT = 0;
  let canopyFill = 0;

  const frame = (now: number) => {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden || panoOpen) return; // the 360° viewer covers the screen: no walk frames meanwhile
    // The modal owns input and covers the scene. Keep the last frame instead of redrawing expensive shadows.
    if (menu.open || capturePaused) { last = now; return; }
    const elapsed = (now - last) / 1000;
    const dt = menu.open ? 0 : Math.min(0.1, elapsed);
    // Idle for 40 s: drop to ~15 fps (battery).
    if (now - idleSince > 40000 && now - last < 66) return;
    last = now;
    shared.uTime.value += reduceMotion() ? 0 : dt;
    shared.uWind.value = reduceMotion() ? 0 : 1;
    if (!menu.open) { frameTimes.push(elapsed * 1000); if (frameTimes.length > 600) frameTimes.shift(); }

    // Movement.
    let moving = controls.poll(dt);
    if (auto.on && !moving && !menu.open) {
      controls.move.set(0, auto.speed);
      if (!reduceMotion()) controls.yaw += auto.turn * dt;
      moving = auto.speed > 0;
    }
    if (moving) idleSince = now;
    const speed = (controls.run ? 4.2 : 1.7) * (coarse ? 1.15 : 1);
    if (!menu.open && !relocating && !terrainError) {
      const forwardX = -Math.sin(controls.yaw), forwardZ = -Math.cos(controls.yaw);
      const rightX = Math.cos(controls.yaw), rightZ = -Math.sin(controls.yaw);
      const ex = data.extent;
      const boulders = cover.bouldersNear(pos.x, pos.z, 6);
      const jumped = advanceWalker(walker,
        (forwardX * controls.move.y + rightX * controls.move.x) * speed * dt,
        (forwardZ * controls.move.y + rightZ * controls.move.x) * speed * dt,
        dt, controls.consumeJump(), {
          height: (x, z) => data.heightAt(x, z) + cover.deadfallHeight(x,z), min: ex.min + 20, max: ex.max - 20,
          collide(p) {
            collisionPos.set(p.x, p.y, p.z);
            forest.collide(collisionPos, 0.35); village.collide(collisionPos, 0.35);
            for (const b of boulders) {
              if (b.s < 0.6 || p.y > b.y + b.sy) continue;
              const radius = b.s * 0.45 + 0.35, dx = collisionPos.x - b.x, dz = collisionPos.z - b.z;
              const d = Math.hypot(dx, dz);
              if (d < radius) { collisionPos.x = b.x + (d > 0.0001 ? dx / d : 1) * radius; collisionPos.z = b.z + (d > 0.0001 ? dz / d : 0) * radius; }
            }
            p.x = collisionPos.x; p.z = collisionPos.z;
          },
        });
      if (jumped) { jumps++; jumpPeak = 0; }
      if (jumps) jumpPeak = Math.max(jumpPeak, walker.y - data.heightAt(walker.x, walker.z));
      walkDistance += Math.hypot(pos.x - walker.x, pos.z - walker.z);
      pos.set(walker.x, walker.y, walker.z);
    }
    // Wade, don't sink: the eye follows the ground smoothly.
    const s = data.streamAt(pos.x, pos.z);
    const target = pos.y + EYE + (s.dist < s.width ? 0.25 : 0);
    eyeY += (target - eyeY) * (1 - Math.exp(-dt * 10));
    // Bob while walking.
    const bob = moving && walker.grounded && settings.headBob && !reduceMotion() ? Math.sin(shared.uTime.value * (controls.run ? 11 : 7)) * (controls.run ? 0.05 : 0.025) : 0;
    eye.set(pos.x, eyeY + bob, pos.z);

    cam.position.copy(eye);
    cam.rotation.set(controls.pitch, controls.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    farCam.position.copy(eye);
    farCam.quaternion.copy(cam.quaternion);
    farCam.updateMatrixWorld();

    // Streaming.
    if (relocating) { renderer.clear(); return; }
    if (!windowLoading && now >= streamRetryAt && data.windowStale(pos.x, pos.z)) {
      windowLoading = true;
      void data.loadWindow(pos.x, pos.z).then(() => { terrainError = false; }).catch(() => {
        terrainError = true; streamRetryAt = performance.now() + 5000;
        hud.showCard({ kicker: t('walk.menu.eyebrow'), title: t('walk.loadingError'), lines: [], sources: [] });
      }).finally(() => { windowLoading = false; });
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
    canopyBelt?.update(eye);
    flora.update(eye,forest.nearTrees);
    lianas.update(eye,forest.nearTrees);
    fauna.viewYaw = controls.yaw;
    if (eye.distanceTo(lastFauna) > 200) { fauna.populate(eye); lastFauna.copy(eye); }
    fauna.update(dt, eye, shared.uTime.value);
    village.update(eye, dt, shared.uTime.value);
    animatedPlants?.update(data, eye, dt, reduceMotion());
    placeT += dt;
    if (placeT > 0.5) { placeT = 0; updatePlace(); }
    hud.setBearing(controls.yaw);
    const fog = fogFor(air, pos.y, fogTint);
    // Clear weather preserves long views; the explicit mist preset still has dense habitat fog.
    const visibility = quality === 'high' && env.time !== 'mist' ? 0.28 : 1;
    env.update(cam, eye, fog * visibility, fogTint, dt);
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
    if (captureNext) { const captured = captureNext; captureNext = null; capturePaused = true; captured(); }

    // Adapt: if the first seconds run below ~24 fps, lower the resolution (once or twice).
    if (!menu.open) { fpsT += elapsed; fpsN++; }
    if (fpsT > 3 && fpsChecks < 2) {
      const fps = fpsN / fpsT;
      if (fps < 24 && dprScale > 0.6 && !navigator.webdriver && !params.has('tier') && settings.quality === 'auto') { dprScale *= 0.75; resize(); }
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
    const [bx, bz] = openSpot(x, z);
    pos.set(bx, data.heightAt(bx, bz), bz);
    Object.assign(walker, { x: pos.x, y: pos.y, z: pos.z, vy: 0, grounded: true });
    controls.resetInput();
    eyeY = pos.y + EYE;
    eye.set(pos.x, eyeY, pos.z);
    ground.update(eye);
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
    const plant = flora.pick(ray,best);
    if (plant) { hud.showMarker(sx,sy); hud.showCard(plant); return; }
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
    menu.dispose(); offLang();
    animatedPlants?.dispose();
    shared.uWind.value = 1;
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    const disposeTree = (o: THREE.Object3D) => o.traverse((m) => {
      const mm = m as THREE.Mesh;
      if (mm.geometry) mm.geometry.dispose();
      mm.customDepthMaterial?.dispose(); mm.customDistanceMaterial?.dispose();
      const mat = mm.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of mats) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
    disposeTree(near); disposeTree(far);
    village.dispose();
    forest.dispose();
    flora.dispose();
    canopyBelt?.dispose();
    ground.dispose();
    if (landscapeMaps) for (const map of Object.values(landscapeMaps)) map.dispose();
    data.dispose();
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
    tour: {
      /** Jump to a place (open spot nearby), set the view and the time of day. */
      async go(x: number, z: number, yaw: number, pitch: number, time: WalkTime) {
        auto.on = false;
        controls.move.set(0, 0);
        env.setTime(time); applyTime();
        controls.yaw = yaw; controls.pitch = pitch;
        await relocate(x, z);
      },
      look(yaw: number, pitch: number, time?: WalkTime) {
        controls.yaw = yaw; controls.pitch = pitch;
        if (time) { env.setTime(time); applyTime(); }
      },
      /** Turn towards the nearest villagers (within 80 m), if any. */
      facePeople() {
        let best: THREE.Vector3 | null = null, bd = 80;
        for (const p of village.people) { const d = p.pos.distanceTo(eye); if (d > 4 && d < bd) { bd = d; best = p.pos; } }
        if (!best) return false;
        controls.yaw = Math.atan2(-(best.x - eye.x), -(best.z - eye.z));
        controls.pitch = Math.atan2(best.y + 1.0 - eye.y, bd) * 0.6;
        return true;
      },
      /** Open the 360° view of this place, if there is one (resolves when closed). */
      async openPano() { if (panoHere) hud.onPano(); },
      get hasPano() { return !!panoHere; },
      /** speed: fraction of walking pace (0..1); turn: rad/s. */
      autopilot(speed: number, turn = 0) { auto.on = speed > 0 || turn !== 0; auto.speed = speed; auto.turn = turn; if (!auto.on) controls.move.set(0, 0); },
    },
    debug: {
      get pos() { return pos.clone(); },
      get stats() { return forest.stats; },
      get habitat() { return habitat; },
      water, data,
      look(yaw: number, pitch: number) { controls.yaw = yaw; controls.pitch = pitch; },
      teleport: (x: number, z: number) => relocate(x, z),
      setTime(tm: WalkTime) { env.setTime(tm); applyTime(); },
      fx,
      get animation() { return animatedPlants?.stats ?? null; },
      get landscape() { return { distantTrees: distantForest?.count ?? 0, detailedTreeRange: O.range, geometryRange: O.near, groundRadius: O.R, farTerrainSegments: O.seg >= 500 ? 700 : 300, horizon: distantForest ? 22000 : 0 }; },
      nearestLeaf: () => flora.nearestLeaf(eye),
      get localFlora() { return flora.counts; },
      get groundCover() { return cover.stats; },
      /** Test capture: render one real frame at the current viewport, then stop submitting GPU work. */
      freezeFrame() { capturePaused = false; return new Promise<void>((resolve) => { captureNext = resolve; }); },
      resumeFrames() { capturePaused = false; last = performance.now(); },
      get motion() { return { grounded: walker.grounded, vy: walker.vy, jumps, jumpPeak, distance: walkDistance, fov: cam.fov, eyeY: eye.y, yaw: controls.yaw, pitch: controls.pitch, settings: { ...settings } }; },
      get performance() { return { frames: frameTimes.length, frameMs: [...frameTimes], quality, dpr: renderer.getPixelRatio(), terrainError, scansPending }; },
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
