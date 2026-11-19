// Hotspot info panel (CLAUDE.md §9, DESIGN.md §8).
// Phones / portrait tablets: bottom sheet with snap points 18 / 55 / 92 vh (drag or tap the handle),
// modal with a focus trap. Landscape tablets / desktop: non-modal glass side panel (380 / 440 px).
import { getLang, fmtMeters, t } from '../i18n';
import { loc, pictureFor, type Content, type Hotspot, type Lang, type PhotoCredit } from '../data/content';
import { destinations } from '../data/encounters';
import { BASE } from '../flags';
import { categoryColor, glyphs, icons } from './icons';
import { illustration } from './illustrations';
import type { PhotoViewer } from './viewer';

export interface PanelHandlers {
  onClose: () => void;
  onNavigate: (id: string) => void;
  onShowOnMap: (id: string) => void;
  /** Walk at this hotspot in first-person view (habitats, peaks and places on the ground). */
  onWalk?: (id: string, subject?: string) => void;
  /** Pixels of the canvas covered by the panel (right edge on desktop, bottom edge for the sheet). */
  onObscure: (right: number, bottom: number) => void;
}

const SNAPS = [0.18, 0.55, 0.92];

/** Elevation chip text, or null when a single height would be misleading (symbolic anchor). */
export function elevationText(h: Hotspot): string | null {
  if (h.location_precision === 'symbolic') return null;
  const surveyed = h.elevation_source && h.elevation_source !== 'dem';
  if (surveyed) {
    // Sources disagree with the DEM by more than 25 m → show the range (CLAUDE.md §9: "≈ 1 610–1 670 m").
    if (Math.abs(h.elevation_m - h.dem_m) > 25) {
      const lo = Math.round(Math.min(h.elevation_m, h.dem_m) / 10) * 10;
      const hi = Math.max(h.elevation_m, h.dem_m);
      return `≈ ${fmtMeters(lo).replace(/ m$/, '')}–${fmtMeters(hi)}`;
    }
    return fmtMeters(h.elevation_m);
  }
  // DEM-sampled marker height: a surface model at an indicative point → approximate, 10 m steps.
  return `≈ ${fmtMeters(Math.round(h.dem_m / 10) * 10)}`;
}

const hostname = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export class Panel {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private current: Hotspot | null = null;
  private sheet: boolean | null = null;
  private snap = 1;
  private sheetH = 0;
  private returnFocus: HTMLElement | null = null;
  private slideIndex = 0;
  private copiedTimer = 0;

  constructor(
    private content: Content,
    private credits: Map<string, PhotoCredit>,
    private viewer: PhotoViewer,
    private h: PanelHandlers,
    private debug: boolean,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'panel';
    this.el.id = 'panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-labelledby', 'panel-title');
    this.el.inert = true;
    this.el.innerHTML = `
      <div class="panel-head">
        <button type="button" class="handle"><span></span></button>
        <div class="chips"></div>
        <h2 id="panel-title" tabindex="-1"></h2>
        <p class="short"></p>
        <button type="button" class="btn-icon panel-close">${icons.close}</button>
      </div>
      <div class="panel-body"></div>
      <div class="panel-foot"></div>`;
    document.getElementById('app')!.append(this.el);
    this.head = this.el.querySelector('.panel-head')!;
    this.body = this.el.querySelector('.panel-body')!;
    this.foot = this.el.querySelector('.panel-foot')!;
    this.el.querySelector('.panel-close')!.addEventListener('click', () => this.h.onClose());
    this.bindSheetDrag();
    this.el.addEventListener('keydown', (e) => this.trapFocus(e));
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  get openId() { return this.current?.id ?? null; }

  open(h: Hotspot, focus: boolean) {
    const wasOpen = !!this.current;
    if (!wasOpen) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.current = h;
    this.slideIndex = 0;
    this.render();
    this.body.scrollTop = 0;
    this.el.inert = false;
    this.el.classList.add('open');
    if (this.sheet && (!wasOpen || this.snap === 0)) this.setSnap(1);
    this.reportObscured();
    if (focus) requestAnimationFrame(() => (this.el.querySelector('#panel-title') as HTMLElement).focus({ preventScroll: true }));
  }

  close() {
    if (!this.current) return;
    this.current = null;
    this.el.classList.remove('open');
    this.el.inert = true;
    this.h.onObscure(0, 0);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (rf && rf.isConnected && !rf.closest('.panel')) rf.focus({ preventScroll: true });
  }

  /** Re-render in the new language without closing (DESIGN.md §11). */
  relabel() {
    if (this.current) this.render();
  }

  // ---------- layout ----------
  private layout() {
    const w = window.innerWidth, hgt = window.innerHeight;
    // Side panel on desktop and landscape tablets; bottom sheet on phones and portrait tablets (DESIGN.md §3).
    const sheet = !(w >= 1024 || (w >= 768 && w > hgt));
    if (sheet !== this.sheet) {
      this.sheet = sheet;
      this.el.classList.toggle('sheet', sheet);
      this.el.classList.toggle('side', !sheet);
      this.el.setAttribute('aria-modal', String(sheet));
    }
    if (sheet) this.setSnap(this.snap, false);
    if (this.current) this.reportObscured();
  }

  private reportObscured() {
    if (!this.current) return;
    if (this.sheet) this.h.onObscure(0, this.sheetH);
    else this.h.onObscure(this.el.getBoundingClientRect().width + 16, 0);
  }

  private setSnap(i: number, report = true) {
    this.snap = Math.max(0, Math.min(SNAPS.length - 1, i));
    this.sheetH = Math.round(SNAPS[this.snap] * window.innerHeight);
    this.el.style.setProperty('--sheet-h', `${this.sheetH}px`);
    this.el.classList.toggle('peek', this.snap === 0);
    this.el.classList.toggle('full', this.snap === SNAPS.length - 1);
    const handle = this.el.querySelector('.handle')!;
    handle.setAttribute('aria-expanded', String(this.snap > 0));
    if (report) this.reportObscured();
  }

  private bindSheetDrag() {
    const handle = this.el.querySelector<HTMLButtonElement>('.handle')!;
    let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false, onHandle = false;
    const cycle = () => this.setSnap(this.snap >= SNAPS.length - 1 ? 0 : this.snap + 1);
    // Pointer taps are handled in pointerup (pointer capture retargets the click); this is for Enter/Space.
    handle.addEventListener('click', (e) => { if (e.detail === 0) cycle(); });
    this.head.addEventListener('pointerdown', (e) => {
      if (!this.sheet) return;
      const target = e.target as HTMLElement;
      if (target.closest('button:not(.handle), a')) return;
      dragging = true; moved = false; onHandle = !!target.closest('.handle');
      startY = lastY = e.clientY; lastT = performance.now(); vel = 0;
      startH = this.sheetH;
      this.head.setPointerCapture(e.pointerId);
      this.el.classList.add('dragging');
    });
    this.head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const now = performance.now();
      vel = (e.clientY - lastY) / Math.max(1, now - lastT); // px/ms, + = downwards
      lastY = e.clientY; lastT = now;
      const hMax = SNAPS[SNAPS.length - 1] * window.innerHeight;
      const hNew = Math.max(48, Math.min(hMax, startH - dy));
      this.el.style.setProperty('--sheet-h', `${hNew}px`);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove('dragging');
      const hNow = startH - (e.clientY - startY);
      if (!moved) { if (onHandle) cycle(); else this.setSnap(this.snap); return; }
      const vh = window.innerHeight;
      if (hNow < SNAPS[0] * vh * 0.6 || (vel > 1.2 && this.snap === 0)) { this.h.onClose(); return; }
      // Flick: move one snap in the flick direction; otherwise nearest snap.
      let idx: number;
      if (Math.abs(vel) > 0.6) idx = this.snap + (vel > 0 ? -1 : 1);
      else idx = SNAPS.reduce((best, s, i) => (Math.abs(s * vh - hNow) < Math.abs(SNAPS[best] * vh - hNow) ? i : best), 0);
      this.setSnap(idx);
    };
    this.head.addEventListener('pointerup', end);
    this.head.addEventListener('pointercancel', end);
  }

  private trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !this.sheet || !this.current) return;
    const items = [...this.el.querySelectorAll<HTMLElement>('button, a[href], summary, [tabindex="0"]')]
      .filter((x) => x.offsetParent !== null && !x.closest('[inert]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.el.querySelector('#panel-title'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------- content ----------
  private render() {
    const h = this.current!;
    const lang = getLang();
    const meta = this.content.meta;
    this.el.setAttribute('aria-label', t('panel.label'));
    this.el.querySelector('.panel-close')!.setAttribute('aria-label', t('panel.close'));
    this.el.querySelector('.handle')!.setAttribute('aria-label', t('panel.handle'));

    // Chips: category (colour + glyph + label), elevation, precision.
    const chips = this.el.querySelector('.chips')!;
    chips.innerHTML = '';
    const cat = document.createElement('span');
    cat.className = 'chip chip-cat';
    cat.style.setProperty('--cat', categoryColor[h.category]);
    cat.innerHTML = `<span class="chip-glyph">${glyphs[h.category]}</span>`;
    cat.append(meta.categories[h.category][lang]);
    chips.append(cat);
    const elev = elevationText(h);
    if (elev) {
      const c = document.createElement('span');
      c.className = 'chip chip-elev';
      c.innerHTML = icons.mountain;
      const v = document.createElement('span');
      v.textContent = elev;
      c.append(v);
      c.setAttribute('aria-label', `${t('panel.elevation')} ${elev}`);
      c.setAttribute('role', 'img');
      chips.append(c);
    }
    if (h.location_precision !== 'exact') {
      const c = document.createElement('span');
      c.className = 'chip chip-precision';
      c.textContent = t(`precision.${h.location_precision}`);
      chips.append(c);
    }

    this.el.querySelector('#panel-title')!.textContent = loc(h, 'title', lang);
    this.el.querySelector('.short')!.textContent = loc(h, 'short', lang);

    this.body.innerHTML = '';
    this.body.append(this.renderMedia(h, lang));

    const long = document.createElement('p');
    long.className = 'long';
    long.textContent = loc(h, 'long', lang);
    this.body.append(long);
    const subjects=destinations[h.id];
    if(subjects && this.h.onWalk){
      const section=document.createElement('section');
      section.className='animal-destinations';
      const label=document.createElement('h3'); label.textContent=t('walk.encounter');
      section.append(label);
      for(const kind of subjects){
        const button=document.createElement('button');button.type='button';button.dataset.animal=kind;
        button.textContent=t('walk.animal.'+kind);button.onclick=()=>this.h.onWalk!(h.id,kind);
        section.append(button);
      }
      this.body.insertBefore(section,long);
    }

    if (h.facts.length) {
      const sec = document.createElement('section');
      sec.className = 'facts';
      sec.innerHTML = `<h3></h3><dl></dl>`;
      sec.querySelector('h3')!.textContent = t('panel.facts');
      const dl = sec.querySelector('dl')!;
      for (const f of h.facts) {
        const dt = document.createElement('dt');
        dt.textContent = lang === 'en' ? f.label_en : f.label_fr;
        const dd = document.createElement('dd');
        dd.textContent = lang === 'en' ? f.value_en : f.value_fr;
        const row = document.createElement('div');
        row.append(dt, dd);
        dl.append(row);
      }
      this.body.append(sec);
    }

    const det = document.createElement('details');
    det.className = 'sources';
    det.open = window.innerWidth >= 1024;
    const sum = document.createElement('summary');
    sum.textContent = `${t('panel.sources')} (${h.sources.length})`;
    const ul = document.createElement('ul');
    for (const s of h.sources) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `<span class="src-label"></span><span class="src-host"></span>${icons.external}<span class="sr-only"></span>`;
      a.querySelector('.src-label')!.textContent = s.label;
      a.querySelector('.src-host')!.textContent = hostname(s.url);
      a.querySelector('.sr-only')!.textContent = t('panel.newTab');
      li.append(a);
      ul.append(li);
    }
    det.append(sum, ul);
    this.body.append(det);

    if (this.debug && h.uncertain.length) {
      const v = document.createElement('aside');
      v.className = 'verify';
      v.innerHTML = `<strong></strong><ul></ul>`;
      v.querySelector('strong')!.textContent = `ⓘ ${t('panel.verify')}`;
      for (const u of h.uncertain) { const li = document.createElement('li'); li.textContent = u; li.lang = 'en'; v.querySelector('ul')!.append(li); }
      this.body.append(v);
    }

    this.renderFoot(h);
  }

  private renderMedia(h: Hotspot, lang: Lang): HTMLElement {
    const photos = h.photos.map((id) => this.credits.get(id)).filter((p): p is PhotoCredit => !!p);
    const wrap = document.createElement('div');
    wrap.className = 'media';
    if (!photos.length) {
      const fig = document.createElement('figure');
      fig.className = 'placeholder';
      fig.style.setProperty('--cat', categoryColor[h.category]);
      fig.innerHTML = `<div class="placeholder-art">${illustration(h)}</div><figcaption></figcaption>`;
      fig.querySelector('figcaption')!.textContent = t('panel.noPhoto');
      wrap.append(fig);
      return wrap;
    }
    const track = document.createElement('div');
    track.className = 'track';
    track.tabIndex = 0;
    track.setAttribute('role', 'group');
    track.setAttribute('aria-roledescription', 'carousel');
    track.setAttribute('aria-label', t('panel.photos'));
    photos.forEach((p, i) => {
      const alt = lang === 'en' ? p.alt_en : p.alt_fr;
      const fig = document.createElement('figure');
      fig.className = 'slide';
      fig.setAttribute('role', 'group');
      fig.setAttribute('aria-roledescription', 'slide');
      fig.setAttribute('aria-label', t('panel.photoN', { n: String(i + 1), total: String(photos.length) }));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'photo-btn';
      btn.setAttribute('aria-label', t('panel.openPhoto', { alt }));
      const { picture, img } = pictureFor(BASE, p.id, true);
      img.alt = alt;
      img.width = 480;
      img.height = Math.round((480 * p.height) / p.width);
      img.decoding = 'async';
      img.loading = i === 0 ? 'eager' : 'lazy';
      btn.append(picture);
      btn.insertAdjacentHTML('beforeend', `<span class="photo-expand" aria-hidden="true">${icons.expand}</span>`);
      btn.addEventListener('click', () => this.viewer.open(photos, i));
      const cap = document.createElement('figcaption');
      const a = document.createElement('a');
      a.href = p.source_url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `© ${p.author} · ${p.reconstruction ? t('image.reconstruction') : p.license}`;
      const altSpan = document.createElement('span');
      altSpan.className = 'cap-alt';
      altSpan.textContent = alt;
      cap.append(altSpan, ' ', a);
      fig.append(btn, cap);
      track.append(fig);
    });
    wrap.append(track);
    if (photos.length > 1) {
      const dots = document.createElement('div');
      dots.className = 'dots';
      photos.forEach((_, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.setAttribute('aria-label', t('panel.photoN', { n: String(i + 1), total: String(photos.length) }));
        d.addEventListener('click', () => this.goSlide(track, i));
        dots.append(d);
      });
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'car-btn car-prev';
      prev.innerHTML = icons.chevronLeft;
      prev.setAttribute('aria-label', t('viewer.prev'));
      prev.addEventListener('click', () => this.goSlide(track, this.slideIndex - 1));
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'car-btn car-next';
      next.innerHTML = icons.chevronRight;
      next.setAttribute('aria-label', t('viewer.next'));
      next.addEventListener('click', () => this.goSlide(track, this.slideIndex + 1));
      wrap.append(prev, next, dots);
      const sync = () => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        this.slideIndex = i;
        dots.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
        prev.disabled = i === 0;
        next.disabled = i === photos.length - 1;
      };
      track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
      track.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); this.goSlide(track, this.slideIndex + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.goSlide(track, this.slideIndex - 1); }
      });
      requestAnimationFrame(sync);
    }
    return wrap;
  }

  private goSlide(track: HTMLElement, i: number) {
    const n = track.children.length;
    const k = Math.max(0, Math.min(n - 1, i));
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: k * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }

  private renderFoot(h: Hotspot) {
    const list = this.content.hotspots;
    const i = list.findIndex((x) => x.id === h.id);
    const prev = list[(i - 1 + list.length) % list.length];
    const next = list[(i + 1) % list.length];
    const lang = getLang();
    this.foot.innerHTML = '';
    const mk = (cls: string, icon: string, text: string, label: string, fn: () => void, iconAfter = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `foot-btn ${cls}`;
      const span = document.createElement('span');
      span.className = 'foot-text';
      span.textContent = text;
      if (iconAfter) { b.append(span); b.insertAdjacentHTML('beforeend', icon); } else { b.innerHTML = icon; b.append(span); }
      b.setAttribute('aria-label', label);
      b.title = text;
      b.addEventListener('click', fn);
      return b;
    };
    const share = mk('foot-share', icons.share, t('panel.share'), t('panel.share'), () => this.share(h, share));
    this.foot.append(
      mk('foot-prev', icons.chevronLeft, t('panel.prev'), t('panel.prevLabel', { title: loc(prev, 'title', lang) }), () => this.h.onNavigate(prev.id)),
      share,
      mk('foot-map', icons.target, t('panel.showOnMap'), t('panel.showOnMap'), () => {
        if (this.sheet) this.setSnap(0);
        this.h.onShowOnMap(h.id);
      }),
      ...(this.h.onWalk ? [mk('foot-walk', icons.walk, t('walk.enter'), t('walk.enterLabel'), () => this.h.onWalk!(h.id,destinations[h.id]?.[0]))] : []),
      mk('foot-next', icons.chevronRight, t('panel.next'), t('panel.nextLabel', { title: loc(next, 'title', lang) }), () => this.h.onNavigate(next.id), true),
    );
  }

  private async share(h: Hotspot, btn: HTMLButtonElement) {
    const url = `${location.origin}${location.pathname}#/h/${h.id}`;
    const title = loc(h, 'title', getLang());
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && matchMedia('(pointer: coarse)').matches) {
      try { await nav.share({ title, url }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      const txt = btn.querySelector('.foot-text')!;
      txt.textContent = t('panel.linkCopied');
      const live = document.getElementById('live');
      if (live) live.textContent = t('panel.linkCopied');
      clearTimeout(this.copiedTimer);
      this.copiedTimer = window.setTimeout(() => { txt.textContent = t('panel.share'); }, 2000);
    } catch { /* clipboard blocked: nothing else to do */ }
  }
}
