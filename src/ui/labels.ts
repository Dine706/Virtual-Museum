// Projected DOM labels on the terrain (villages, countries, enclave). Same projection and occlusion
// test as the pins; non-interactive (pointer-events: none) and hidden from the accessibility tree,
// because the same information is in the pins/panels and the legend.
import * as THREE from 'three';
import { lonLatToXZ } from '../data/geo';
import { PLACE_LABELS, type PlaceLabel } from '../data/places';
import type { Mode } from '../data/content';
import { t } from '../i18n';
import type { Heightfield } from '../scene/heightfield';

interface El { p: PlaceLabel; el: HTMLDivElement; text: HTMLSpanElement; world: THREE.Vector3 }

export class TerrainLabels {
  private items: El[] = [];
  private root: HTMLDivElement;
  private v = new THREE.Vector3();
  private mode: Mode = 'nature';

  constructor(private hf: Heightfield, private exag: number) {
    this.root = document.createElement('div');
    this.root.className = 'terrain-labels';
    this.root.setAttribute('aria-hidden', 'true');
    document.getElementById('app')!.insertBefore(this.root, document.getElementById('pins'));
    for (const p of PLACE_LABELS) {
      const [x, z] = lonLatToXZ(p.lon, p.lat);
      const el = document.createElement('div');
      el.className = `tlabel tlabel-${p.kind}`;
      const text = document.createElement('span');
      el.append(text);
      this.root.append(el);
      this.items.push({ p, el, text, world: new THREE.Vector3(x, hf.heightAt(x, z) * exag, z) });
    }
    this.relabel();
  }

  relabel() {
    for (const i of this.items) i.text.textContent = i.p.i18n ? t(i.p.text) : i.p.text;
  }

  setMode(m: Mode) {
    this.mode = m;
    for (const i of this.items) i.el.classList.toggle('on', i.p.modes.includes(m));
  }

  update(camera: THREE.PerspectiveCamera, w: number, h: number) {
    for (const i of this.items) {
      if (!i.p.modes.includes(this.mode)) continue;
      this.v.copy(i.world).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      const off = Math.abs(this.v.z) > 1 || x < -100 || x > w + 100 || y < -40 || y > h + 40;
      const hidden = off || this.hf.occluded(camera.position, i.world, this.exag);
      i.el.classList.toggle('hidden', hidden);
      if (!off) i.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
