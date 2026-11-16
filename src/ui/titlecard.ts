// Title card over the live (slowly drifting) terrain: H1, subtitle, Explorer / Passer, FR|EN.
// The card itself is static HTML in index.html (it is also the loading screen, so the title is painted
// from the first byte); this activates it once the terrain is ready.
import { applyStatic, onLang, setLang, suggestEnglish, t } from '../i18n';
import { langToggle } from './lang';

export function showTitleCard(opts: { onExplore: () => void; onSkip: () => void }): { close: () => void } {
  let el = document.getElementById('title-card');
  if (!el) {
    el = document.createElement('section');
    el.id = 'title-card';
    el.className = 'title-card';
    el.setAttribute('aria-labelledby', 'title-h1');
    el.innerHTML = `<div class="inner"><h1 id="title-h1" data-i18n="title.h1"></h1><p id="title-sub" class="subtitle" data-i18n="title.subtitle"></p></div>`;
    document.body.append(el);
  }
  const card = el;
  const inner = card.querySelector('.inner')!;
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button type="button" class="btn-primary" data-i18n="title.explore"></button>
    <button type="button" class="btn-ghost" data-i18n="title.skip"></button>`;
  // Above the (fading) progress block: nothing already on screen moves when the buttons arrive (CLS).
  inner.insertBefore(actions, document.getElementById('loading'));
  card.append(langToggle());
  if (suggestEnglish) {
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'suggest-en';
    hint.lang = 'en';
    hint.textContent = t('lang.switchHint');
    hint.addEventListener('click', () => { setLang('en'); hint.remove(); });
    inner.append(hint);
    onLang(() => hint.remove()); // any explicit choice answers the suggestion
  }
  applyStatic(card);
  requestAnimationFrame(() => card.classList.add('ready'));
  const [explore, skip] = actions.querySelectorAll<HTMLButtonElement>('button');
  explore.focus({ preventScroll: true });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    card.classList.add('hidden');
    setTimeout(() => card.remove(), 700);
  };
  explore.addEventListener('click', () => { close(); opts.onExplore(); });
  skip.addEventListener('click', () => { close(); opts.onSkip(); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); opts.onSkip(); } });
  return { close };
}
