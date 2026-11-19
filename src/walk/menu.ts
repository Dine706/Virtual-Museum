import { getLang, onLang, setLang, t } from '../i18n';
import { DEFAULT_SETTINGS, saveSettings, type WalkSettings } from './settings';
import { icons } from '../ui/icons';

export class WalkMenu {
  readonly dialog = document.createElement('dialog');
  private unsubscribe: () => void;
  onChange: () => void = () => {};
  onOpen: (open: boolean) => void = () => {};
  private opener: HTMLElement | null = null;
  private credits: { assets: Credit[]; data: Credit[]; libraryAssets: Credit[] } | null = null;

  constructor(private settings: WalkSettings) {
    this.dialog.className = 'walk-menu';
    this.dialog.setAttribute('aria-labelledby', 'walk-menu-title');
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => { this.onOpen(false); this.opener?.focus(); });
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) {
      const r = this.dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.dialog.close();
    } });
    this.unsubscribe = onLang(() => this.render());
    this.render();
  }

  private render() {
    const s = this.settings;
    this.dialog.innerHTML = `
      <header><p class="walk-kicker">${t('walk.menu.eyebrow')}</p>
        <h2 id="walk-menu-title">${t('walk.menu.title')}</h2>
        <button type="button" class="walk-card-close" aria-label="${t('walk.close')}">${icons.close}</button>
      </header>
      <div class="walk-menu-body">
        <div class="walk-menu-language"><span>${t('walk.menu.language')}</span><div>
          <button type="button" lang="fr" aria-pressed="${getLang() === 'fr'}">Français</button>
          <button type="button" lang="en" aria-pressed="${getLang() === 'en'}">English</button></div></div>
        <label class="walk-setting">${t('walk.menu.fov')} <output id="walk-fov-value">${s.fov}°</output>
          <input id="walk-fov" type="range" min="55" max="100" value="${s.fov}" aria-describedby="walk-fov-value"></label>
        <label class="walk-setting">${t('walk.menu.sensitivity')} <output id="walk-sensitivity-value">${s.sensitivity.toFixed(2)}×</output>
          <input id="walk-sensitivity" type="range" min="0.25" max="2.5" step="0.05" value="${s.sensitivity}" aria-describedby="walk-sensitivity-value"></label>
        <label class="walk-setting-check"><span>${t('walk.menu.bob')}</span><input id="walk-bob" type="checkbox" ${s.headBob ? 'checked' : ''}></label>
        <label class="walk-setting-check"><span>${t('walk.menu.motion')}</span><input id="walk-motion" type="checkbox" ${s.reducedMotion ? 'checked' : ''}></label>
        <label class="walk-setting">${t('walk.menu.quality')}
          <select id="walk-quality">${['auto', 'high', 'mid', 'low'].map((q) => `<option value="${q}" ${q === s.quality ? 'selected' : ''}>${t(`walk.menu.quality.${q}`)}</option>`).join('')}</select>
          <small>${t('walk.menu.qualityHint')}</small></label>
        <details class="walk-menu-help" open><summary>${t('walk.menu.controls')}</summary>
          <dl><div><dt>WASD / ZQSD</dt><dd>${t('walk.controls.move')}</dd></div>
          <div><dt>${t('walk.controls.mouse')}</dt><dd>${t('walk.controls.look')}</dd></div>
          <div><dt>Shift</dt><dd>${t('walk.controls.sprint')}</dd></div>
          <div><dt>${t('walk.controls.space')}</dt><dd>${t('walk.controls.jump')}</dd></div>
          <div><dt>${t('walk.controls.gamepad')}</dt><dd>${t('walk.controls.gamepadHelp')}</dd></div></dl>
        </details>
        <p class="walk-menu-disclosure">${t('walk.menu.disclosure')}</p>
        <details class="walk-menu-credits"><summary>${t('walk.menu.credits')}</summary><div class="walk-credits-body"></div></details>
        <footer><button type="button" class="walk-reset">${t('walk.menu.reset')}</button>
        <button type="button" class="walk-resume">${t('walk.menu.resume')}</button></footer>
      </div>`;
    this.dialog.querySelector('.walk-card-close')!.addEventListener('click', () => this.dialog.close());
    this.dialog.querySelector('.walk-resume')!.addEventListener('click', () => this.dialog.close());
    this.dialog.querySelector('.walk-reset')!.addEventListener('click', () => {
      Object.assign(s, DEFAULT_SETTINGS); this.changed(); this.render();
    });
    this.dialog.querySelectorAll<HTMLButtonElement>('button[lang]').forEach((b) => b.addEventListener('click', () => {
      setLang(b.lang === 'fr' ? 'fr' : 'en');
      this.dialog.querySelector<HTMLButtonElement>(`button[lang="${getLang()}"]`)?.focus();
    }));
    this.bindRange('fov', (v) => `${v}°`);
    this.bindRange('sensitivity', (v) => `${v.toFixed(2)}×`);
    for (const [id, key] of [['bob', 'headBob'], ['motion', 'reducedMotion']] as const) {
      this.dialog.querySelector<HTMLInputElement>(`#walk-${id}`)!.addEventListener('change', (e) => {
        s[key] = (e.target as HTMLInputElement).checked; this.changed();
      });
    }
    this.dialog.querySelector<HTMLSelectElement>('#walk-quality')!.addEventListener('change', (e) => {
      s.quality = (e.target as HTMLSelectElement).value as WalkSettings['quality']; this.changed();
    });
    this.dialog.querySelector('.walk-menu-credits')!.addEventListener('toggle', async (e) => {
      const details = e.target as HTMLDetailsElement;
      if (!details.open) return;
      const target = details.querySelector<HTMLDivElement>('.walk-credits-body')!;
      if (target.childNodes.length) return;
      target.textContent = t('walk.menu.creditsLoading');
      try {
        if (!this.credits) {
          const response = await fetch(`${import.meta.env.BASE_URL}credits.json`);
          if (!response.ok) throw new Error('Credits unavailable');
          this.credits = await response.json();
        }
        target.textContent = '';
        for (const record of [...this.credits!.data, ...this.credits!.assets, ...this.credits!.libraryAssets]) {
          const entry = document.createElement('p');
          const link = document.createElement('a');
          link.textContent = record.name;
          link.href = new URL(record.url, location.href).href;
          link.target = '_blank'; link.rel = 'noopener';
          const author = record.author ?? record.authors?.join(', ') ?? '';
          const detail = document.createElement('span');
          detail.textContent = ` · ${author} · ${record.license}${record.attribution ? ` — ${record.attribution}` : ''}`;
          entry.append(link, detail); target.append(entry);
        }
      } catch { target.textContent = t('walk.menu.creditsError'); }
    });
  }

  private bindRange(key: 'fov' | 'sensitivity', format: (v: number) => string) {
    this.dialog.querySelector<HTMLInputElement>(`#walk-${key}`)!.addEventListener('input', (e) => {
      this.settings[key] = Number((e.target as HTMLInputElement).value);
      this.dialog.querySelector<HTMLOutputElement>(`#walk-${key}-value`)!.value = format(this.settings[key]);
      this.changed();
    });
  }
  private changed() { saveSettings(this.settings); this.onChange(); }
  get open() { return this.dialog.open; }
  show(opener: HTMLElement) {
    this.opener = opener;
    if (document.pointerLockElement) document.exitPointerLock();
    this.onOpen(true); this.dialog.showModal();
  }
  dispose() { this.unsubscribe(); this.dialog.remove(); }
}

interface Credit { name: string; url: string; license: string; author?: string; authors?: string[]; attribution?: string }
