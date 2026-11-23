// Persistent UI around the canvas: top bar (phone/tablet), tool rail (desktop) / bottom-left tools (phone),
// mode segmented control, credit footer. Layout per DESIGN.md §3; buttons ≥ 44 px.
import { applyStatic, onLang, t } from '../i18n';
import { icons } from './icons';
import { langToggle } from './lang';
import type { AtmoName } from '../scene/atmosphere';
import type { Mode } from '../data/content';

export interface ChromeHandlers {
  onAtmo: () => void;
  onReset: () => void;
  onMode: (m: Mode) => void;
}

const atmoIcon: Record<AtmoName, string> = { clear: icons.sun, golden: icons.sunset, mist: icons.mist };

export class Chrome {
  onTour: () => void = () => {};
  private atmoBtn: HTMLButtonElement;
  private modeBtns = new Map<Mode, HTMLButtonElement>();
  private atmo: AtmoName = 'clear';

  constructor(h: ChromeHandlers) {
    const top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML = `<div class="brand" data-i18n="app.name"></div>`;
    const langHome = document.createElement('div');
    langHome.className = 'lang-home';
    langHome.append(langToggle());
    top.append(langHome);

    const modes = document.createElement('div');
    modes.className = 'modes';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    seg.dataset.i18nAttr = 'aria-label:mode.label';
    for (const m of ['nature', 'culture', 'conservation'] as Mode[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.i18n = `mode.${m}`;
      b.addEventListener('click', () => h.onMode(m));
      this.modeBtns.set(m, b);
      seg.append(b);
    }
    // Arrow keys move between modes (roving tabindex).
    seg.addEventListener('keydown', (e) => {
      const order = [...this.modeBtns.keys()];
      const cur = order.findIndex((m) => this.modeBtns.get(m)!.getAttribute('aria-checked') === 'true');
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % order.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur + order.length - 1) % order.length;
      if (next >= 0) { e.preventDefault(); h.onMode(order[next]); this.modeBtns.get(order[next])!.focus(); }
    });
    modes.append(seg);

    const tools = document.createElement('nav');
    tools.className = 'tools';
    tools.dataset.i18nAttr = 'aria-label:tools.label';
    this.atmoBtn = this.iconButton('', () => h.onAtmo());
    const reset = this.iconButton(icons.locate, () => h.onReset());
    reset.dataset.i18nAttr = 'aria-label:view.reset;data-tip:view.reset';
    const tour = this.iconButton(icons.play, () => this.onTour());
    tour.dataset.i18nAttr = 'aria-label:tour.button;data-tip:tour.button';
    const langSlot = document.createElement('div');
    langSlot.className = 'lang-slot';
    langSlot.append(langToggle());
    // Link to the virtual museum (musee.html).
    const museum = document.createElement('a');
    museum.className = 'btn-icon has-tip';
    museum.href = './musee.html';
    museum.innerHTML = icons.museum;
    museum.dataset.i18nAttr = 'aria-label:museum.enter;data-tip:museum.enter';
    tools.append(this.atmoBtn, reset, tour, museum, langSlot);

    document.getElementById('app')!.append(top, modes, tools);
    applyStatic();
    this.setAtmo(this.atmo);
    onLang(() => this.setAtmo(this.atmo));
  }

  private iconButton(svg: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-icon has-tip';
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  }

  setAtmo(a: AtmoName) {
    this.atmo = a;
    this.atmoBtn.innerHTML = atmoIcon[a];
    const label = t('status.atmo', { atmo: t(`atmo.${a}`) });
    this.atmoBtn.setAttribute('aria-label', label);
    this.atmoBtn.dataset.tip = label;
  }

  setMode(m: Mode) {
    for (const [k, b] of this.modeBtns) {
      b.setAttribute('aria-checked', String(k === m));
      b.tabIndex = k === m ? 0 : -1;
    }
  }
}

export function announce(text: string) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}
