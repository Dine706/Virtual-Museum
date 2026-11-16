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
import { Overlays } from './scene/overlays';
import { TerrainLabels } from './ui/labels';
import { Legend } from './ui/legend';
import { loadContent, loadCredits, loc, type Hotspot, type Mode } from './data/content';
import { decodePixels, fetchBlob } from './data/loader';
import { Heightfield } from './scene/heightfield';
import { Landcover } from './scene/landcover';
import { buildTerrainGeometry } from './scene/terrain';
import { Stage } from './scene/stage';
import { detectTier } from './scene/tier';
import { DEFAULT_EXAG, HOME_VIEW, ORBIT } from './scene/config';
import { clampCamera, currentPose, poseToPosition, tweenPose, type OrbitPose } from './scene/camera';
import { ATMO_ORDER, Atmosphere, nextAtmo, type AtmoName } from './scene/atmosphere';
import { createTerrainMaterial } from './scene/terrainMaterial';
import { Clouds, createSky } from './scene/sky';
import { announce, Chrome } from './ui/chrome';
import { Pins } from './ui/pins';
import { Panel } from './ui/panel';
import { PhotoViewer } from './ui/viewer';

setLoadingText();
applyStatic();

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

async function boot() {
  if (!webglAvailable()) { showFatal(t('loading.error')); return; }
  const tier = detectTier(flags.tier);
  const exag = DEFAULT_EXAG;
  const progress = new Progress();

  const [meta, content, credits, terrBlob, lcBlob] = await Promise.all([
    fetch(`${BASE}data/terrain_meta.json`).then((r) => r.json() as Promise<TerrainMeta>),
    loadContent(BASE),
    loadCredits(BASE),
    fetchBlob(`${BASE}data/${tier.terrarium}`, progress.track('terrain', tier.terrariumBytes), tier.terrariumBytes),
    fetchBlob(`${BASE}data/landcover_classes.png`, progress.track('landcover', 76479), 76479),
  ]);
  const issues = checkMeta(meta);
  if (issues.length) console.warn('terrain_meta.json:', issues.join('; '));

  const [terrPx, lcPx] = await Promise.all([decodePixels(terrBlob), decodePixels(lcBlob)]);
  const hf = Heightfield.fromTerrarium(terrPx.data, terrPx.width);
  const lc = Landcover.fromPixels(lcPx.data, lcPx.width);

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const stage = new Stage(canvas, tier);
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
  scene.add(createSky(atmo), terrain);
  if (tier.clouds > 0) scene.add(new Clouds(atmo, terrainMat.uniforms.uHeight.value, tier.clouds).group);

  // Cloud/mist drift. High tier animates continuously; elsewhere time only advances while rendering
  // (render-on-demand). No drift at all under prefers-reduced-motion.
  if (!reducedMotion) {
    if (tier.tier === 'high') stage.addAnimator((dt) => { atmo.uniforms.uTime.value += dt; return true; });
    else stage.onBeforeRender(() => { atmo.uniforms.uTime.value += 1 / 30; });
  }

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
    };
  };

  let down: { x: number; y: number; t: number; id: number } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  });
  canvas.addEventListener('pointerup', async (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 450) return;
    const now = performance.now();
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

  // ---- Overlays, terrain labels, legend (M6) ----
  let overlays: Overlays | null = null;
  const labels = new TerrainLabels(hf, exag);
  stage.onAfterRender(() => labels.update(camera, canvas.clientWidth, canvas.clientHeight));
  const sizeOverlays = () => overlays?.setResolution(canvas.clientWidth, canvas.clientHeight);
  window.addEventListener('resize', sizeOverlays);
  regionsP.then((r) => {
    overlays = new Overlays(r, hf, exag);
    scene.add(overlays.group);
    sizeOverlays();
    overlays.precompile(stage.renderer, scene, camera);
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
    stage.addAnimator((_dt, now) => { const t = Math.min(1, (now - start) / ms); set(t * t * (3 - 2 * t)); return t < 1; });
  };

  // ---- Pins, modes, selection, deep links ----
  const modes: Mode[] = ['nature', 'culture', 'conservation'];
  let mode: Mode = modes.includes(flags.mode as Mode) ? (flags.mode as Mode) : 'nature';
  let selected: string | null = null;
  const pins = new Pins(content, hf, exag, (id) => selectHotspot(id, true), { debug: flags.debug, pulse: !reducedMotion && tier.tier !== 'low' });
  stage.onAfterRender(() => pins.update(camera, canvas.clientWidth, canvas.clientHeight, camera.position.distanceTo(controls.target)));
  readout = new Readout((id) => selectHotspot(id, true));
  const legend = new Legend(() => selectHotspot('danger-list', true));
  controls.addEventListener('start', () => readout.hide()); // any drag / pinch / wheel dismisses it
  const viewer = new PhotoViewer();
  const panel = new Panel(content, credits, viewer, {
    onClose: () => selectHotspot(null, true),
    onNavigate: (id) => selectHotspot(id, true),
    onShowOnMap: (id) => { const h = content.hotspots.find((x) => x.id === id); if (h) flyTo(hotspotPose(h)); },
    onObscure: (right, bottom) => stage.setViewInset(right, bottom, reducedMotion),
  }, flags.debug);
  onLang(() => {
    pins.relabel();
    panel.relabel();
    readout.relabel();
    labels.relabel();
    legend.relabel();
    viewer.relabel();
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
      panel.open(h, focus);
      flyTo(hotspotPose(h), fromUser ? 1200 : 0);
      announce(t('status.opened', { title: loc(h, 'title', getLang()) }));
      dismissHint();
    } else {
      panel.close();
    }
    stage.invalidate();
  }

  function setMode(m: Mode, fromUser = true) {
    mode = m;
    chrome.setMode(m);
    pins.setMode(m);
    labels.setMode(m);
    legend.setMode(m);
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

  const chrome = new Chrome({
    onAtmo: () => {
      const next = nextAtmo(atmo.name);
      const anim = atmo.transition(next, reducedMotion ? 0 : 1200);
      if (anim) stage.addAnimator(anim); else stage.invalidate();
      chrome.setAtmo(next);
      announce(t('status.atmo', { atmo: t(`atmo.${next}`) }));
    },
    onReset: () => { selectHotspot(null, true); flyTo(homePose()); },
    onMode: (m) => setMode(m),
  });
  chrome.setAtmo(initialAtmo);
  setMode(mode, false);

  const routeFromHash = () => {
    const m = /^#\/h\/([a-z0-9-]+)$/.exec(location.hash);
    if (m) selectHotspot(m[1], true, focusOnRoute);
    focusOnRoute = true;
  };
  let focusOnRoute = false; // a deep link on page load must not grab focus
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('.title-card, dialog[open]')) return;
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
          labels: [...document.querySelectorAll('.tlabel.on')].map((e) => e.textContent), legend: document.querySelector('.legend-body')?.textContent ?? '' };
      },
      target() { const [lon, lat] = xzToLonLat(controls.target.x, controls.target.z); return { lon, lat }; },
      async describe(lon: number, lat: number) {
        const [x, z] = lonLatToXZ(lon, lat);
        return describe(new THREE.Vector3(x, 0, z));
      },
    };
    const fpsEl = document.createElement('div');
    fpsEl.className = 'fps';
    document.body.append(fpsEl);
    const rmXZ = rm ? lonLatToXZ(rm.lon, rm.lat) : [0, 0];
    stage.onAfterRender(() => {
      fpsEl.textContent = `${stage.fps ? stage.fps.toFixed(0) + ' fps' : 'idle'} · tier ${tier.tier} · ${tier.segments}²\n` +
        `DEM max ${hf.max.toFixed(1)} m @ x ${mx.toFixed(0)} z ${mz.toFixed(0)}\n` +
        `richard-molard x ${rmXZ[0].toFixed(0)} z ${rmXZ[1].toFixed(0)} DEM ${rm ? hf.heightAt(rmXZ[0], rmXZ[1]).toFixed(1) : '-'} m`;
    });
  }

  stage.start();
  // Ready once the first frame is on screen.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  hideLoading();
  document.body.dataset.ready = '1';

  if (location.hash) routeFromHash();
  if (!flags.skipIntro) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    const done = () => { controls.autoRotate = false; showHint(); };
    showTitleCard({ onExplore: done, onSkip: done });
  }
}

boot().catch((e) => {
  console.error(e);
  showFatal(t('loading.error'));
});
