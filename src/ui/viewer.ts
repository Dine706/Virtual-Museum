// Full-screen photo viewer (DESIGN.md §8.4): native <dialog> (top layer, Esc, focus containment),
// loads the 1600 px original only here; pinch / wheel / double-tap zoom, drag to pan, arrows to switch.
import { getLang, t } from '../i18n';
import { photoUrl, type PhotoCredit } from '../data/content';
import { BASE } from '../flags';
import { icons } from './icons';

export class PhotoViewer {
  private dlg: HTMLDialogElement;
  private img: HTMLImageElement;
  private caption: HTMLElement;
  private counter: HTMLElement;
  private stageEl: HTMLElement;
  private photos: PhotoCredit[] = [];
  private index = 0;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; scale: number } | null = null;
  private lastTap = 0;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.dlg = document.createElement('dialog');
    this.dlg.className = 'viewer';
    this.dlg.innerHTML = `
      <div class="viewer-stage"><img alt="" decoding="async" draggable="false" /></div>
      <div class="viewer-bar">
        <button type="button" class="btn-icon v-prev">${icons.chevronLeft}</button>
        <span class="viewer-count"></span>
        <button type="button" class="btn-icon v-next">${icons.chevronRight}</button>
      </div>
      <p class="viewer-caption"></p>
      <button type="button" class="btn-icon v-close">${icons.close}</button>`;
    document.body.append(this.dlg);
    this.stageEl = this.dlg.querySelector('.viewer-stage')!;
    this.img = this.dlg.querySelector('img')!;
    this.caption = this.dlg.querySelector('.viewer-caption')!;
    this.counter = this.dlg.querySelector('.viewer-count')!;
    this.dlg.querySelector('.v-close')!.addEventListener('click', () => this.dlg.close());
    this.dlg.querySelector('.v-prev')!.addEventListener('click', () => this.show(this.index - 1));
    this.dlg.querySelector('.v-next')!.addEventListener('click', () => this.show(this.index + 1));
    this.dlg.addEventListener('close', () => { this.returnFocus?.focus({ preventScroll: true }); });
    this.dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.show(this.index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.show(this.index + 1); }
      if (e.key === '+' || e.key === '=') this.zoomTo(this.scale * 1.5);
      if (e.key === '-') this.zoomTo(this.scale / 1.5);
    });
    this.bindGestures();
  }

  open(photos: PhotoCredit[], index: number) {
    this.photos = photos;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.relabel();
    this.show(index);
    this.dlg.showModal();
  }

  get isOpen() { return this.dlg.open; }

  relabel() {
    this.dlg.setAttribute('aria-label', t('viewer.label'));
    this.dlg.querySelector('.v-close')!.setAttribute('aria-label', t('viewer.close'));
    this.dlg.querySelector('.v-prev')!.setAttribute('aria-label', t('viewer.prev'));
    this.dlg.querySelector('.v-next')!.setAttribute('aria-label', t('viewer.next'));
    if (this.photos.length) this.show(this.index);
  }

  private show(i: number) {
    const n = this.photos.length;
    if (!n) return;
    this.index = (i + n) % n;
    const p = this.photos[this.index];
    const alt = getLang() === 'en' ? p.alt_en : p.alt_fr;
    this.img.src = photoUrl(BASE, p.id);
    this.img.width = p.width;
    this.img.height = p.height;
    this.img.alt = alt;
    this.caption.innerHTML = '';
    const altEl = document.createElement('span');
    altEl.textContent = alt;
    const credit = document.createElement('a');
    credit.href = p.source_url;
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = `© ${p.author} · ${p.license}`;
    this.caption.append(altEl, document.createTextNode(' — '), credit);
    this.counter.textContent = t('panel.photoN', { n: String(this.index + 1), total: String(n) });
    (this.dlg.querySelector('.viewer-bar') as HTMLElement).hidden = n < 2;
    this.zoomTo(1, true);
  }

  private apply() {
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.stageEl.classList.toggle('zoomed', this.scale > 1.01);
  }

  private zoomTo(s: number, reset = false) {
    this.scale = Math.min(5, Math.max(1, s));
    if (reset || this.scale === 1) { this.tx = 0; this.ty = 0; }
    this.clampPan();
    this.apply();
  }

  private clampPan() {
    const r = this.stageEl.getBoundingClientRect();
    const mx = (r.width * (this.scale - 1)) / 2, my = (r.height * (this.scale - 1)) / 2;
    this.tx = Math.min(mx, Math.max(-mx, this.tx));
    this.ty = Math.min(my, Math.max(-my, this.ty));
  }

  private bindGestures() {
    const el = this.stageEl;
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomTo(this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    el.addEventListener('dblclick', () => this.zoomTo(this.scale > 1 ? 1 : 2.5));
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
      }
      if (e.pointerType === 'touch' && this.pointers.size === 1) {
        const now = performance.now();
        if (now - this.lastTap < 300) this.zoomTo(this.scale > 1 ? 1 : 2.5);
        this.lastTap = now;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        this.zoomTo(this.pinchStart.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinchStart.dist));
      } else if (this.pointers.size === 1 && this.scale > 1) {
        this.tx += cur.x - prev.x;
        this.ty += cur.y - prev.y;
        this.clampPan();
        this.apply();
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
