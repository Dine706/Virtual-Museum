// FR | EN pill (aria-pressed). Several instances can exist (title card, top bar, rail); all stay in sync.
import { getLang, onLang, setLang } from '../i18n';
import type { Lang } from '../data/content';

export function langToggle(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pill-toggle lang';
  wrap.setAttribute('role', 'group');
  wrap.dataset.i18nAttr = 'aria-label:lang.label';
  const make = (l: Lang, label: string, full: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.lang = l;
    b.setAttribute('aria-label', full);
    b.addEventListener('click', () => setLang(l));
    return b;
  };
  const fr = make('fr', 'FR', 'Français');
  const en = make('en', 'EN', 'English');
  wrap.append(fr, en);
  const sync = (l: Lang) => {
    fr.setAttribute('aria-pressed', String(l === 'fr'));
    en.setAttribute('aria-pressed', String(l === 'en'));
  };
  sync(getLang());
  onLang(sync);
  return wrap;
}
