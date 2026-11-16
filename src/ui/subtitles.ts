// Flyover subtitles (DESIGN.md §5): three short lines that fade in and out, plus a visible Skip button.
import { fmtMeters, t } from '../i18n';

const CUES: { from: number; to: number; key: string }[] = [
  { from: 0.04, to: 0.3, key: 'flyover.s1' },
  { from: 0.37, to: 0.63, key: 'flyover.s2' },
  { from: 0.7, to: 0.94, key: 'flyover.s3' },
];

export class Subtitles {
  private el: HTMLDivElement;
  private line: HTMLParagraphElement;
  private skip: HTMLButtonElement;
  private current = -1;

  constructor(onSkip: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'flyover-ui';
    this.el.innerHTML = `<p class="subtitle-line" aria-live="polite"></p><button type="button" class="btn-ghost flyover-skip"></button>`;
    this.line = this.el.querySelector('.subtitle-line')!;
    this.skip = this.el.querySelector('.flyover-skip')!;
    this.skip.textContent = t('flyover.skip');
    this.skip.addEventListener('click', (e) => { e.stopPropagation(); onSkip(); });
    document.body.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('on'));
    this.skip.focus({ preventScroll: true });
  }

  update(progress: number) {
    const i = CUES.findIndex((c) => progress >= c.from && progress <= c.to);
    if (i === this.current) return;
    this.current = i;
    this.line.classList.remove('show');
    if (i >= 0) {
      const text = t(CUES[i].key, { elev: fmtMeters(1752) });
      setTimeout(() => { this.line.textContent = text; this.line.classList.add('show'); }, 180);
    }
  }

  close() {
    this.el.classList.remove('on');
    setTimeout(() => this.el.remove(), 500);
  }
}
