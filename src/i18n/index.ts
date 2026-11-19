// Tiny i18n: FR is the default for everyone (DESIGN.md §11); EN only after an explicit choice.
import fr from './fr.json';
import en from './en.json';
import type { Lang } from '../data/content';

const dicts: Record<Lang, Record<string, string>> = { fr, en };
const KEY = 'nimba.lang';
const listeners = new Set<(l: Lang) => void>();

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'fr' || v === 'en' ? v : null;
  } catch { return null; }
}

let current: Lang = stored() ?? 'fr';

/** True on a first visit from an English browser: we suggest English instead of switching silently. */
export const suggestEnglish = stored() === null && /^en\b/i.test(navigator.language ?? '');

export const getLang = () => current;

export function t(key: string, vars?: Record<string, string>): string {
  let s = dicts[current][key] ?? dicts.fr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function setLang(lang: Lang) {
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function onLang(fn: (l: Lang) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Fill every element carrying data-i18n / data-i18n-attr from the dictionary. */
export function applyStatic(root: ParentNode = document) {
  document.documentElement.lang = current;
  document.title = t('app.title');
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    // format: "aria-label:key;title:key"
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  });
}

const nf: Record<Lang, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }),
};
/** "1 752 m" (narrow no-break space) in FR, "1,752 m" in EN. */
export const fmtMeters = (m: number) => `${nf[current].format(m)} m`;
