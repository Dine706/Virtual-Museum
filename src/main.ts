import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import * as THREE from 'three';
import { applyStatic } from './i18n';
import { hideLoading, Progress, setLoadingText, showFatal } from './ui/loading';
import { showTitleCard } from './ui/titlecard';
import { BASE, flags, reducedMotion } from './flags';
import { t } from './i18n';
import { checkMeta, lonLatToXZ, type TerrainMeta } from './data/geo';
import { loadContent } from './data/content';
import { decodePixels, fetchBlob } from './data/loader';
import { Heightfield } from './scene/heightfield';
import { Landcover } from './scene/landcover';
import { buildTerrainGeometry } from './scene/terrain';
import { Stage } from './scene/stage';
import { detectTier } from './scene/tier';
import { DEFAULT_EXAG, HOME_VIEW } from './scene/config';
import { clampCamera, currentPose, poseToPosition, tweenPose, type OrbitPose } from './scene/camera';
import { ATMO_ORDER, Atmosphere, nextAtmo, type AtmoName } from './scene/atmosphere';
import { createTerrainMaterial } from './scene/terrainMaterial';
import { Clouds, createSky } from './scene/sky';
import { announce, Chrome } from './ui/chrome';

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
      elevationDeg: portrait ? HOME_VIEW.elevationDeg + 8 : HOME_VIEW.elevationDeg,
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

  const chrome = new Chrome({
    onAtmo: () => {
      const next = nextAtmo(atmo.name);
      const anim = atmo.transition(next, reducedMotion ? 0 : 1200);
      if (anim) stage.addAnimator(anim); else stage.invalidate();
      chrome.setAtmo(next);
      announce(t('status.atmo', { atmo: t(`atmo.${next}`) }));
    },
    onReset: () => flyTo(homePose()),
    onMode: (m) => chrome.setMode(m),
  });
  chrome.setAtmo(initialAtmo);
  chrome.setMode('nature');

  if (flags.debug) {
    // M1 acceptance: a marker at richard-molard must sit on the highest DEM sample of the tile.
    const rm = content.hotspots.find((h) => h.id === 'richard-molard');
    const maxRow = Math.floor(hf.maxIndex / hf.size), maxCol = hf.maxIndex % hf.size;
    const [mx, mz] = hf.samplePos(maxCol, maxRow);
    const mark = (x: number, z: number, color: string) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(70, 500, 12), new THREE.MeshBasicMaterial({ color, fog: false }));
      m.rotation.x = Math.PI;
      m.position.set(x, hf.heightAt(x, z) * exag + 250, z);
      scene.add(m);
    };
    mark(mx, mz, '#ff2a2a');
    if (rm) { const [x, z] = lonLatToXZ(rm.lon, rm.lat); mark(x, z, '#2aa8ff'); }
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

  if (!flags.skipIntro) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    const stopSpin = () => { controls.autoRotate = false; };
    showTitleCard({ onExplore: stopSpin, onSkip: stopSpin });
  }
}

boot().catch((e) => {
  console.error(e);
  showFatal(t('loading.error'));
});
