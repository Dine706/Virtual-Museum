// Museum interface (plain DOM): top bar, exhibit navigator, exhibit card (bottom sheet on phones, side
// panel from 900 px), gallery plan with the list of exhibits (also the no-WebGL fallback), credits, loading
// and a one-time hint. Every label comes from src/i18n; content text comes from content.json.
import { getLang, onLang, t, fmtMeters } from '../i18n';
import { icons } from '../ui/icons';
import { langToggle } from '../ui/lang';
import { loc, pictureFor, type Content, type Hotspot, type PhotoCredit } from '../data/content';
import { EXHIBITS, HX, HZ, PLINTH_BOX, BENCH_BOX, WINDOW, DOOR, wallFrame, printSize, type ExhibitDef } from './layout';

export interface ReliefFacts { scale: number; exag: number; minM: number; maxM: number; wKm: number; dKm: number }

export interface UIDeps {
  content: Content;
  credits: Map<string, PhotoCredit>;
  base: string;
  relief: ReliefFacts;
  textureCredits: { role: string; name: string; authors: string[]; license: string; url: string }[];
  onGo: (id: string) => void;
  onClose: () => void;
  onInset: (right: number, bottom: number) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SOURCES_RELIEF = [
  { label: 'Copernicus DEM GLO-30', url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM' },
  { label: 'ESA WorldCover 2021 v200', url: 'https://esa-worldcover.org/' },
  { label: 'UNEP-WCMC & IUCN – Protected Planet (WDPA)', url: 'https://www.protectedplanet.net' },
  { label: 'geoBoundaries (William & Mary geoLab)', url: 'https://www.geoboundaries.org' },
];

export class MuseumUI {
  current = -1;
  private card: HTMLElement;
  private cardBody: HTMLElement;
  private navTitle: HTMLButtonElement;
  private navCount: HTMLElement;
  private planDlg: HTMLDialogElement;
  private creditsDlg: HTMLDialogElement;
  private live: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private hot = new Map<string, Hotspot>();

  constructor(private d: UIDeps) {
    for (const h of d.content.hotspots) this.hot.set(h.id, h);
    const root = el('div', 'm-ui');
    // ---- top bar
    const top = el('header', 'm-top');
    const back = el('a', 'm-back');
    back.href = './';
    back.innerHTML = `${icons.chevronLeft}<span data-i18n="museum.map"></span>`;
    const brand = el('div', 'm-brand');
    brand.innerHTML = `<div class="m-brand-name" data-i18n="museum.title"></div><div class="m-brand-sub" data-i18n="museum.gallery"></div>`;
    const tools = el('div', 'm-tools');
    const planBtn = el('button', 'btn-icon');
    planBtn.type = 'button';
    planBtn.innerHTML = icons.list;
    planBtn.dataset.i18nAttr = 'aria-label:museum.plan;title:museum.plan';
    planBtn.addEventListener('click', () => this.openPlan());
    const infoBtn = el('button', 'btn-icon');
    infoBtn.type = 'button';
    infoBtn.innerHTML = icons.info;
    infoBtn.dataset.i18nAttr = 'aria-label:museum.credits;title:museum.credits';
    infoBtn.addEventListener('click', () => this.openCredits());
    tools.append(langToggle(), planBtn, infoBtn);
    top.append(back, brand, tools);

    // ---- navigator
    const nav = el('nav', 'm-nav');
    nav.dataset.i18nAttr = 'aria-label:museum.navLabel';
    const prev = el('button', 'btn-icon m-prev');
    prev.type = 'button';
    prev.innerHTML = icons.chevronLeft;
    prev.dataset.i18nAttr = 'aria-label:museum.prev;title:museum.prev';
    prev.addEventListener('click', () => this.step(-1));
    const next = el('button', 'btn-icon m-next');
    next.type = 'button';
    next.innerHTML = icons.chevronRight;
    next.dataset.i18nAttr = 'aria-label:museum.next;title:museum.next';
    next.addEventListener('click', () => this.step(1));
    this.navTitle = el('button', 'm-nav-title');
    this.navTitle.type = 'button';
    this.navCount = el('span', 'm-nav-count');
    const navText = el('span', 'm-nav-text');
    this.navTitle.append(this.navCount, navText);
    this.navTitle.addEventListener('click', () => {
      if (this.current < 0) this.d.onGo(EXHIBITS[0].id);
      else if (this.card.hidden) this.open(EXHIBITS[this.current].id);
      else this.close();
    });
    nav.append(prev, this.navTitle, next);

    // ---- card
    this.card = el('section', 'm-card');
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-labelledby', 'm-card-title');
    const close = el('button', 'btn-icon m-card-close');
    close.type = 'button';
    close.innerHTML = icons.close;
    close.dataset.i18nAttr = 'aria-label:museum.close;title:museum.close';
    close.addEventListener('click', () => this.close());
    this.cardBody = el('div', 'm-card-body');
    this.card.append(close, this.cardBody);
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if (e.key === 'Tab') this.trap(e, this.card);
    });

    // ---- dialogs
    this.planDlg = el('dialog', 'm-dialog m-plan');
    this.planDlg.setAttribute('aria-labelledby', 'm-plan-title');
    this.creditsDlg = el('dialog', 'm-dialog m-credits');
    this.creditsDlg.setAttribute('aria-labelledby', 'm-credits-title');
    for (const dlg of [this.planDlg, this.creditsDlg]) {
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }

    this.live = el('div', 'sr-only');
    this.live.setAttribute('aria-live', 'polite');
    root.append(top, nav, this.card, this.planDlg, this.creditsDlg, this.live);
    document.body.append(root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.card.hidden && !document.querySelector('dialog[open]')) this.close();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); this.openPlan(); }
      if (e.key === 'n' || e.key === 'PageDown') this.step(1);
      if (e.key === 'p' || e.key === 'PageUp') this.step(-1);
    });
    onLang(() => this.relabel());
    window.addEventListener('resize', () => this.reportInset());
    this.relabel();
  }

  /** Visible title of an exhibit in the current language. */
  title(e: ExhibitDef): string {
    const lang = getLang();
    if (e.kind === 'intro') return t('museum.intro.title');
    if (e.kind === 'relief') return t('museum.relief.title');
    if (e.kind === 'window') return t('museum.window.title');
    return loc(this.hot.get(e.hotspot!)!, 'title', lang);
  }

  number(e: ExhibitDef): string {
    if (e.hotspot) return String(this.hot.get(e.hotspot)!.order);
    return e.kind === 'intro' ? 'A' : e.kind === 'relief' ? 'B' : 'C';
  }

  /** Mark an exhibit as current (navigator), without opening its card. */
  setCurrent(id: string) {
    this.current = EXHIBITS.findIndex((e) => e.id === id);
    this.syncNav();
  }

  step(dir: number) {
    const n = EXHIBITS.length;
    const i = this.current < 0 ? (dir > 0 ? 0 : n - 1) : (this.current + dir + n) % n;
    this.d.onGo(EXHIBITS[i].id);
  }

  open(id: string, focus = true) {
    const i = EXHIBITS.findIndex((e) => e.id === id);
    if (i < 0) return;
    if (this.card.hidden) this.lastFocus = document.activeElement as HTMLElement | null;
    this.current = i;
    this.syncNav();
    this.render(EXHIBITS[i]);
    this.card.hidden = false;
    this.card.scrollTop = 0;
    this.cardBody.scrollTop = 0;
    document.body.classList.add('m-card-open');
    this.reportInset();
    if (location.hash !== `#/e/${id}`) history.replaceState(null, '', `${location.pathname}${location.search}#/e/${id}`);
    this.say(t('museum.opened', { title: this.title(EXHIBITS[i]) }));
    if (focus) requestAnimationFrame(() => (this.cardBody.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  close() {
    if (this.card.hidden) return;
    this.card.hidden = true;
    document.body.classList.remove('m-card-open');
    this.reportInset();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    this.d.onClose();
    const f = this.lastFocus;
    this.lastFocus = null;
    if (f && document.contains(f) && f !== document.body) f.focus({ preventScroll: true });
    else this.navTitle.focus({ preventScroll: true });
  }

  get cardOpen() { return !this.card.hidden; }

  private reportInset() {
    if (this.card.hidden) { this.d.onInset(0, 0); return; }
    const r = this.card.getBoundingClientRect();
    if (innerWidth >= 900) this.d.onInset(innerWidth - r.left, 0);
    else this.d.onInset(0, Math.max(0, innerHeight - r.top));
  }

  private syncNav() {
    const e = EXHIBITS[this.current];
    const text = this.navTitle.querySelector('.m-nav-text')!;
    if (!e) {
      this.navCount.textContent = '';
      text.textContent = t('museum.start');
      return;
    }
    this.navCount.textContent = `${this.current + 1}/${EXHIBITS.length}`;
    text.textContent = this.title(e);
    this.navTitle.setAttribute('aria-label', t('museum.navOpen', { title: this.title(e) }));
  }

  private relabel() {
    document.title = t('museum.docTitle');
    document.querySelectorAll<HTMLElement>('.m-ui [data-i18n]').forEach((x) => { x.textContent = t(x.dataset.i18n!); });
    document.querySelectorAll<HTMLElement>('.m-ui [data-i18n-attr]').forEach((x) => {
      for (const pair of x.dataset.i18nAttr!.split(';')) { const [a, k] = pair.split(':'); x.setAttribute(a, t(k)); }
    });
    this.syncNav();
    if (!this.card.hidden) this.render(EXHIBITS[this.current]);
    if (this.planDlg.open) this.fillPlan();
    if (this.creditsDlg.open) this.fillCredits();
    if (this.hintEl) this.hintEl.textContent = this.hintText();
  }

  private say(s: string) { this.live.textContent = s; }

  private trap(e: KeyboardEvent, root: HTMLElement) {
    const f = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length || innerWidth >= 900) return; // the side panel is not modal on large screens
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------------------------------------------------------------- card content
  private render(e: ExhibitDef) {
    const lang = getLang();
    const b = this.cardBody;
    b.innerHTML = '';
    const head = el('div', 'm-card-head');
    const chip = el('span', 'm-chip');
    const h2 = el('h2');
    h2.id = 'm-card-title';
    h2.tabIndex = -1;
    h2.textContent = this.title(e);
    head.append(chip, h2);
    b.append(head);

    if (e.kind === 'print') {
      const h = this.hot.get(e.hotspot!)!;
      chip.innerHTML = `<b>${esc(String(h.order))}</b> ${esc(this.d.content.meta.categories[h.category][lang])}`;
      chip.dataset.cat = h.category;
      b.append(el('p', 'm-lede', esc(loc(h, 'short', lang))));
      const photos = [e.photo!, ...h.photos.filter((p) => p !== e.photo)];
      b.append(this.figure(photos));
      for (const para of loc(h, 'long', lang).split(/\n\n+/)) b.append(el('p', '', esc(para)));
      if (h.facts.length) b.append(this.facts(h.facts.map((f) => [loc(f, 'label', lang), loc(f, 'value', lang)])));
      b.append(this.sources(h.sources));
      const a = el('a', 'm-link');
      a.href = `./#/h/${h.id}`;
      a.innerHTML = `${icons.mountain}<span>${esc(t('museum.onMap'))}</span>`;
      b.append(a);
    } else if (e.kind === 'intro') {
      chip.textContent = t('museum.intro.kicker');
      const m = this.d.content.meta;
      b.append(el('p', 'm-lede', esc(lang === 'fr' ? m.intro_fr : m.intro_en)));
      const stats = el('dl', 'm-stats');
      for (const s of m.stats) stats.append(el('div', '', `<dt>${esc(lang === 'fr' ? s.label_fr : s.label_en)}</dt><dd>${esc(s.value)}</dd>`));
      b.append(stats);
      b.append(el('h3', '', esc(t('museum.howto.title'))));
      const ul = el('ul', 'm-howto');
      for (const k of ['museum.howto.look', 'museum.howto.walk', 'museum.howto.exhibit', 'museum.howto.keys']) ul.append(el('li', '', esc(t(k))));
      b.append(ul);
      b.append(el('p', 'm-note', esc(t('museum.intro.note'))));
    } else if (e.kind === 'relief') {
      chip.textContent = t('museum.relief.kicker');
      const r = this.d.relief;
      b.append(el('p', 'm-lede', esc(t('museum.relief.short'))));
      b.append(el('p', '', esc(t('museum.relief.long'))));
      const nf = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 });
      b.append(this.facts([
        [t('museum.relief.fScale'), `≈ 1 : ${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB').format(Math.round(r.scale / 100) * 100)}`],
        [t('museum.relief.fExag'), `× ${nf.format(r.exag)}`],
        [t('museum.relief.fArea'), `${nf.format(r.wKm)} × ${nf.format(r.dKm)} km`],
        [t('museum.relief.fRange'), `${fmtMeters(r.minM)} – ${fmtMeters(r.maxM)}`],
      ]));
      b.append(el('h3', '', esc(t('museum.relief.markers'))));
      const ol = el('ul', 'm-markers');
      for (const x of EXHIBITS.filter((x) => x.kind === 'print')) {
        const li = el('li');
        const btn = el('button', 'm-marker');
        btn.type = 'button';
        btn.innerHTML = `<b>${esc(this.number(x))}</b><span>${esc(this.title(x))}</span>`;
        btn.addEventListener('click', () => this.d.onGo(x.id));
        li.append(btn);
        ol.append(li);
      }
      b.append(ol);
      b.append(this.sources(SOURCES_RELIEF));
    } else if (e.kind === 'window') {
      chip.textContent = t('museum.cg');
      chip.dataset.cat = 'cg';
      b.append(el('p', 'm-lede', esc(t('museum.window.short'))));
      b.append(el('p', '', esc(t('museum.window.long'))));
      b.append(this.sources([{ label: 'Poly Haven (CC0)', url: 'https://polyhaven.com' }, SOURCES_RELIEF[0], SOURCES_RELIEF[1]]));
      const a = el('a', 'm-link');
      a.href = './#/h/richard-molard';
      a.innerHTML = `${icons.mountain}<span>${esc(t('museum.onMap'))}</span>`;
      b.append(a);
    }

    // prev / next
    const pn = el('div', 'm-card-pn');
    const i = this.current;
    const n = EXHIBITS.length;
    const prevE = EXHIBITS[(i - 1 + n) % n], nextE = EXHIBITS[(i + 1) % n];
    const mk = (dir: number, x: ExhibitDef) => {
      const btn = el('button', `m-pn ${dir < 0 ? 'prev' : 'next'}`);
      btn.type = 'button';
      btn.innerHTML = `${dir < 0 ? icons.chevronLeft : ''}<span><small>${esc(t(dir < 0 ? 'museum.prevShort' : 'museum.nextShort'))}</small>${esc(this.title(x))}</span>${dir > 0 ? icons.chevronRight : ''}`;
      btn.addEventListener('click', () => this.d.onGo(x.id));
      return btn;
    };
    pn.append(mk(-1, prevE), mk(1, nextE));
    b.append(pn);
  }

  private figure(ids: string[]): HTMLElement {
    const lang = getLang();
    const fig = el('figure', 'm-fig');
    const frame = el('div', 'm-fig-img');
    const cap = el('figcaption');
    const thumbs = el('div', 'm-thumbs');
    const show = (id: string) => {
      const c = this.d.credits.get(id);
      frame.innerHTML = '';
      const { picture, img } = pictureFor(this.d.base, id, false);
      img.alt = c ? (lang === 'fr' ? c.alt_fr : c.alt_en) : '';
      img.decoding = 'async';
      if (c) { img.width = c.width; img.height = c.height; }
      frame.append(picture);
      cap.innerHTML = c
        ? `${esc(img.alt)}<br><span class="m-credit">© ${esc(c.author)} · <a href="${esc(c.license_url)}" target="_blank" rel="noopener">${esc(c.license)}</a> · <a href="${esc(c.source_url)}" target="_blank" rel="noopener">Wikimedia Commons</a></span>`
        : '';
      thumbs.querySelectorAll('button').forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.id === id)));
    };
    if (ids.length > 1) {
      ids.forEach((id, k) => {
        const bt = el('button', 'm-thumb');
        bt.type = 'button';
        bt.dataset.id = id;
        const c = this.d.credits.get(id);
        bt.setAttribute('aria-label', t('museum.photoN', { n: String(k + 1), total: String(ids.length) }) + (c ? ` – ${lang === 'fr' ? c.alt_fr : c.alt_en}` : ''));
        const { picture, img } = pictureFor(this.d.base, id, true);
        img.alt = '';
        img.loading = 'lazy';
        bt.append(picture);
        bt.addEventListener('click', () => show(id));
        thumbs.append(bt);
      });
    }
    show(ids[0]);
    fig.append(frame, cap);
    if (ids.length > 1) fig.append(thumbs);
    return fig;
  }

  private facts(rows: [string, string][]): HTMLElement {
    const wrap = el('div', 'm-facts');
    wrap.append(el('h3', '', esc(t('museum.facts'))));
    const dl = el('dl');
    for (const [k, v] of rows) dl.append(el('div', '', `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`));
    wrap.append(dl);
    return wrap;
  }

  private sources(list: { label: string; url: string }[]): HTMLElement {
    const wrap = el('div', 'm-sources');
    wrap.append(el('h3', '', esc(t('museum.sources'))));
    const ul = el('ul');
    for (const s of list) ul.append(el('li', '', `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}<span class="sr-only"> ${esc(t('panel.newTab'))}</span></a>`));
    wrap.append(ul);
    return wrap;
  }

  // ---------------------------------------------------------------- plan + list
  openPlan() {
    this.fillPlan();
    this.planDlg.showModal();
  }

  private fillPlan() {
    const dlg = this.planDlg;
    dlg.innerHTML = '';
    const head = el('div', 'm-dlg-head');
    head.innerHTML = `<h2 id="m-plan-title">${esc(t('museum.plan'))}</h2>`;
    const close = el('button', 'btn-icon');
    close.type = 'button';
    close.innerHTML = icons.close;
    close.setAttribute('aria-label', t('museum.close'));
    close.addEventListener('click', () => dlg.close());
    head.append(close);
    dlg.append(head, el('p', 'm-sub', esc(t('museum.gallery'))));
    dlg.append(this.planSvg());
    const ul = el('ol', 'm-list');
    for (const x of EXHIBITS) {
      const li = el('li');
      const btn = el('button', 'm-marker');
      btn.type = 'button';
      btn.innerHTML = `<b>${esc(this.number(x))}</b><span>${esc(this.title(x))}</span>`;
      btn.addEventListener('click', () => { dlg.close(); this.d.onGo(x.id); });
      li.append(btn);
      ul.append(li);
    }
    dlg.append(ul);
  }

  /** Floor plan of the gallery (north up), exhibits numbered like the labels. */
  private planSvg(): SVGSVGElement {
    const s = 22; // px per metre
    const W = (HX * 2) * s, H = (HZ * 2) * s;
    const X = (x: number) => (x + HX) * s, Z = (z: number) => (z + HZ) * s;
    const parts: string[] = [];
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="pl-floor"/>`);
    parts.push(`<line x1="${X(WINDOW.x0)}" y1="1" x2="${X(WINDOW.x1)}" y2="1" class="pl-window"/>`);
    parts.push(`<line x1="${X(DOOR.x0)}" y1="${H - 1}" x2="${X(DOOR.x1)}" y2="${H - 1}" class="pl-door"/>`);
    const r = (b: typeof PLINTH_BOX, cls: string) => parts.push(`<rect x="${X(b.min.x)}" y="${Z(b.min.z)}" width="${(b.max.x - b.min.x) * s}" height="${(b.max.z - b.min.z) * s}" class="${cls}"/>`);
    r(PLINTH_BOX, 'pl-plinth');
    r(BENCH_BOX, 'pl-bench');
    const dot = (x: number, z: number, label: string, id: string) =>
      parts.push(`<g class="pl-dot" data-id="${id}"><circle cx="${x}" cy="${z}" r="13"/><text x="${x}" y="${z + 4.5}" text-anchor="middle">${esc(label)}</text></g>`);
    for (const x of EXHIBITS) {
      if (x.kind === 'print' || x.kind === 'intro') {
        const f = wallFrame(x.wall!);
        const w = x.kind === 'intro' ? 4.6 : printSize(1.5).w;
        parts.push(`<line x1="${X(f.x + f.normal.x * 0.12)}" y1="${Z(x.z! - w / 2)}" x2="${X(f.x + f.normal.x * 0.12)}" y2="${Z(x.z! + w / 2)}" class="pl-art"/>`);
        dot(X(f.x + f.normal.x * 0.9), Z(x.z!), this.number(x), x.id);
      } else if (x.kind === 'relief') dot(X((PLINTH_BOX.min.x + PLINTH_BOX.max.x) / 2), Z((PLINTH_BOX.min.z + PLINTH_BOX.max.z) / 2), this.number(x), x.id);
      else dot(X(0), Z(-HZ + 1.0), this.number(x), x.id);
    }
    parts.push(`<text x="${W / 2}" y="${H + 18}" text-anchor="middle" class="pl-label">${esc(t('museum.entrance'))}</text>`);
    parts.push(`<text x="${W / 2}" y="-8" text-anchor="middle" class="pl-label">${esc(t('museum.windowN'))}</text>`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `-10 -24 ${W + 20} ${H + 48}`);
    svg.setAttribute('class', 'm-plan-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('museum.planAlt'));
    svg.innerHTML = parts.join('');
    svg.addEventListener('click', (ev) => {
      const g = (ev.target as Element).closest('.pl-dot') as SVGGElement | null;
      if (g?.dataset.id) { this.planDlg.close(); this.d.onGo(g.dataset.id); }
    });
    return svg;
  }

  // ---------------------------------------------------------------- credits
  openCredits() {
    this.fillCredits();
    this.creditsDlg.showModal();
  }

  private fillCredits() {
    const dlg = this.creditsDlg;
    const lang = getLang();
    dlg.innerHTML = '';
    const head = el('div', 'm-dlg-head');
    head.innerHTML = `<h2 id="m-credits-title">${esc(t('museum.credits'))}</h2>`;
    const close = el('button', 'btn-icon');
    close.type = 'button';
    close.innerHTML = icons.close;
    close.setAttribute('aria-label', t('museum.close'));
    close.addEventListener('click', () => dlg.close());
    head.append(close);
    dlg.append(head);
    dlg.append(el('p', 'm-credit-line', esc(t('museum.creditLine'))));
    dlg.append(el('h3', '', esc(t('museum.credits.photos'))));
    const used = new Set<string>();
    for (const x of EXHIBITS) if (x.hotspot) for (const p of this.hot.get(x.hotspot)!.photos) used.add(p);
    const ul = el('ul', 'm-credit-list');
    for (const id of used) {
      const c = this.d.credits.get(id);
      if (!c) continue;
      ul.append(el('li', '', `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.commons_title.replace(/^File:/, ''))}</a> – ${esc(c.author)}, <a href="${esc(c.license_url)}" target="_blank" rel="noopener">${esc(c.license)}</a>${lang === 'fr' ? ', via Wikimedia Commons (redimensionnée)' : ', via Wikimedia Commons (resized)'}`));
    }
    dlg.append(ul);
    dlg.append(el('h3', '', esc(t('museum.credits.data'))));
    const data = el('ul', 'm-credit-list');
    for (const k of ['dem', 'worldcover', 'wdpa', 'geob']) data.append(el('li', '', esc(t(`museum.credits.${k}`))));
    dlg.append(data);
    dlg.append(el('h3', '', esc(t('museum.credits.materials'))));
    const mats = el('ul', 'm-credit-list');
    for (const m of this.d.textureCredits) mats.append(el('li', '', `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a> – ${esc(m.authors.join(', '))}, ${esc(m.license)} (Poly Haven)`));
    mats.append(el('li', '', esc(t('museum.credits.pano'))));
    dlg.append(mats);
    dlg.append(el('h3', '', esc(t('museum.credits.correct'))));
    dlg.append(el('p', '', esc(t('museum.credits.correctText'))));
  }

  // ---------------------------------------------------------------- hint, loading
  private hintText() {
    return matchMedia('(pointer: coarse)').matches ? t('museum.hint.touch') : t('museum.hint.mouse');
  }

  showHint() {
    try { if (localStorage.getItem('nimba.museum.hint')) return; } catch { /* ignore */ }
    this.hintEl = el('div', 'm-hint');
    this.hintEl.textContent = this.hintText();
    document.body.append(this.hintEl);
    setTimeout(() => this.dismissHint(), 9000);
  }

  dismissHint() {
    const h = this.hintEl;
    if (!h) return;
    this.hintEl = null;
    h.classList.add('gone');
    setTimeout(() => h.remove(), 500);
    try { localStorage.setItem('nimba.museum.hint', '1'); } catch { /* ignore */ }
  }

  /** WebGL unavailable: the plan and list are the museum. */
  fallback() {
    document.body.classList.add('m-nogl');
    const p = el('p', 'm-nogl-msg', esc(t('museum.nogl')));
    document.querySelector('.m-ui')!.prepend(p);
    this.openPlan();
  }
}
