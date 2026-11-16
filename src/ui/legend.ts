// Legend (DESIGN.md §7 "legend explains overlays"): content follows the mode. Open by default on desktop,
// a collapsible "Legend" pill elsewhere. The Danger List chip opens the danger-list hotspot.
import type { Mode } from '../data/content';
import { t } from '../i18n';

const swatch = (cls: string) => `<span class="sw ${cls}" aria-hidden="true"></span>`;

export class Legend {
  private el: HTMLDetailsElement;
  private body: HTMLDivElement;
  private mode: Mode = 'nature';

  constructor(private onDanger: () => void) {
    this.el = document.createElement('details');
    this.el.className = 'legend';
    this.el.open = window.innerWidth >= 1024;
    this.el.innerHTML = `<summary></summary><div class="legend-body"></div>`;
    this.body = this.el.querySelector('.legend-body')!;
    document.getElementById('app')!.append(this.el);
    this.render();
  }

  setMode(m: Mode) { this.mode = m; this.render(); }
  relabel() { this.render(); }

  private render() {
    this.el.querySelector('summary')!.textContent = t('legend.title');
    const rows: string[] = [];
    const row = (sw: string, key: string) => rows.push(`<li>${swatch(sw)}<span>${t(key)}</span></li>`);
    if (this.mode === 'nature') {
      row('sw-band-low', 'legend.bandLow');
      row('sw-band-montane', 'legend.bandMontane');
      row('sw-band-grass', 'legend.bandGrass');
      rows.push(`<li class="note">${t('legend.bandsNote')}</li>`);
      row('sw-reserve', 'legend.reserve');
    } else if (this.mode === 'culture') {
      row('sw-village', 'legend.village');
      row('sw-reserve', 'legend.reserve');
      row('sw-borders', 'legend.borders');
    } else {
      row('sw-reserve sw-glow', 'legend.reserve');
      row('sw-enclave', 'legend.enclave');
      row('sw-borders', 'legend.borders');
    }
    this.body.innerHTML = `<ul>${rows.join('')}</ul>`;
    if (this.mode === 'conservation') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'danger-chip';
      b.textContent = t('legend.danger');
      b.setAttribute('aria-label', `${t('legend.danger')} – ${t('legend.dangerOpen')}`);
      b.addEventListener('click', () => this.onDanger());
      this.body.append(b);
    }
  }
}
