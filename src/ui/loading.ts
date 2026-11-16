// Drives the loading state of the title card (index.html) with real byte progress.
import { t } from '../i18n';

const card = () => document.getElementById('title-card');

export function setLoadingText() {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = t('loading.text');
}

/** Aggregate progress of several downloads, weighted by expected size. */
export class Progress {
  private parts = new Map<string, { loaded: number; total: number }>();
  track(name: string, expectedBytes: number) {
    this.parts.set(name, { loaded: 0, total: expectedBytes });
    return (loaded: number, total: number) => {
      this.parts.set(name, { loaded, total: Math.max(total, expectedBytes * 0.5) });
      this.render();
    };
  }
  private render() {
    let l = 0, tt = 0;
    for (const p of this.parts.values()) { l += p.loaded; tt += p.total; }
    const pct = tt ? Math.min(99, Math.round((l / tt) * 100)) : 0;
    const pctEl = document.getElementById('loading-pct');
    const bar = document.getElementById('loading-bar');
    if (pctEl) pctEl.textContent = `${pct}\u00a0%`;
    if (bar) bar.style.width = `${pct}%`;
  }
}

/** The terrain is on screen: finish the progress, reveal the scene behind the card.
 *  `keepCard`: the intro will turn the card into the title card; otherwise the card fades away. */
export function hideLoading(keepCard: boolean) {
  const pctEl = document.getElementById('loading-pct');
  const bar = document.getElementById('loading-bar');
  if (pctEl) pctEl.textContent = '100\u00a0%';
  if (bar) bar.style.width = '100%';
  const loading = document.getElementById('loading');
  loading?.classList.add('done');
  setTimeout(() => loading?.remove(), 500);
  const c = card();
  if (!c) return;
  c.classList.remove('loading');
  if (!keepCard) {
    c.classList.add('hidden');
    setTimeout(() => c.remove(), 700);
  }
}

export function showFatal(message: string) {
  const text = document.getElementById('loading-text');
  document.getElementById('loading-pct')?.remove();
  document.querySelector('#loading .bar')?.remove();
  if (text) { text.textContent = message; text.setAttribute('role', 'alert'); }
}
