// Hotspot pins as real DOM buttons positioned from project() each rendered frame (CLAUDE.md §6.6, DESIGN.md §6).
// Crisp text, keyboard/screen-reader accessible, no sprites. Pins behind a ridge fade and stop taking clicks.
import * as THREE from 'three';
import { lonLatToXZ } from '../data/geo';
import { loc, type Content, type Hotspot, type Mode } from '../data/content';
import { getLang, t } from '../i18n';
import { categoryColor, glyphs } from './icons';
import type { Heightfield } from '../scene/heightfield';

interface PinEl {
  h: Hotspot;
  root: HTMLDivElement;
  btn: HTMLButtonElement;
  label: HTMLSpanElement;
  halo: HTMLDivElement | null;
  world: THREE.Vector3;
  visible: boolean; // passes the mode filter
}

const HALO_RADIUS_M = 600; // generalised / area hotspots (DESIGN.md §6)

export class Pins {
  private pins: PinEl[] = [];
  private container = document.getElementById('pins')!;
  private selected: string | null = null;
  private v = new THREE.Vector3();
  private right = new THREE.Vector3();
  private mode: Mode = 'nature';

  constructor(
    content: Content,
    private hf: Heightfield,
    private exag: number,
    private onSelect: (id: string) => void,
    opts: { debug: boolean; pulse: boolean },
  ) {
    if (!opts.pulse) this.container.classList.add('no-pulse');
    for (const h of content.hotspots) {
      const [x, z] = lonLatToXZ(h.lon, h.lat);
      // Anchor on the rendered surface (DEM), not on the published elevation, so pins sit on the ground.
      const world = new THREE.Vector3(x, hf.heightAt(x, z) * exag, z);
      const root = document.createElement('div');
      root.className = 'pin';
      root.dataset.id = h.id;
      root.style.setProperty('--cat', categoryColor[h.category]);
      root.style.setProperty('--delay', `${(h.order * 0.17) % 2.4}s`);
      const generalised = h.location_precision === 'area' || h.location_precision === 'symbolic';
      let halo: HTMLDivElement | null = null;
      if (generalised) {
        halo = document.createElement('div');
        halo.className = 'halo';
        root.append(halo);
      } else {
        const ground = document.createElement('span');
        ground.className = 'ground';
        root.append(ground);
      }
      const stem = document.createElement('span');
      stem.className = 'stem';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = `<span class="head">${opts.pulse ? '<span class="pulse"></span>' : ''}${glyphs[h.category]}<span class="num">${h.order}</span></span>`;
      const label = document.createElement('span');
      label.className = 'label';
      label.setAttribute('aria-hidden', 'true');
      btn.append(label);
      if (opts.debug && h.uncertain.length) {
        const vb = document.createElement('span');
        vb.className = 'verify-badge';
        vb.textContent = '!';
        vb.setAttribute('aria-hidden', 'true');
        btn.title = `${t('debug.verify')} :\n${h.uncertain.join('\n')}`;
        btn.append(vb);
      }
      btn.addEventListener('click', () => {
        if ('vibrate' in navigator && matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(8);
        this.onSelect(h.id);
      });
      root.append(stem, btn);
      this.container.append(root);
      this.pins.push({ h, root, btn, label, halo, world, visible: true });
    }
    this.relabel();
  }

  /** Update texts after a language switch. */
  relabel() {
    const lang = getLang();
    for (const p of this.pins) {
      const title = loc(p.h, 'title', lang);
      p.label.textContent = title;
      const precision = p.h.location_precision === 'exact' ? '' : ` – ${t(`precision.${p.h.location_precision}`)}`;
      p.btn.setAttribute('aria-label', `${p.h.order}. ${t('pins.open', { title })}${precision}`);
    }
  }

  setMode(m: Mode) {
    this.mode = m;
    for (const p of this.pins) {
      p.visible = p.h.modes.includes(m) || p.h.id === this.selected;
      p.root.hidden = !p.visible;
    }
  }

  isInMode(id: string) {
    const p = this.pins.find((q) => q.h.id === id);
    return !!p && p.h.modes.includes(this.mode);
  }

  select(id: string | null) {
    this.selected = id;
    for (const p of this.pins) p.root.classList.toggle('selected', p.h.id === id);
    this.container.classList.toggle('has-selection', id !== null);
    this.setMode(this.mode);
  }

  worldOf(id: string): THREE.Vector3 | null {
    return this.pins.find((p) => p.h.id === id)?.world.clone() ?? null;
  }

  /** Called after each rendered frame. */
  update(camera: THREE.PerspectiveCamera, viewW: number, viewH: number, cameraDistance: number) {
    const narrow = viewW < 600;
    const badge = narrow && cameraDistance > 9000;
    const minGap = narrow ? 34 : 40;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    const placed: { x: number; y: number }[] = [];
    // Selected first, then by order (1 = most important) for decluttering priority.
    const sorted = [...this.pins].sort((a, b) => (a.h.id === this.selected ? -1 : b.h.id === this.selected ? 1 : a.h.order - b.h.order));
    for (const p of sorted) {
      if (!p.visible) continue;
      this.v.copy(p.world).project(camera);
      const behind = this.v.z > 1 || this.v.z < -1;
      const x = (this.v.x * 0.5 + 0.5) * viewW;
      const y = (-this.v.y * 0.5 + 0.5) * viewH;
      const off = behind || x < -40 || x > viewW + 40 || y < -60 || y > viewH + 60;
      p.root.style.visibility = off ? 'hidden' : '';
      if (off) continue;
      p.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

      const occluded = this.hf.occluded(camera.position, p.world, this.exag);
      p.root.classList.toggle('occluded', occluded);
      p.root.classList.toggle('badge', badge);

      // Head sits 24 px above the anchor; declutter on head positions.
      const hy = y - 24;
      let collide = false;
      if (!occluded) for (const q of placed) if (Math.abs(q.x - x) < minGap && Math.abs(q.y - hy) < minGap) { collide = true; break; }
      const collapsed = collide && p.h.id !== this.selected;
      p.root.classList.toggle('collapsed', collapsed);
      if (!collapsed && !occluded) placed.push({ x, y: hy });

      if (p.halo) {
        // Projected 600 m radius, squashed by the viewing angle.
        this.v.copy(p.world).addScaledVector(this.right, HALO_RADIUS_M).project(camera);
        const rx = Math.abs((this.v.x * 0.5 + 0.5) * viewW - x);
        const toCam = camera.position.clone().sub(p.world).normalize();
        p.halo.style.setProperty('--r', `${Math.min(140, Math.max(10, rx)).toFixed(1)}px`);
        p.halo.style.setProperty('--squash', Math.max(0.2, toCam.y).toFixed(2));
      }
    }
  }
}
