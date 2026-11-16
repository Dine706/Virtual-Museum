import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles.css';
import * as THREE from 'three';
import { applyStatic } from './i18n';
import { hideLoading, Progress, setLoadingText, showFatal } from './ui/loading';
import { showTitleCard } from './ui/titlecard';
import { BASE, flags } from './flags';
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
import { clampCamera, poseToPosition, type OrbitPose } from './scene/camera';

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

  // M1: plain lit terrain. (M2 replaces the material with the atmosphere shader.)
  scene.background = new THREE.Color('#BFD3E0');
  scene.fog = new THREE.Fog('#BFD3E0', 20000, 60000);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(-0.55, 0.62, 0.55).multiplyScalar(10000);
  scene.add(sun, new THREE.HemisphereLight('#cfe0ee', '#3a4a2a', 1.1));
  const geom = buildTerrainGeometry(hf, tier.segments, exag);
  const mat = new THREE.MeshStandardMaterial({ map: lc.toTexture(), roughness: 0.95, metalness: 0 });
  const terrain = new THREE.Mesh(geom, mat);
  scene.add(terrain);

  // Home orbit.
  const [tx, tz] = lonLatToXZ(HOME_VIEW.target.lon, HOME_VIEW.target.lat);
  const home: OrbitPose = { target: new THREE.Vector3(tx, HOME_VIEW.target.h * exag, tz), azimuthDeg: HOME_VIEW.azimuthDeg, elevationDeg: HOME_VIEW.elevationDeg, distance: HOME_VIEW.distance };
  controls.target.copy(home.target);
  poseToPosition(home, camera.position);
  camera.lookAt(home.target);
  controls.update();
  stage.onBeforeRender(() => clampCamera(camera, controls.target, hf, exag));

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
      fpsEl.textContent = `${stage.fps.toFixed(0)} fps · tier ${tier.tier} · ${tier.segments}²\n` +
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
