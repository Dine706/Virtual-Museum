// Title card over the live (slowly rotating) terrain: H1, subtitle, Explorer / Skip, FR|EN, credit line.
import { applyStatic, setLang, suggestEnglish, t } from '../i18n';
import { langToggle } from './lang';

export function showTitleCard(opts: { onExplore: () => void; onSkip: () => void }): { close: () => void } {
  const el = document.createElement('section');
  el.className = 'title-card';
  el.setAttribute('aria-labelledby', 'title-h1');
  el.innerHTML = `
    <div class="inner">
      <h1 id="title-h1" data-i18n="title.h1"></h1>
      <p class="subtitle" data-i18n="title.subtitle"></p>
      <div class="actions">
        <button type="button" class="btn-primary" data-i18n="title.explore"></button>
        <button type="button" class="btn-ghost" data-i18n="title.skip"></button>
      </div>
    </div>
    <p class="credit-line" data-i18n="footer.credit"></p>`;
  el.append(langToggle());
  if (suggestEnglish) {
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'suggest-en';
    hint.lang = 'en';
    hint.textContent = t('lang.switchHint');
    hint.addEventListener('click', () => { setLang('en'); hint.remove(); });
    el.querySelector('.inner')!.append(hint);
  }
  document.body.append(el);
  applyStatic(el);
  const [explore, skip] = el.querySelectorAll<HTMLButtonElement>('.actions button');
  explore.focus({ preventScroll: true });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 700);
  };
  explore.addEventListener('click', () => { close(); opts.onExplore(); });
  skip.addEventListener('click', () => { close(); opts.onSkip(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); opts.onSkip(); } });
  return { close };
}
