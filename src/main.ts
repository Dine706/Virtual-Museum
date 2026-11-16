import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import * as THREE from 'three';
import { applyStatic, getLang, onLang } from './i18n';
import { hideLoading, Progress, setLoadingText, showFatal } from './ui/loading';
import { showTitleCard } from './ui/titlecard';
import { BASE, flags, reducedMotion } from './flags';
import { t } from './i18n';
import { checkMeta, lonLatToXZ, type TerrainMeta } from './data/geo';
import { loadContent, loc, type Hotspot, type Mode } from './data/content';
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

  const [meta, content, terrBlob, lcBlob] = await Promise.all([
    fetch(`${BASE}data/terrain_meta.json`).then((r) => r.json() as Promise<TerrainMeta>),
    loadContent(BASE),
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
    if (reducedMotion) { applyPose(to); stage.invalidate(); return; }
    controls.enabled = false;
    stage.addAnimator(tweenPose(currentPose(camera, controls.target), to, ms, applyPose, () => { controls.enabled = true; }));
  };

  // ---- Pins, modes, selection, deep links ----
  const modes: Mode[] = ['nature', 'culture', 'conservation'];
  let mode: Mode = modes.includes(flags.mode as Mode) ? (flags.mode as Mode) : 'nature';
  let selected: string | null = null;
  const pins = new Pins(content, hf, exag, (id) => selectHotspot(id, true), { debug: flags.debug, pulse: !reducedMotion && tier.tier !== 'low' });
  stage.onAfterRender(() => pins.update(camera, canvas.clientWidth, canvas.clientHeight, camera.position.distanceTo(controls.target)));
  onLang(() => { pins.relabel(); stage.invalidate(); });

  const hotspotPose = (h: Hotspot): OrbitPose => ({
    target: pins.worldOf(h.id)!,
    azimuthDeg: h.camera.azimuth_deg,
    elevationDeg: THREE.MathUtils.clamp(h.camera.elevation_deg, 15, 80),
    distance: Math.max(h.camera.distance_m, ORBIT.minDistance),
  });

  function selectHotspot(id: string | null, fromUser: boolean) {
    const h = id ? content.hotspots.find((x) => x.id === id) : undefined;
    selected = h ? h.id : null;
    pins.select(selected);
    const hash = selected ? `#/h/${selected}` : '';
    if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    if (h) {
      if (!h.modes.includes(mode)) setMode(h.modes[0], false);
      flyTo(hotspotPose(h), fromUser ? 1200 : 0);
      announce(t('status.opened', { title: loc(h, 'title', getLang()) }));
      dismissHint();
    }
    stage.invalidate();
  }

  function setMode(m: Mode, fromUser = true) {
    mode = m;
    chrome.setMode(m);
    pins.setMode(m);
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
    if (m) selectHotspot(m[1], true);
  };
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected && !document.querySelector('.title-card')) selectHotspot(null, true);
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
