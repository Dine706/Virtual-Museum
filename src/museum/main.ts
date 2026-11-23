// Virtual museum – Gallery 1 "La montagne / The Mountain". Entry point of musee.html.
// Loads the shared content (content.json, photo credits, DEM, land cover, boundaries, summit panorama),
// bakes the room's lighting, builds the gallery and hands control to the visitor.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '../styles.css';
import './museum.css';
import * as THREE from 'three';
import { applyStatic, getLang, onLang, t } from '../i18n';
import { BASE, flags, reducedMotion } from '../flags';
import { loadContent, loadCredits, loc, type Hotspot } from '../data/content';
import { decodePixels, fetchBlob } from '../data/loader';
import { Heightfield } from '../scene/heightfield';
import { WORLD_D, WORLD_W } from '../data/geo';
import { detectTier } from '../scene/tier';
import { BAKE_QUALITY, bakeLightmaps } from './bake';
import { buildRoom, galleryPlanes, panoSphere, type RoomTextures } from './room';
import { Relief } from './relief';
import { WallExhibits, drawHeading, drawIntro, type LabelText } from './exhibits';
import { MuseumUI } from './ui';
import { Visitor } from './nav';
import { EXHIBITS, HZ, INTRO, RELIEF, START_POSE, DOOR, buildSpots, exhibitPose } from './layout';

const loadingBar = document.getElementById('m-load-bar') as HTMLElement;
const loadingStatus = document.getElementById('m-load-status') as HTMLElement;
const setProgress = (f: number, text?: string) => {
  loadingBar.style.width = `${Math.round(Math.min(1, f) * 100)}%`;
  if (text) loadingStatus.textContent = text;
};

applyStatic();
document.title = t('museum.docTitle');

function webgl2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

const texLoader = new THREE.TextureLoader();
function loadTex(url: string, srgb: boolean, repeat = true): Promise<THREE.Texture> {
  return new Promise((res, rej) => texLoader.load(url, (tx) => {
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    res(tx);
  }, undefined, rej));
}

async function boot() {
  const tier = detectTier(flags.tier);
  const [content, credits, texCredits] = await Promise.all([
    loadContent(BASE), loadCredits(BASE),
    fetch(`${BASE}musee/tex/credits.json`).then((r) => r.json()),
  ]);
  const hot = new Map<string, Hotspot>(content.hotspots.map((h) => [h.id, h]));

  const fontsReady = Promise.all([
    document.fonts.load(`600 80px "Fraunces Variable"`), document.fonts.load(`400 30px "Inter Variable"`), document.fonts.load(`600 30px "Inter Variable"`),
  ]).catch(() => undefined);

  const reliefFacts = { scale: WORLD_W / RELIEF.size, exag: RELIEF.exag, minM: 0, maxM: 0, wKm: WORLD_W / 1000, dKm: WORLD_D / 1000 };
  const ui = new MuseumUI({
    content, credits, base: BASE, relief: reliefFacts, textureCredits: texCredits,
    onGo: (id) => go(id),
    onClose: () => {},
    onInset: (r, b) => setInset(r, b),
  });

  if (!webgl2()) {
    hideLoading();
    ui.fallback();
    go = (id) => ui.open(id);
    return;
  }

  // ---------------------------------------------------------------- downloads
  setProgress(0.03, t('museum.loading'));
  const terr = tier.tier === 'high' ? 'terrarium.png' : 'terrarium_504.png';
  const bytes = { terr: tier.terrariumBytes, lc: 76479 };
  let got = { terr: 0, lc: 0 };
  const prog = () => setProgress(0.05 + 0.45 * ((got.terr + got.lc) / (bytes.terr + bytes.lc)));
  const T = `${BASE}musee/tex/`;
  const [terrBlob, lcBlob, reserve, borders, pano, floorMap, floorNor, floorRough, plMap, plNor, oakMap, oakNor] = await Promise.all([
    fetchBlob(`${BASE}data/${terr}`, (l) => { got.terr = l; prog(); }, bytes.terr),
    fetchBlob(`${BASE}data/landcover_classes.png`, (l) => { got.lc = l; prog(); }, bytes.lc),
    fetch(`${BASE}data/reserve_boundary.geojson`).then((r) => r.json()),
    fetch(`${BASE}data/borders_clipped.geojson`).then((r) => r.json()),
    loadTex(`${BASE}pano/${tier.tier === 'high' ? 'summit.jpg' : 'summit_2k.jpg'}`, true, false),
    loadTex(`${T}floor_diff.webp`, true), loadTex(`${T}floor_nor.webp`, false), loadTex(`${T}floor_rough.webp`, false),
    loadTex(`${T}plaster_diff.webp`, true), loadTex(`${T}plaster_nor.webp`, false),
    loadTex(`${T}oak_diff.webp`, true), loadTex(`${T}oak_nor.webp`, false),
  ]);
  got = { terr: bytes.terr, lc: bytes.lc };
  setProgress(0.5);
  const [terrPx, lcPx] = await Promise.all([decodePixels(terrBlob), decodePixels(lcBlob)]);
  const hf = Heightfield.fromTerrarium(terrPx.data, terrPx.width);
  reliefFacts.minM = Math.round(hf.min);
  reliefFacts.maxM = Math.round(hf.max);

  // ---------------------------------------------------------------- renderer
  const canvas = document.getElementById('m-scene') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.dprCap));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const tx of [floorMap, floorNor, floorRough, plMap, plNor, oakMap, oakNor]) tx.anisotropy = aniso;
  pano.generateMipmaps = true;
  pano.minFilter = THREE.LinearMipmapLinearFilter;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f0c);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 700);

  // ---------------------------------------------------------------- light bake
  setProgress(0.55, t('museum.loadingLight'));
  const spots = buildSpots();
  const lights = {
    spots,
    spotColor: new THREE.Color(1.0, 0.88, 0.74),
    skyL: new THREE.Color(0.93, 0.97, 1.0).multiplyScalar(3.2),
    winGain: 1.05,
    ambient: new THREE.Color(0.98, 0.95, 0.9).multiplyScalar(1.05),
  };
  const planes = galleryPlanes();
  const q = BAKE_QUALITY[tier.tier];
  const t0 = performance.now();
  const bake = await bakeLightmaps(renderer, [...planes.values()], lights, pano, q, (f) => setProgress(0.55 + 0.3 * f));
  const bakeMs = performance.now() - t0;

  // ---------------------------------------------------------------- gallery
  const texs: RoomTextures = { floor: { map: floorMap, normal: floorNor, rough: floorRough }, plaster: { map: plMap, normal: plNor }, oak: { map: oakMap, normal: oakNor } };
  const room = buildRoom(planes, bake.texture, bake.intensity, texs, spots, lights.skyL);
  scene.add(room.group, panoSphere(pano, 1.25));

  const reliefSpots = spots.slice(-2);
  const relief = new Relief({
    hf, landcover: lcPx, reserve, borders, spots: reliefSpots, spotColor: lights.spotColor,
    skyE: lights.skyL.clone().multiplyScalar(0.55), ambient: lights.ambient,
    segments: tier.tier === 'high' ? 360 : tier.tier === 'mid' ? 256 : 160, anisotropy: aniso,
  });
  relief.top.userData.exhibit = 'relief';
  scene.add(relief.group);
  const printIds = EXHIBITS.filter((e) => e.kind === 'print');
  const markers = relief.addMarkers(printIds.map((e) => { const h = hot.get(e.hotspot!)!; return { id: e.id, order: h.order, lon: h.lon, lat: h.lat }; }));

  await fontsReady;
  const walls = new WallExhibits(planes, bake.texture, bake.intensity);
  scene.add(walls.group);
  const lang = () => getLang();
  const placeholder = new THREE.DataTexture(new Uint8Array([200, 198, 190, 255]), 1, 1);
  placeholder.needsUpdate = true;
  for (const e of printIds) {
    const h = hot.get(e.hotspot!)!;
    const c = credits.get(e.photo!)!;
    const label = (): LabelText => ({
      number: String(h.order),
      title: loc(h, 'title', lang()).split(' – ')[0],
      kicker: content.meta.categories[h.category][lang()],
      line: `${c.author} · ${c.license}`,
    });
    walls.addPrint({ def: e, aspect: c.width / c.height, number: h.order, title: '', kicker: '' }, placeholder, label);
  }
  // Introduction text (vinyl), headings, doorway sign.
  const intro = EXHIBITS[0];
  const redrawIntro = walls.addVinyl('west', intro.z!, INTRO.cy, INTRO.w, INTRO.h, (c) => drawIntro(c, {
    kicker: t('museum.intro.kicker'), title: t('museum.intro.title'),
    body: lang() === 'fr' ? content.meta.intro_fr : content.meta.intro_en,
    stats: content.meta.stats.slice(0, 4).map((s) => ({ value: s.value, label: lang() === 'fr' ? s.label_fr : s.label_en })), hint: '',
  }), 'intro', 460);
  const west = printIds.filter((e) => e.wall === 'west'), east = printIds.filter((e) => e.wall === 'east');
  const mid = (a: typeof west) => (a[0].z! + a[a.length - 1].z!) / 2;
  const redrawW = walls.addVinyl('west', mid(west), 2.92, 4.2, 0.44, (c) => drawHeading(c, t('museum.peaks'), t('museum.peaksSub')));
  const redrawE = walls.addVinyl('east', mid(east), 2.92, 4.2, 0.44, (c) => drawHeading(c, t('museum.habitats'), t('museum.habitatsSub')));
  const redrawDoor = walls.addVinyl('south', (DOOR.x0 + DOOR.x1) / 2, DOOR.h + 0.42, 4.2, 0.5, (c) => drawHeading(c, t('museum.nextGallery'), t('museum.nextGallerySub')));
  // The window and the relief are exhibits too.
  const winPick = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 4.5), new THREE.MeshBasicMaterial({ visible: false }));
  winPick.position.set(0, 2.25, -HZ + 0.05);
  winPick.userData.exhibit = 'window';
  scene.add(winPick);

  // Reflections: capture the finished room once into an environment map.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(scene, 0.02, 0.05, 400, { size: tier.tier === 'low' ? 128 : 256, position: new THREE.Vector3(0, 1.7, 1.5) });
  for (const m of [...room.envMaterials, ...walls.envMaterials]) { m.envMap = envRT.texture; m.needsUpdate = true; }
  pmrem.dispose();

  // ---------------------------------------------------------------- visitor + picking
  const pickables: THREE.Object3D[] = [...walls.pickables, ...markers, relief.top, winPick];
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...pickables, room.floor], false);
    return hits[0] ?? null;
  };
  let dirty = true;
  const invalidate = () => { dirty = true; };
  // Portrait screens see more ceiling: start looking a little lower.
  const start = innerWidth < innerHeight ? { ...START_POSE, pitch: -0.3 } : START_POSE;
  const visitor = new Visitor(camera, canvas, start, {
    onTap: (x, y) => {
      const h = pick(x, y);
      if (!h) return;
      const id = h.object.userData.exhibit as string | undefined;
      if (id) { go(id); return; }
      if (h.object === room.floor) {
        if (ui.cardOpen && innerWidth < 900) ui.close();
        visitor.walkTo(h.point.x, h.point.z);
        ui.dismissHint();
      }
    },
    onMove: invalidate,
    onInteract: () => ui.dismissHint(),
  }, reducedMotion);
  if (flags.debug) (window as unknown as { __museum: unknown }).__museum = { visitor, bakeMs, atlas: bake.size, tier: tier.tier, renderer };

  go = (id: string) => {
    const e = EXHIBITS.find((x) => x.id === id);
    if (!e) return;
    ui.open(id, true);
    ui.dismissHint();
    visitor.glideTo(exhibitPose(e), 1300);
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(8);
    invalidate();
  };
  function setInset(right: number, bottom: number) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (right > 0) camera.setViewOffset(w + right, h, right, 0, w, h);
    else if (bottom > 0) camera.setViewOffset(w, h + bottom * 0.75, 0, bottom * 0.75, w, h);
    else camera.clearViewOffset();
    invalidate();
  }

  // Hover feedback on desktop: pointer cursor on exhibits, a ring where a click would walk to.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) { if (ring.visible) { ring.visible = false; invalidate(); } return; }
    const h = pick(e.clientX, e.clientY);
    const ex = !!h?.object.userData.exhibit;
    canvas.style.cursor = ex ? 'pointer' : h ? 'crosshair' : '';
    const show = !!h && h.object === room.floor;
    if (show) ring.position.set(h!.point.x, 0.004, h!.point.z);
    if (show || ring.visible) { ring.visible = show; invalidate(); }
  });
  canvas.addEventListener('pointerleave', () => { if (ring.visible) { ring.visible = false; invalidate(); } });

  onLang(() => {
    walls.relabel();
    redrawIntro(); redrawW(); redrawE(); redrawDoor();
    invalidate();
  });

  // ---------------------------------------------------------------- render loop (on demand)
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visitor.apply();
    invalidate();
  };
  window.addEventListener('resize', resize);
  resize();
  let last = performance.now();
  let fpsEl: HTMLElement | null = null;
  let frames = 0, fpsT = last;
  if (flags.debug || flags.fps) { fpsEl = document.createElement('div'); fpsEl.className = 'fps'; document.body.append(fpsEl); }
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (visitor.update(dt, now)) dirty = true;
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
      frames++;
    }
    if (fpsEl && now - fpsT > 1000) {
      fpsEl.textContent = `${frames} fps · ${tier.tier} · bake ${bakeMs.toFixed(0)} ms (${bake.size}²) · DPR ${renderer.getPixelRatio()}`;
      frames = 0; fpsT = now;
    }
    requestAnimationFrame(loop);
  };
  setProgress(0.9);
  if (renderer.extensions.has('KHR_parallel_shader_compile')) { try { await renderer.compileAsync(scene, camera); } catch { /* compiled on first render */ } }
  requestAnimationFrame(loop);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  setProgress(1);
  hideLoading();
  document.body.dataset.ready = '1';

  // Deep link (#/e/<id>) or the hint.
  const m = /^#\/e\/([a-z0-9-]+)$/.exec(location.hash);
  if (m && EXHIBITS.some((e) => e.id === m[1])) {
    const e = EXHIBITS.find((x) => x.id === m[1])!;
    ui.open(e.id, false);
    visitor.glideTo(exhibitPose(e), 0);
  } else ui.showHint();
  window.addEventListener('hashchange', () => {
    const mm = /^#\/e\/([a-z0-9-]+)$/.exec(location.hash);
    if (mm && EXHIBITS[ui.current]?.id !== mm[1]) go(mm[1]);
  });

  // ---------------------------------------------------------------- photos: thumbnails, then full size
  const loadPhoto = (url: string) => loadTex(url, true, false).then((tx) => { tx.anisotropy = aniso; return tx; });
  const ext = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') ? 'webp' : 'jpg';
  await Promise.all(printIds.map(async (e) => {
    try { walls.setPhoto(e.id, await loadPhoto(`${BASE}photos/thumb/${e.photo}.${ext}`)); invalidate(); } catch (err) { console.warn(err); }
  }));
  for (const e of printIds) {
    try { walls.setPhoto(e.id, await loadPhoto(`${BASE}photos/${e.photo}.${ext}`)); invalidate(); } catch (err) { console.warn(err); }
  }
}

// Assigned once the scene exists; before that, navigation only opens cards.
let go: (id: string) => void = () => {};

function hideLoading() {
  const l = document.getElementById('m-loading');
  if (!l) return;
  l.classList.add('done');
  setTimeout(() => l.remove(), 900);
}

boot().catch((e) => {
  console.error(e);
  setProgress(1, t('museum.error'));
});
