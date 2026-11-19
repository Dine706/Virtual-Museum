import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import * as THREE from 'three';
import { applyStatic, getLang, onLang } from './i18n';
import { hideLoading, Progress, setLoadingText, showFatal } from './ui/loading';
import { showTitleCard } from './ui/titlecard';
import { BASE, flags, reducedMotion } from './flags';
import { t } from './i18n';
import { checkMeta, lonLatToXZ, xzToLonLat, WORLD, WORLD_W, WORLD_D, type TerrainMeta } from './data/geo';
import { Regions } from './data/regions';
import { pickGround } from './scene/picking';
import { Readout } from './ui/readout';
import type { Overlays } from './scene/overlays';
import { TerrainLabels } from './ui/labels';
import { FLY_START, groundPoint, minClearance, planFlyover, runFlyover } from './scene/flyover';
import { Subtitles } from './ui/subtitles';
import { loadContent, loadCredits, loc, type Hotspot, type Mode } from './data/content';
import { decodePixels, fetchBlob } from './data/loader';
import { Heightfield } from './scene/heightfield';
import { Landcover } from './scene/landcover';
import { buildTerrainGeometry } from './scene/terrain';
import { Stage } from './scene/stage';
import { detectTier, saveTier, TIERS, type Tier, type TierSpec } from './scene/tier';
import { FpsWatchdog } from './scene/watchdog';
import { DEFAULT_EXAG, HOME_VIEW, ORBIT } from './scene/config';
import { clampCamera, currentPose, poseToPosition, tweenPose, type OrbitPose } from './scene/camera';
import { ATMO_ORDER, Atmosphere, nextAtmo, type AtmoName } from './scene/atmosphere';
import { createTerrainMaterial } from './scene/terrainMaterial';
import { Clouds, createSky } from './scene/sky';
import { announce, Chrome } from './ui/chrome';
import { Pins } from './ui/pins';
import type { Panel } from './ui/panel';
import type { PhotoViewer } from './ui/viewer';
import type { WalkHandle } from './walk';
import { loadLandscape, useLandscape } from './scene/landscape';
import { LandscapeForest } from './scene/landscapeForest';

setLoadingText();
applyStatic();

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

async function boot() {
  const mark = (n: string) => performance.mark(`nimba:${n}`);
  mark('boot');
  if (!webglAvailable()) { showFatal(t('loading.error')); return; }
  mark('webgl-probe');
  // Intro pending (no ?skipintro, no #/h/ deep link): keep chrome and pins hidden from the first frame.
  const introPending = !flags.skipIntro && !/^#\/(h|walk)\//.test(location.hash);
  if (introPending) document.body.classList.add('flying');
  const tier = detectTier(flags.tier);
  const exag = DEFAULT_EXAG;
  const progress = new Progress();

  const [meta, content, terrBlob, lcBlob] = await Promise.all([
    fetch(`${BASE}data/terrain_meta.json`).then((r) => r.json() as Promise<TerrainMeta>),
    loadContent(BASE),
    fetchBlob(`${BASE}data/${tier.terrarium}`, progress.track('terrain', tier.terrariumBytes), tier.terrariumBytes),
    fetchBlob(`${BASE}data/landcover_classes.png`, progress.track('landcover', 76479), 76479),
  ]);
  mark('fetched');
  const issues = checkMeta(meta);
  if (issues.length) console.warn('terrain_meta.json:', issues.join('; '));

  const [terrPx, lcPx] = await Promise.all([decodePixels(terrBlob), decodePixels(lcBlob)]);
  const hf = Heightfield.fromTerrarium(terrPx.data, terrPx.width);
  const lc = Landcover.fromPixels(lcPx.data, lcPx.width);
  mark('decoded');

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const stage = new Stage(canvas, tier);
  mark('context');
  const { scene, camera, controls } = stage;

  // Atmosphere (shared uniforms) → terrain shader, sky dome, clouds.
  const initialAtmo: AtmoName = (ATMO_ORDER as string[]).includes(flags.atmo ?? '') ? (flags.atmo as AtmoName) : 'clear';
  const atmo = new Atmosphere(initialAtmo, exag);
  const syncExposure = () => { stage.renderer.toneMappingExposure = atmo.exposure; };
  atmo.subscribe(syncExposure);
  syncExposure();
  const geom = buildTerrainGeometry(hf, tier.segments, exag);
  const terrainMat = createTerrainMaterial(atmo, hf, lc.toTexture(), tier.shadowSteps);
  const terrain = new THREE.Mesh(geom, terrainMat);
  terrain.frustumCulled = false;
  mark('terrain-built');
  scene.add(createSky(atmo), terrain);
  let landscapeForest: LandscapeForest | null = null;
  if (tier.tier === 'high') {
    const maps = await loadLandscape(BASE, Math.min(16, stage.renderer.capabilities.getMaxAnisotropy()));
    // ShaderMaterial exposes a general uniform map; these names come from createTerrainMaterial.
    useLandscape(terrainMat.uniforms as ReturnType<typeof import('./scene/landscape').landscapeUniforms>, maps);
    landscapeForest = new LandscapeForest(hf, terrainMat.uniforms.uLand.value, maps.tree, {
      atmosphere: 'orbit', uniforms: atmo.uniforms, inner: 0, outer: 60000,
    });
    scene.add(landscapeForest.mesh);
  }
  const clouds = tier.clouds > 0 ? new Clouds(atmo, terrainMat.uniforms.uHeight.value, tier.clouds) : null;
  if (clouds) scene.add(clouds.group);

  // Cloud/mist drift. On the high tier the clouds drift continuously, but only for 20 s after the last
  // interaction: an untouched page stops rendering (battery, CLAUDE.md §6.10). Mid/low tiers advance time
  // only while frames are rendered anyway. No drift under prefers-reduced-motion.
  let lastInput = performance.now();
  let drifting = false;
  const startDrift = () => {
    if (drifting || reducedMotion || stage.tier.tier !== 'high') return;
    drifting = true;
    stage.addAnimator((dt, now) => {
      atmo.uniforms.uTime.value += dt;
      drifting = stage.tier.tier === 'high' && !document.hidden && now - lastInput < 20000;
      return drifting;
    });
  };
  const onInput = () => { lastInput = performance.now(); startDrift(); };
  for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, onInput, { passive: true });
  startDrift();
  if (!reducedMotion) stage.onBeforeRender(() => { if (!drifting) atmo.uniforms.uTime.value += 1 / 30; });

  // Home orbit (portrait screens look down a little more so the ridge fills the frame).
  const [tx, tz] = lonLatToXZ(HOME_VIEW.target.lon, HOME_VIEW.target.lat);
  const homePose = (): OrbitPose => {
    const portrait = camera.aspect < 0.8;
    return {
      target: new THREE.Vector3(tx, HOME_VIEW.target.h * exag, tz),
      azimuthDeg: HOME_VIEW.azimuthDeg,
      elevationDeg: portrait ? HOME_VIEW.elevationDeg + 14 : HOME_VIEW.elevationDeg,
      distance: portrait ? HOME_VIEW.distance * 1.25 : HOME_VIEW.distance,
    };
  };
  const applyPose = (p: OrbitPose) => {
    controls.target.copy(p.target);
    poseToPosition(p, camera.position);
    camera.lookAt(p.target);
  };
  applyPose(homePose());
  controls.update();
  stage.onBeforeRender(() => clampCamera(camera, controls.target, hf, exag));

  const flyTo = (to: OrbitPose, ms = 1200) => {
    readout?.hide();
    if (reducedMotion) { applyPose(to); stage.invalidate(); return; }
    controls.enabled = false;
    stage.addAnimator(tweenPose(currentPose(camera, controls.target), to, ms, applyPose, () => { controls.enabled = true; }));
  };

  // ---- Free-click readout + double-tap fly (M5) ----
  // Boundaries are small; fetch them right away but never block the first frame on them.
  const regionsP = Regions.load(BASE);
  regionsP.catch((e) => console.error(e));
  // eslint-disable-next-line prefer-const
  let readout: Readout;

  const describe = async (p: THREE.Vector3) => {
    const regions = await regionsP;
    const [lon, lat] = xzToLonLat(p.x, p.z);
    let nearest: { hotspot: Hotspot; distance: number } | null = null;
    for (const h of content.hotspots) {
      const [x, z] = lonLatToXZ(h.lon, h.lat);
      const d = Math.hypot(x - p.x, z - p.z);
      if (!nearest || d < nearest.distance) nearest = { hotspot: h, distance: d };
    }
    return {
      elevation: hf.heightAt(p.x, p.z),
      landcover: lc.classAtUV((p.x - WORLD.minX) / WORLD_W, (p.z - WORLD.minZ) / WORLD_D),
      place: regions.classify(lon, lat),
      nearest,
      lon, lat,
      x: p.x, z: p.z,
    };
  };

  let down: { x: number; y: number; t: number; id: number } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  });
  canvas.addEventListener('pointerup', async (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || e.timeStamp - d.t > 450) return;
    // Measure the gesture, not the time spent waiting behind a busy render on the main thread.
    const now = e.timeStamp;
    const isDouble = !!lastTap && now - lastTap.t < 330 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
    lastTap = isDouble ? null : { x: e.clientX, y: e.clientY, t: now };
    const p = pickGround(e.clientX, e.clientY, canvas, camera, hf, exag);
    if (!p) { readout.hide(); return; }
    if (isDouble) {
      const cur = currentPose(camera, controls.target);
      flyTo({ target: p, azimuthDeg: cur.azimuthDeg, elevationDeg: Math.max(cur.elevationDeg, 30), distance: THREE.MathUtils.clamp(cur.distance * 0.45, 1500, 8000) }, 1000);
      return;
    }
    const info = await describe(p);
    readout.show(e.clientX, e.clientY, info);
    announce(document.querySelector('.readout')?.textContent ?? '');
  });

  // ---- Overlays (white borders) and terrain labels (M6) ----
  let overlays: Overlays | null = null;
  const labels = new TerrainLabels(hf, exag);
  stage.onAfterRender(() => labels.update(camera, canvas.clientWidth, canvas.clientHeight));
  const sizeOverlays = () => overlays?.setResolution(canvas.clientWidth, canvas.clientHeight);
  window.addEventListener('resize', sizeOverlays);
  // Overlays (three's Line2) are code-split: not needed for the first frame.
  Promise.all([regionsP, import('./scene/overlays')]).then(([r, { Overlays: OverlaysCls }]) => {
    overlays = new OverlaysCls(r, hf, exag);
    scene.add(overlays.group);
    sizeOverlays();
    void overlays.precompile(stage.renderer, scene, camera);
    // Cinematic intro: no overlay lines over the title card and flyover.
    if (document.body.classList.contains('flying')) overlays.group.visible = false;
    overlays.setMode(mode, 0);
    stage.invalidate();
  }).catch(() => { /* overlays are optional: the scene works without them */ });

  // Terrain grading per mode (DESIGN.md §7), cross-faded with the overlays.
  const MODE_LOOK: Record<Mode, { habitat: number; tint: THREE.Color; tintAmount: number; sat: number }> = {
    nature: { habitat: 0.75, tint: new THREE.Color(1, 1, 1), tintAmount: 0, sat: 1 },
    culture: { habitat: 0, tint: new THREE.Color(1.3, 1.0, 0.68), tintAmount: 0.8, sat: 1.06 },
    conservation: { habitat: 0, tint: new THREE.Color(1, 1, 1), tintAmount: 0, sat: 0.7 },
  };
  const tu = terrainMat.uniforms;
  const applyLook = (m: Mode, ms: number) => {
    const to = MODE_LOOK[m];
    const from = { habitat: tu.uHabitat.value as number, tint: (tu.uTint.value as THREE.Color).clone(), tintAmount: tu.uTintAmount.value as number, sat: tu.uModeSat.value as number };
    const set = (k: number) => {
      tu.uHabitat.value = from.habitat + (to.habitat - from.habitat) * k;
      (tu.uTint.value as THREE.Color).lerpColors(from.tint, to.tint, k);
      tu.uTintAmount.value = from.tintAmount + (to.tintAmount - from.tintAmount) * k;
      tu.uModeSat.value = from.sat + (to.sat - from.sat) * k;
    };
    if (ms <= 0) { set(1); stage.invalidate(); return; }
    const start = performance.now();
    stage.addAnimator((_dt, now) => { const t = Math.min(1, Math.max(0, (now - start) / ms)); set(t * t * (3 - 2 * t)); return t < 1; });
  };

  // ---- Pins, modes, selection, deep links ----
  const modes: Mode[] = ['nature', 'culture', 'conservation'];
  let mode: Mode = modes.includes(flags.mode as Mode) ? (flags.mode as Mode) : 'nature';
  let selected: string | null = null;
  const pins = new Pins(content, hf, exag, (id) => selectHotspot(id, true), { debug: flags.debug, pulse: !reducedMotion && tier.tier !== 'low' });
  stage.onAfterRender(() => pins.update(camera, canvas.clientWidth, canvas.clientHeight, camera.position.distanceTo(controls.target)));
  readout = new Readout((id) => selectHotspot(id, true), (x, z) => void startWalk(x, z));
  controls.addEventListener('start', () => readout.hide()); // any drag / pinch / wheel dismisses it
  // Panel + photo viewer + credits.json are code-split (CLAUDE.md M8): loaded on the first hotspot opening,
  // or prefetched once the scene has been idle for a moment.
  let panel: Panel | null = null;
  let viewer: PhotoViewer | null = null;
  let panelP: Promise<Panel> | null = null;
  const ensurePanel = () => (panelP ??= (async () => {
    const [{ Panel: PanelCls }, { PhotoViewer: ViewerCls }, credits] = await Promise.all([import('./ui/panel'), import('./ui/viewer'), loadCredits(BASE)]);
    viewer = new ViewerCls();
    panel = new PanelCls(content, credits, viewer, {
      onClose: () => selectHotspot(null, true),
      onNavigate: (id) => selectHotspot(id, true),
      onShowOnMap: (id) => { const h = content.hotspots.find((x) => x.id === id); if (h) flyTo(hotspotPose(h)); },
      onWalk: (id) => {
        const h = content.hotspots.find((x) => x.id === id);
        if (!h) return;
        // Markers of threatened species are already generalised in content.json (CLAUDE.md §10.2).
        const [x, z] = lonLatToXZ(h.lon, h.lat);
        void startWalk(x, z);
      },
      onObscure: (right, bottom) => stage.setViewInset(right, bottom, reducedMotion),
    }, flags.debug);
    return panel;
  })());
  onLang(() => {
    pins.relabel();
    panel?.relabel();
    readout.relabel();
    labels.relabel();
    viewer?.relabel();
    const h = content.hotspots.find((x) => x.id === selected);
    if (h) announce(t('status.opened', { title: loc(h, 'title', getLang()) }));
    stage.invalidate();
  });

  const hotspotPose = (h: Hotspot): OrbitPose => ({
    target: pins.worldOf(h.id)!,
    azimuthDeg: h.camera.azimuth_deg,
    elevationDeg: THREE.MathUtils.clamp(h.camera.elevation_deg, 15, 80),
    distance: Math.max(h.camera.distance_m, ORBIT.minDistance),
  });

  function selectHotspot(id: string | null, fromUser: boolean, focus = fromUser) {
    const h = id ? content.hotspots.find((x) => x.id === id) : undefined;
    selected = h ? h.id : null;
    pins.select(selected);
    const hash = selected ? `#/h/${selected}` : '';
    if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    readout.hide();
    if (h) {
      // The selected pin stays visible even outside the current mode (prev/next walk all 23 in order).
      const id = h.id;
      ensurePanel().then((p) => { if (selected === id) p.open(h, focus); }).catch((e) => console.error(e));
      flyTo(hotspotPose(h), fromUser ? 1200 : 0);
      announce(t('status.opened', { title: loc(h, 'title', getLang()) }));
      dismissHint();
    } else {
      panel?.close();
    }
    stage.invalidate();
  }

  function setMode(m: Mode, fromUser = true) {
    mode = m;
    chrome.setMode(m);
    pins.setMode(m);
    labels.setMode(m);
    const ms = fromUser && !reducedMotion ? 250 : 0;
    applyLook(m, ms);
    const fade = overlays?.setMode(m, ms);
    if (fade) stage.addAnimator(fade);
    const q = new URLSearchParams(location.search);
    if (m === 'nature') q.delete('mode'); else q.set('mode', m);
    const qs = q.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    // Keep the selection only if its hotspot belongs to the new mode.
    if (fromUser && selected && !pins.isInMode(selected)) selectHotspot(null, true);
    if (fromUser) announce(t('status.mode', { mode: t(`mode.${m}`) }));
    stage.invalidate();
  }

  const setAtmo = (next: AtmoName) => {
    const anim = atmo.transition(next, reducedMotion ? 0 : 1200);
    if (anim) stage.addAnimator(anim); else stage.invalidate();
    chrome.setAtmo(next);
    announce(t('status.atmo', { atmo: t(`atmo.${next}`) }));
  };
  const chrome = new Chrome({
    onAtmo: () => setAtmo(nextAtmo(atmo.name)),
    onReset: () => { selectHotspot(null, true); flyTo(homePose()); },
    onMode: (m) => setMode(m),
  });
  chrome.setAtmo(initialAtmo);
  setMode(mode, false);

  // ---- Walk mode (first-person, lazy-loaded) ----
  let walking: WalkHandle | null = null;
  let walkStarting = false;
  async function startWalk(x: number, z: number) {
    if (walking || walkStarting) return;
    walkStarting = true;
    readout.hide();
    if (selected) selectHotspot(null, true);
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    stage.suspend(true);
    document.body.classList.add('walking');
    try {
      const { enterWalk } = await import('./walk');
      let lastHash = 0;
      walking = await enterWalk({
        renderer: stage.renderer, hf, lcTex: terrainMat.uniforms.uLand.value as THREE.Texture, content, base: BASE,
        tier: stage.tier.tier, start: { x, z, yaw }, reducedMotion,
        onExit: () => {
          walking = null;
          document.body.classList.remove('walking');
          stage.suspend(false);
          history.replaceState(null, '', `${location.pathname}${location.search}`);
          canvas.focus({ preventScroll: true });
        },
        onPosition: (px, pz) => {
          const now = performance.now();
          if (now - lastHash < 1500) return;
          lastHash = now;
          const [lon, lat] = xzToLonLat(px, pz);
          history.replaceState(null, '', `${location.pathname}${location.search}#/walk/${lon.toFixed(5)},${lat.toFixed(5)}`);
        },
      });
    } catch (e) {
      console.error(e);
      document.body.classList.remove('walking');
      stage.suspend(false);
    } finally {
      walkStarting = false;
    }
  }

  // Zooming in past the closest orbit distance walks into the forest at the view centre.
  let zoomPush = 0;
  canvas.addEventListener('wheel', (e) => {
    if (walking || e.deltaY >= 0) { zoomPush = 0; return; }
    const d = camera.position.distanceTo(controls.target);
    if (d > ORBIT.minDistance * 1.08) { zoomPush = 0; return; }
    zoomPush += Math.min(200, -e.deltaY);
    if (zoomPush > 900) { zoomPush = 0; void startWalk(controls.target.x, controls.target.z); }
  }, { passive: true });

  const routeFromHash = () => {
    const w = /^#\/walk\/(-?[\d.]+),(-?[\d.]+)$/.exec(location.hash);
    if (w) {
      const [x, z] = lonLatToXZ(Number(w[1]), Number(w[2]));
      if (!walking) void startWalk(x, z);
      focusOnRoute = true;
      return;
    }
    const m = /^#\/h\/([a-z0-9-]+)$/.exec(location.hash);
    if (m) selectHotspot(m[1], true, focusOnRoute);
    focusOnRoute = true;
  };
  let focusOnRoute = false; // a deep link on page load must not grab focus
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || walking || document.querySelector('.title-card, dialog[open]')) return;
    if (readout.visible) { readout.hide(); return; }
    if (selected) selectHotspot(null, true);
  });

  // One-time "Tap a pin" hint (DESIGN.md §5).
  let hintEl: HTMLDivElement | null = null;
  function dismissHint() {
    if (!hintEl) return;
    const el = hintEl;
    hintEl = null;
    el.classList.add('gone');
    setTimeout(() => el.remove(), 500);
    try { localStorage.setItem('nimba.hint', '1'); } catch { /* ignore */ }
  }
  function showHint() {
    try { if (localStorage.getItem('nimba.hint')) return; } catch { /* ignore */ }
    hintEl = document.createElement('div');
    hintEl.className = 'hint';
    hintEl.textContent = t('pins.hint');
    document.body.append(hintEl);
    setTimeout(dismissHint, 6000);
  }

  let debugLines = () => '';
  if (flags.debug) {
    // M1 acceptance readout: richard-molard must sit on the highest DEM sample of the tile.
    const rm = content.hotspots.find((h) => h.id === 'richard-molard');
    const maxRow = Math.floor(hf.maxIndex / hf.size), maxCol = hf.maxIndex % hf.size;
    const [mx, mz] = hf.samplePos(maxCol, maxRow);
    // Test hook for scripts/check-*.mjs (debug builds only).
    (window as unknown as { __nimba: unknown }).__nimba = {
      project(lon: number, lat: number) {
        const [x, z] = lonLatToXZ(lon, lat);
        const v = new THREE.Vector3(x, hf.heightAt(x, z) * exag, z).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: Math.abs(v.z) <= 1 };
      },
      view(lon: number, lat: number, distance = 6000, azimuthDeg = 200, elevationDeg = 55) {
        const [x, z] = lonLatToXZ(lon, lat);
        readout.hide(); // like any camera move
        applyPose({ target: new THREE.Vector3(x, hf.heightAt(x, z) * exag, z), azimuthDeg, elevationDeg, distance });
        controls.update();
        stage.invalidate();
      },
      modeState() {
        return { mode, habitat: tu.uHabitat.value, tintAmount: tu.uTintAmount.value, sat: tu.uModeSat.value, overlays: overlays?.state ?? null,
          labels: [...document.querySelectorAll('.tlabel.on')].map((e) => e.textContent) };
      },
      frames() { return stage.frames; },
      quality() {
        return { tier: stage.tier.tier, segments: builtSegments, dpr: stage.renderer.getPixelRatio(), watchdog: watchdog?.history ?? null, panelLoaded: !!panel, landscape: terrainMat.uniforms.uLandscape.value, distantTrees: landscapeForest?.count ?? 0 };
      },
      target() { const [lon, lat] = xzToLonLat(controls.target.x, controls.target.z); return { lon, lat }; },
      async describe(lon: number, lat: number) {
        const [x, z] = lonLatToXZ(lon, lat);
        return describe(new THREE.Vector3(x, 0, z));
      },
      async walk(lon: number, lat: number) {
        const [x, z] = lonLatToXZ(lon, lat);
        await startWalk(x, z);
        return !!walking;
      },
      walkDebug() { return walking?.debug ?? null; },
    };
    const rmXZ = rm ? lonLatToXZ(rm.lon, rm.lat) : [0, 0];
    debugLines = () => `\nDEM max ${hf.max.toFixed(1)} m @ x ${mx.toFixed(0)} z ${mz.toFixed(0)}\n` +
      `richard-molard x ${rmXZ[0].toFixed(0)} z ${rmXZ[1].toFixed(0)} DEM ${rm ? hf.heightAt(rmXZ[0], rmXZ[1]).toFixed(1) : '-'} m`;
  }

  // ---- Quality tiers at runtime + FPS watchdog (M8, CLAUDE.md §7) ----
  // Step order high → mid → low: fewer terrain segments, lower DPR cap, fewer cloud layers, fewer/no shadow steps.
  const ORDER: Tier[] = ['high', 'mid', 'low'];
  let builtSegments = tier.segments;
  const setTier = (next: TierSpec) => {
    stage.tier = next;
    if (landscapeForest) landscapeForest.mesh.visible = next.tier === 'high';
    terrainMat.uniforms.uLandscape.value = next.tier === 'high' && landscapeForest ? 1 : 0;
    stage.resize(); // applies the new DPR cap
    if (next.segments !== builtSegments) {
      const old = terrain.geometry;
      terrain.geometry = buildTerrainGeometry(hf, next.segments, exag);
      old.dispose();
      builtSegments = next.segments;
    }
    if (terrainMat.defines.SHADOW_STEPS !== next.shadowSteps) {
      terrainMat.defines.SHADOW_STEPS = next.shadowSteps;
      terrainMat.needsUpdate = true;
    }
    clouds?.setCount(next.clouds);
    document.getElementById('pins')!.classList.toggle('no-pulse', reducedMotion || next.tier === 'low');
    stage.invalidate();
  };
  // Forced tiers (?tier=) are never overridden. The watchdog's result is saved for the next visit.
  const watchdog = flags.watchdog && !flags.tier ? new FpsWatchdog(() => {
    const i = ORDER.indexOf(stage.tier.tier);
    if (i < 0 || i >= ORDER.length - 1) return false;
    const next = TIERS[ORDER[i + 1]];
    setTier(next);
    saveTier(next.tier);
    return true;
  }) : null;
  if (watchdog) stage.onAfterRender(() => watchdog.frame(performance.now(), stage.frameDt, stage.continuous));

  // On-screen meter: ?fps=1 (for testing on real phones) or ?debug=1 (plus the M1 summit readout).
  if (flags.fps || flags.debug) {
    const fpsEl = document.createElement('div');
    fpsEl.className = 'fps';
    document.body.append(fpsEl);
    stage.onAfterRender(() => {
      const w = watchdog?.history.map((h) => `${h.fps.toFixed(0)}${h.stepped ? '↓' : '✓'}`).join(' ') ?? 'off';
      fpsEl.textContent = `${stage.fps ? stage.fps.toFixed(0) + ' fps' : 'idle'} · ${stage.tier.tier} · ${builtSegments}² · DPR ${stage.renderer.getPixelRatio().toFixed(2)}\n` +
        `watchdog ${w}${debugLines()}`;
    });
  }

  // Compile every shader before the first frame. With KHR_parallel_shader_compile (most browsers) this
  // happens off the main thread, so the page stays responsive while the GPU builds the programs. Without it
  // (some GPUs, SwiftShader) the first render compiles them, as before.
  mark('scene-ready');
  if (stage.renderer.extensions.has('KHR_parallel_shader_compile')) {
    try { await stage.renderer.compileAsync(scene, camera); } catch { /* compiled on first render instead */ }
  }
  mark('compiled');
  stage.start();
  // Ready once the first frame is on screen.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  mark('first-frame');
  hideLoading(introPending);
  document.body.dataset.ready = '1';
  // Prefetch the panel chunk + credits once the scene is up and the network is quiet.
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 1));
  setTimeout(() => idle(() => { ensurePanel().catch(() => { /* retried on first open */ panelP = null; }); }), 4000);

  // ---- Intro: title card → flyover → free orbit (M7) ----
  const pinsArrive = () => {
    const c = document.getElementById('pins')!;
    c.classList.add('arrive');
    setTimeout(() => c.classList.remove('arrive'), 2000);
  };
  const flyLog: number[] = [];
  let introPlanMin = NaN;
  const endIntro = () => {
    document.body.classList.remove('flying');
    if (overlays) overlays.group.visible = true;
    stage.invalidate();
    controls.autoRotate = false;
    pinsArrive();
    showHint();
  };
  const startFlyover = (after?: () => void) => {
    controls.autoRotate = false;
    if (reducedMotion) { applyPose(homePose()); controls.update(); stage.invalidate(); endIntro(); after?.(); return; }
    const home = homePose();
    const plan = planFlyover(hf, exag, { pos: camera.position.clone(), target: controls.target.clone() }, { pos: poseToPosition(home), target: home.target });
    introPlanMin = minClearance(plan, hf, exag);
    controls.enabled = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      subs.close();
      window.removeEventListener('pointerdown', skip, true);
      window.removeEventListener('keydown', onKey, true);
      endIntro();
      after?.();
    };
    const fly = runFlyover(plan, camera, controls.target, hf, exag, {
      onFrame: (tt, clearance) => { subs.update(tt); if (flags.debug) flyLog.push(clearance); },
      onDone: () => { controls.enabled = true; controls.update(); finish(); },
    });
    function skip() {
      if (finished) return;
      fly.stop();
      flyTo(homePose(), 900);
      finish();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(); } }
    const subs = new Subtitles(skip);
    // Any tap / click / Esc skips (CLAUDE.md §6.9). Registered after this click has finished bubbling.
    setTimeout(() => {
      window.addEventListener('pointerdown', skip, true);
      window.addEventListener('keydown', onKey, true);
    }, 0);
    stage.addAnimator(fly.animator);
  };

  // ---- Guided tour (flyover → four places on foot → back to the map) ----
  let tour: { stop: () => void } | null = null;
  async function startTour() {
    if (tour) return;
    if (selected) selectHotspot(null, true);
    readout.hide();
    const { runTour } = await import('./ui/tour');
    tour = runTour({
      content, reducedMotion, hold: new URLSearchParams(location.search).has('tourhold'),
      flyover: () => new Promise<void>((res) => {
        if (walking) { walking.exit(); }
        document.body.classList.add('flying');
        if (overlays) overlays.group.visible = false;
        startFlyover(res);
      }),
      enterWalk: async (x, z) => { await startWalk(x, z); return walking; },
      walking: () => walking,
      goHome: () => flyTo(homePose(), reducedMotion ? 0 : 1400),
    });
    const t0 = tour;
    const check = setInterval(() => { if (!document.querySelector('.tour')) { clearInterval(check); if (tour === t0) tour = null; } }, 1000);
  }
  chrome.onTour = () => void startTour();

  // A shared hotspot link opens straight on that hotspot: no title card, no flyover.
  if (location.hash) routeFromHash();
  if (introPending) {
    // Title card over the live terrain, seen from the flyover's start (NE, high), drifting slowly.
    const startPos = groundPoint(hf, exag, FLY_START.lon, FLY_START.lat, FLY_START.above);
    controls.target.copy(groundPoint(hf, exag, -8.40, 7.64));
    camera.position.copy(startPos);
    camera.lookAt(controls.target);
    controls.update();
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.15;
    // The drift is the only thing rendering behind the title card: pause it after 30 s without input
    // (battery), resume on any input while the card is still up.
    const pauseDrift = () => { if (Date.now() - lastTitleInput >= 30000 && document.body.classList.contains('flying')) controls.autoRotate = false; };
    let lastTitleInput = Date.now();
    const titleInput = () => {
      lastTitleInput = Date.now();
      if (document.querySelector('.title-card:not(.hidden)') && !reducedMotion) { controls.autoRotate = true; stage.invalidate(); setTimeout(pauseDrift, 30000); }
    };
    window.addEventListener('pointermove', titleInput, { passive: true });
    window.addEventListener('keydown', titleInput);
    setTimeout(pauseDrift, 30000);
    showTitleCard({
      onExplore: () => startFlyover(),
      onTour: () => void startTour(),
      tourFirst: location.hash === '#/tour',
      onSkip: () => { flyTo(homePose(), reducedMotion ? 0 : 1200); endIntro(); },
    });
  }

  if (flags.debug) {
    (window as unknown as { __nimbaFly: unknown }).__nimbaFly = () => ({ planMin: introPlanMin, frames: flyLog.length, frameMin: flyLog.length ? Math.min(...flyLog) : NaN });
  }
}

boot().catch((e) => {
  console.error(e);
  showFatal(t('loading.error'));
});
