// Drives the inline loading screen from index.html with real byte progress.
import { t } from '../i18n';

const root = () => document.getElementById('loading');

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
    if (pctEl) pctEl.textContent = `${pct} %`;
    if (bar) bar.style.width = `${pct}%`;
  }
}

export function hideLoading() {
  const el = root();
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 600);
}

export function showFatal(message: string) {
  hideLoading();
  const d = document.createElement('div');
  d.className = 'fatal';
  d.setAttribute('role', 'alert');
  d.textContent = message;
  document.body.append(d);
}
