// Walk-mode overlay: place chip, light and exit buttons, hint, crosshair, loading veil and the info card.
import { t } from '../i18n';
import { icons } from '../ui/icons';

export interface CardLink { label: string; url: string }
export interface CardItem { label: string; sub?: string; url?: string }
export interface Card {
  kicker: string; title: string; sci?: string;
  lines: string[]; items?: CardItem[]; itemsTitle?: string; note?: string; sources: CardLink[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Hud {
  readonly root: HTMLDivElement;
  private place: HTMLDivElement;
  private card: HTMLElement;
  private hint: HTMLDivElement;
  private veil: HTMLDivElement;
  private veilText: HTMLParagraphElement;
  private timeBtn: HTMLButtonElement;
  private marker: HTMLDivElement;
  onExit: () => void = () => {};
  onTime: () => void = () => {};
  onCardClose: () => void = () => {};

  constructor(coarse: boolean) {
    this.root = document.createElement('div');
    this.root.className = 'walk-ui';
    this.root.innerHTML = `
      <div class="walk-top">
        <div class="walk-place" aria-live="polite"></div>
        <div class="walk-actions">
          <button type="button" class="walk-btn walk-time"></button>
          <button type="button" class="walk-btn walk-exit"></button>
        </div>
      </div>
      <div class="walk-cross" aria-hidden="true"></div>
      <div class="walk-marker" aria-hidden="true" hidden></div>
      <div class="walk-hint"></div>
      <section class="walk-card" role="dialog" aria-modal="false" hidden></section>
      <div class="walk-veil"><p></p></div>`;
    document.body.append(this.root);
    this.place = this.root.querySelector('.walk-place')!;
    this.card = this.root.querySelector('.walk-card')!;
    this.hint = this.root.querySelector('.walk-hint')!;
    this.veil = this.root.querySelector('.walk-veil')!;
    this.veilText = this.veil.querySelector('p')!;
    this.marker = this.root.querySelector('.walk-marker')!;
    this.timeBtn = this.root.querySelector('.walk-time')!;
    const exit = this.root.querySelector<HTMLButtonElement>('.walk-exit')!;
    exit.innerHTML = `${icons.close}<span>${esc(t('walk.exit'))}</span>`;
    exit.setAttribute('aria-label', t('walk.exitLabel'));
    exit.addEventListener('click', () => this.onExit());
    this.timeBtn.addEventListener('click', () => this.onTime());
    this.hint.textContent = t(coarse ? 'walk.hint.touch' : 'walk.hint.desktop');
    setTimeout(() => this.hint.classList.add('fade'), 9000);
  }

  setTime(label: string) {
    this.timeBtn.innerHTML = `<span class="walk-sun" aria-hidden="true"></span><span>${esc(label)}</span>`;
    this.timeBtn.setAttribute('aria-label', `${t('walk.time')} : ${label}`);
  }

  setPlace(habitat: string, elev: string, zone: boolean) {
    this.place.innerHTML = `<strong>${esc(habitat)}</strong><span>${icons.mountain}${esc(elev)}</span>${zone ? `<em>${esc(t('walk.zone'))}</em>` : ''}`;
  }

  veilOn(text = t('walk.loading')) { this.veilText.textContent = text; this.veil.classList.remove('off'); }
  veilOff() { this.veil.classList.add('off'); }
  setVeilText(s: string) { this.veilText.textContent = s; }

  showMarker(x: number, y: number) {
    this.marker.hidden = false;
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
    this.marker.classList.remove('pulse');
    void this.marker.offsetWidth;
    this.marker.classList.add('pulse');
  }

  get cardOpen() { return !this.card.hidden; }

  showCard(c: Card) {
    const src = c.sources.length
      ? `<details class="walk-sources"><summary>${esc(t('walk.sources'))}</summary><ul>${c.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul></details>`
      : '';
    const items = c.items?.length
      ? `${c.itemsTitle ? `<p class="walk-items-title">${esc(c.itemsTitle)}</p>` : ''}<ul class="walk-items">${c.items.map((i) => `<li>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.label)}</a>` : esc(i.label)}${i.sub ? `<span>${esc(i.sub)}</span>` : ''}</li>`).join('')}</ul>`
      : '';
    this.card.innerHTML = `
      <button type="button" class="walk-card-close" aria-label="${esc(t('walk.close'))}">${icons.close}</button>
      <p class="walk-kicker">${esc(c.kicker)}</p>
      <h2>${esc(c.title)}</h2>${c.sci ? `<p class="walk-sci">${esc(c.sci)}</p>` : ''}
      ${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${items}
      ${c.note ? `<p class="walk-note">${esc(c.note)}</p>` : ''}
      ${src}`;
    this.card.hidden = false;
    this.card.setAttribute('aria-label', c.title);
    this.card.querySelector<HTMLButtonElement>('.walk-card-close')!.addEventListener('click', () => this.hideCard());
  }

  hideCard() {
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.marker.hidden = true;
    this.onCardClose();
  }

  dispose() { this.root.remove(); }
}
