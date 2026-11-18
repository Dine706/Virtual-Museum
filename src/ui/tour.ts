// Guided tour (for presentations): the intro flyover, then four places on foot – cloud forest, Bossou village,
// the LAMCO pit lake, the summit – each with a short sourced caption, then back to the map. No clicks needed;
// "Next" skips ahead, "Exit tour" leaves the visitor where they are. Captions reuse content.json hotspot texts
// and the sourced village text; nothing new is claimed here.
import { applyStatic, t, getLang } from '../i18n';
import { lonLatToXZ } from '../data/geo';
import type { Content, Hotspot } from '../data/content';
import type { WalkHandle } from '../walk';
import type { WalkTime } from '../walk/env';

interface Stop {
  key: string; lon: number; lat: number; yaw: number; pitch: number; time: WalkTime;
  /** autopilot: fraction of walking pace, turn rate (rad/s) */
  speed: number; turn: number;
  text: () => string;
  people?: boolean;
}

export interface TourDeps {
  content: Content;
  reducedMotion: boolean;
  /** presenter mode: each stop waits for Next (no timer) */
  hold?: boolean;
  flyover: () => Promise<void>;
  enterWalk: (x: number, z: number) => Promise<WalkHandle | null>;
  walking: () => WalkHandle | null;
  goHome: () => void;
}

const STOP_MS = 15000;

export function runTour(d: TourDeps): { stop: () => void } {
  const hs = (id: string): Hotspot | undefined => d.content.hotspots.find((h) => h.id === id);
  const short = (id: string) => { const h = hs(id); return h ? (getLang() === 'fr' ? h.short_fr : h.short_en) : ''; };
  const STOPS: Stop[] = [
    { key: 'forest', lon: -8.4000, lat: 7.6700, yaw: 0.6, pitch: 0.02, time: 'morning', speed: 0.45, turn: 0.05, text: () => short('cloud-forest') },
    { key: 'village', lon: -8.5055, lat: 7.6508, yaw: 2.4, pitch: -0.04, time: 'morning', speed: 0.15, turn: -0.04, text: () => t('walk.village.bossou'), people: true },
    { key: 'lamco', lon: -8.4995, lat: 7.5410, yaw: -2.32, pitch: -0.08, time: 'noon', speed: 0, turn: 0.07, text: () => short('yekepa-lamco') },
    { key: 'summit', lon: -8.4083, lat: 7.6219, yaw: -0.8, pitch: -0.16, time: 'morning', speed: 0, turn: 0.09, text: () => short('richard-molard') },
  ];
  const total = STOPS.length + 1; // the flyover is stop 1

  // ---- UI ----
  const el = document.createElement('section');
  el.className = 'tour';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <p class="tour-kicker"></p>
    <h2 class="tour-title"></h2>
    <p class="tour-text"></p>
    <p class="tour-note"></p>
    <div class="tour-bar"><i></i></div>
    <div class="tour-actions">
      <button type="button" class="btn-primary tour-next" data-i18n="tour.next"></button>
      <button type="button" class="btn-ghost tour-pano" hidden data-i18n="pano.button"></button>
      <button type="button" class="btn-ghost tour-exit" data-i18n="tour.exit"></button>
    </div>`;
  applyStatic(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const kicker = $<HTMLParagraphElement>('.tour-kicker'), title = $<HTMLHeadingElement>('.tour-title');
  const text = $<HTMLParagraphElement>('.tour-text'), note = $<HTMLParagraphElement>('.tour-note');
  const bar = $<HTMLElement>('.tour-bar i'), next = $<HTMLButtonElement>('.tour-next'), exitBtn = $<HTMLButtonElement>('.tour-exit');
  document.body.append(el);
  document.body.classList.add('touring');

  let aborted = false;
  let wake: (() => void) | null = null;
  const show = (n: number, key: string, body: string, ms: number) => {
    kicker.textContent = n > total ? t('tour.done') : t('tour.step', { n: String(n), total: String(total) });
    title.textContent = t(`tour.${key}.title`);
    text.textContent = body;
    const nt = t(`tour.${key}.note`);
    note.textContent = nt === `tour.${key}.note` ? '' : nt;
    note.hidden = !note.textContent;
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(0)';
    void bar.offsetWidth;
    bar.style.transition = ms ? `transform ${ms}ms linear` : '';
    bar.style.transform = ms ? 'scaleX(1)' : 'scaleX(0)';
    el.classList.add('on');
    el.classList.remove('busy');
  };
  const busy = () => { el.classList.add('busy'); title.textContent = t('tour.loading'); text.textContent = ''; note.hidden = true; };
  /** Wait ms, or until Next / exit; also ends if the visitor left walk mode themselves. */
  const wait = (ms: number, needWalk: boolean) => new Promise<void>((res) => {
    let t0 = performance.now();
    const iv = setInterval(() => {
      if (document.querySelector('.pano-viewer')) { t0 += 200; return; } // the 360° view pauses the stop
      if (aborted || performance.now() - t0 >= ms || (needWalk && !d.walking())) { if (needWalk && !d.walking()) stop(); done(); }
    }, 200);
    const done = () => { clearInterval(iv); wake = null; res(); };
    wake = done;
  });

  function stop() {
    if (aborted) return;
    aborted = true;
    d.walking()?.tour.autopilot(0);
    wake?.();
    document.body.classList.remove('touring');
    el.classList.remove('on');
    setTimeout(() => el.remove(), 400);
  }
  next.addEventListener('click', () => wake?.());
  const panoBtn = $<HTMLButtonElement>('.tour-pano');
  panoBtn.addEventListener('click', () => { void d.walking()?.tour.openPano(); });
  exitBtn.addEventListener('click', stop);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !aborted) { e.preventDefault(); e.stopImmediatePropagation(); stop(); } };
  window.addEventListener('keydown', onKey, true);

  (async () => {
    // 1. The massif from the air (the intro flyover has its own captions and Skip button).
    el.classList.remove('on');
    await d.flyover();
    if (aborted) return;
    // 2–5. On foot.
    let walk: WalkHandle | null = null;
    for (let i = 0; i < STOPS.length && !aborted; i++) {
      const s = STOPS[i];
      const [x, z] = lonLatToXZ(s.lon, s.lat);
      el.classList.add('on');
      busy();
      if (!walk) {
        walk = await d.enterWalk(x, z);
        if (!walk) break;
        walk.tour.look(s.yaw, s.pitch, s.time);
      } else {
        await walk.tour.go(x, z, s.yaw, s.pitch, s.time);
      }
      if (aborted || !d.walking()) break;
      if (s.people) { await new Promise((r) => setTimeout(r, 600)); walk.tour.facePeople(); }
      const ms = d.hold ? 0 : d.reducedMotion ? STOP_MS * 0.8 : STOP_MS;
      show(i + 2, s.key, s.text(), ms);
      panoBtn.hidden = !walk.tour.hasPano;
      walk.tour.autopilot(d.reducedMotion ? 0 : s.speed, d.reducedMotion ? 0 : s.turn);
      await wait(ms || 3.6e6, true);
      walk.tour.autopilot(0);
    }
    if (aborted) return;
    // Back to the map: the visitor's turn.
    panoBtn.hidden = true;
    d.walking()?.exit();
    d.goHome();
    show(total + 1, 'end', t('tour.end.text'), 0);
    next.textContent = t('tour.start');
    exitBtn.hidden = true;
    next.focus({ preventScroll: true });
    await wait(60000, false);
    stop();
  })().catch((e) => { console.error(e); stop(); }).finally(() => window.removeEventListener('keydown', onKey, true));

  return { stop };
}
