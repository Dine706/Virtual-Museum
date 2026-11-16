// Free-click readout card (DESIGN.md §9): "▲ 1 420 m · Prairie d'altitude · Dans la réserve (Guinée) · Plus proche : …".
// Shown at the tap point; dismissed by the next tap, a drag/zoom, a fly-to or Esc.
import { getLang, fmtMeters, t } from '../i18n';
import { loc, type Hotspot } from '../data/content';
import type { Place } from '../data/regions';
import { LANDCOVER_LABELS } from '../scene/landcover';
import { icons } from './icons';

export interface ReadoutData {
  elevation: number; // true metres (DEM)
  landcover: number; // WorldCover class
  place: Place;
  nearest: { hotspot: Hotspot; distance: number } | null;
}

const nfKm = { fr: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }), en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) };

export function fmtDistance(m: number): string {
  if (m < 950) return fmtMeters(Math.max(50, Math.round(m / 50) * 50));
  return `${nfKm[getLang()].format(m / 1000)} km`;
}

/** Land-cover label; grass/shrub above 1,200 m is the montane grassland described in content.json. */
export function landcoverLabel(cls: number, elevation: number): string {
  if ((cls === 30 || cls === 20) && elevation >= 1200) return t('readout.montaneGrass');
  return LANDCOVER_LABELS[cls]?.[getLang()] ?? LANDCOVER_LABELS[10][getLang()];
}

export function placeLabel(p: Place): string {
  const parts: string[] = [];
  if (p.reserve) parts.push(t('readout.inReserve', { country: t(`country.${p.reserve}`) }));
  else {
    parts.push(t('readout.outReserve'));
    if (p.nearTripoint) parts.push(t('readout.nearTri'));
    else if (p.country && !p.nearBorder) parts.push(t(`country.${p.country}`));
    else if (p.country) parts.push(`${t(`country.${p.country}`)}, ${t('readout.nearBorder')}`);
    else parts.push(t('readout.nearBorder'));
  }
  if (p.enclave) parts.push(t('readout.enclave'));
  return parts.join(' · ');
}

export class Readout {
  private el: HTMLDivElement;
  private dot: HTMLDivElement;
  private data: ReadoutData | null = null;
  private at = { x: 0, y: 0 };

  constructor(private onOpen: (id: string) => void) {
    this.dot = document.createElement('div');
    this.dot.className = 'readout-dot';
    this.el = document.createElement('div');
    this.el.className = 'readout';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    this.dot.hidden = true;
    document.getElementById('app')!.append(this.dot, this.el);
  }

  get visible() { return !this.el.hidden; }

  show(x: number, y: number, d: ReadoutData) {
    this.data = d;
    this.at = { x, y };
    this.render();
  }

  hide() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.dot.hidden = true;
    this.data = null;
  }

  relabel() { if (this.data) this.render(); }

  private render() {
    const d = this.data!;
    this.el.innerHTML = '';
    const line = document.createElement('p');
    line.className = 'readout-line';
    const elev = document.createElement('strong');
    elev.className = 'readout-elev';
    elev.innerHTML = icons.mountain;
    elev.append(fmtMeters(Math.round(d.elevation)));
    line.append(elev, ` · ${landcoverLabel(d.landcover, d.elevation)} · ${placeLabel(d.place)}`);
    this.el.setAttribute('aria-label', t('readout.label'));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'readout-close';
    close.innerHTML = icons.close;
    close.setAttribute('aria-label', t('readout.close'));
    close.addEventListener('click', (e) => { e.stopPropagation(); this.hide(); });
    this.el.append(close, line);
    if (d.nearest) {
      const title = loc(d.nearest.hotspot, 'title', getLang());
      const dist = fmtDistance(d.nearest.distance);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'readout-nearest';
      b.textContent = t('readout.nearest', { title, dist });
      b.setAttribute('aria-label', t('readout.openNearest', { title, dist }));
      b.addEventListener('click', () => { const id = d.nearest!.hotspot.id; this.hide(); this.onOpen(id); });
      this.el.append(b);
    }
    this.el.hidden = false;
    this.dot.hidden = false;
    // Place below the point (pins rise *above* their ground point, so this never hides the pin there);
    // flip above when there is no room; clamp to the viewport.
    const vw = window.innerWidth, vh = window.innerHeight;
    const { x, y } = this.at;
    this.dot.style.transform = `translate(${x}px, ${y}px)`;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const left = Math.min(vw - w - 12, Math.max(12, x - w / 2));
    const below = y + 16 + h < vh - 12;
    const top = below ? y + 16 : Math.max(70, y - h - 50);
    this.el.style.transform = `translate(${left}px, ${top}px)`;
  }
}
