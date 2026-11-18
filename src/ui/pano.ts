// 360° viewer for the photo-real panoramas rendered offline in Blender (scripts/blender/nimba_render.py).
// Equirectangular image on the inside of a sphere; drag (mouse/touch) or arrow keys to look around, wheel or
// pinch to zoom, optional device tilt on phones. The image is a computer-generated view built from the real
// terrain and land-cover data with generic CC0 plants – the caption says so.
import * as THREE from 'three';
import { t } from '../i18n';
import { icons } from './icons';

export interface PanoEntry {
  id: string; lon: number; lat: number;
  /** walk-mode yaw of the image centre */
  yaw: number;
  /** image paths (relative to the site base) by width */
  src: { lg: string; sm: string };
  title_fr: string; title_en: string;
}

let registry: Promise<PanoEntry[]> | null = null;
export function loadPanos(base: string): Promise<PanoEntry[]> {
  registry ??= fetch(`${base}pano/panos.json`).then((r) => (r.ok ? r.json() : [])).then((j) => j.panos ?? []).catch(() => []);
  return registry;
}

export function openPano(entry: PanoEntry, base: string, lang: 'fr' | 'en', reducedMotion: boolean): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'pano-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', lang === 'fr' ? entry.title_fr : entry.title_en);
    el.innerHTML = `
      <canvas class="pano-canvas" aria-hidden="true"></canvas>
      <div class="pano-top">
        <div class="pano-title"><strong></strong><span></span></div>
        <div class="pano-actions">
          <button type="button" class="walk-btn pano-gyro" hidden></button>
          <button type="button" class="walk-btn pano-close"></button>
        </div>
      </div>
      <p class="pano-loading"></p>
      <p class="pano-hint"></p>`;
    document.body.append(el);
    const canvas = el.querySelector<HTMLCanvasElement>('.pano-canvas')!;
    el.querySelector('.pano-title strong')!.textContent = lang === 'fr' ? entry.title_fr : entry.title_en;
    el.querySelector('.pano-title span')!.textContent = t('pano.caption');
    const closeBtn = el.querySelector<HTMLButtonElement>('.pano-close')!;
    closeBtn.innerHTML = `${icons.close}<span>${t('pano.close')}</span>`;
    closeBtn.setAttribute('aria-label', t('pano.close'));
    const gyroBtn = el.querySelector<HTMLButtonElement>('.pano-gyro')!;
    gyroBtn.textContent = t('pano.gyro');
    const loading = el.querySelector<HTMLParagraphElement>('.pano-loading')!;
    loading.textContent = t('pano.loading');
    const hint = el.querySelector<HTMLParagraphElement>('.pano-hint')!;
    hint.textContent = t(matchMedia('(pointer: coarse)').matches ? 'pano.hint.touch' : 'pano.hint.desktop');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    const geo = new THREE.SphereGeometry(50, 64, 32);
    geo.scale(-1, 1, 1); // view from inside
    const mat = new THREE.MeshBasicMaterial({ color: 0x16210f });
    scene.add(new THREE.Mesh(geo, mat));

    // lon = 0 looks at the image centre (the spot's walk direction); positive = to the right
    let lon = 0, lat = 0, fov = 70, dirty = true, closed = false;
    const big = Math.max(innerWidth, innerHeight) > 1000; // laptops and tablets: large image; phones: the 2k one
    new THREE.TextureLoader().load(`${base}${big ? entry.src.lg : entry.src.sm}`, (tex) => {
      if (closed) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      loading.hidden = true; dirty = true;
      setTimeout(() => hint.classList.add('fade'), 5000);
    }, undefined, () => { loading.textContent = t('pano.error'); });

    const resize = () => {
      renderer.setSize(innerWidth, innerHeight, false);
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
      dirty = true;
    };
    resize();
    addEventListener('resize', resize);

    const target = new THREE.Vector3();
    const draw = () => {
      if (closed) return;
      requestAnimationFrame(draw);
      if (!dirty) return;
      dirty = false;
      lat = THREE.MathUtils.clamp(lat, -85, 85);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      // three's sphere maps the image centre to −X once mirrored for the inside view
      const phi = THREE.MathUtils.degToRad(90 - lat), theta = THREE.MathUtils.degToRad(lon + 180);
      target.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      cam.lookAt(target);
      renderer.render(scene, cam);
    };
    draw();

    // drag / pinch
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const onDown = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); hint.classList.add('fade'); };
    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const [c, d] = [...pts.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (pinch) fov = THREE.MathUtils.clamp(fov * d0 / Math.max(d1, 1), 30, 95);
        pinch = 1; dirty = true;
        return;
      }
      const k = fov / innerHeight;
      lon -= (e.clientX - p.x) * k;
      lat += (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
      dirty = true;
    };
    const onUp = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); fov = THREE.MathUtils.clamp(fov + e.deltaY * 0.04, 30, 95); dirty = true; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // keyboard (captured so the walk view and the tour behind do not react)
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 15 : 5;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') lon -= step;
      else if (e.key === 'ArrowRight') lon += step;
      else if (e.key === 'ArrowUp') lat += step;
      else if (e.key === 'ArrowDown') lat -= step;
      else if (e.key === '+' || e.key === '=') fov = Math.max(30, fov - 5);
      else if (e.key === '-') fov = Math.min(95, fov + 5);
      else return;
      e.preventDefault(); e.stopImmediatePropagation(); dirty = true;
    };
    addEventListener('keydown', onKey, true);

    // device tilt (phones; iOS asks for permission on a tap)
    let gyro = false, base0: number | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (!gyro || e.alpha == null || e.beta == null) return;
      const heading = -e.alpha;
      base0 ??= heading - lon;
      lon = heading - base0;
      lat = THREE.MathUtils.clamp(e.beta - 90, -85, 85);
      dirty = true;
    };
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (matchMedia('(hover: none) and (pointer: coarse)').matches && 'DeviceOrientationEvent' in window && !reducedMotion) {
      gyroBtn.hidden = false;
      gyroBtn.addEventListener('click', async () => {
        if (!gyro && DOE?.requestPermission) { try { if (await DOE.requestPermission() !== 'granted') return; } catch { return; } }
        gyro = !gyro; base0 = null;
        gyroBtn.classList.toggle('on', gyro);
        gyroBtn.setAttribute('aria-pressed', String(gyro));
      });
      addEventListener('deviceorientation', onOrient);
    }

    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtn.addEventListener('click', () => close());
    closeBtn.focus({ preventScroll: true });
    requestAnimationFrame(() => el.classList.add('on'));

    function close() {
      if (closed) return;
      closed = true;
      removeEventListener('keydown', onKey, true);
      removeEventListener('resize', resize);
      removeEventListener('deviceorientation', onOrient);
      mat.map?.dispose(); mat.dispose(); geo.dispose(); renderer.dispose();
      renderer.forceContextLoss();
      el.classList.remove('on');
      setTimeout(() => el.remove(), 300);
      prevFocus?.focus?.({ preventScroll: true });
      resolve();
    }
  });
}
