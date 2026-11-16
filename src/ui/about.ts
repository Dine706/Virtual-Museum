// About / Credits sheet (CLAUDE.md §2.8, §12; DESIGN.md §12): project note, how-to, settings (quality tier,
// atmosphere), every data licence from docs/DATA_LICENCES.md (attribution texts verbatim), all photo
// credits from credits.json, texts, software, "correct us" placeholder. Native <dialog>: top layer, Esc,
// focus containment and return. The only surface that follows prefers-color-scheme (CLAUDE.md §11).
import { getLang, t } from '../i18n';
import { thumbUrl, type PhotoCredit } from '../data/content';
import { BASE } from '../flags';
import type { AtmoName } from '../scene/atmosphere';
import type { Tier } from '../scene/tier';
import { icons } from './icons';

/** docs/DATA_LICENCES.md – attribution texts reproduced exactly. */
const DATA = [
  {
    name: 'Copernicus DEM GLO-30',
    use: { fr: 'Relief 3D, altitudes', en: '3D relief, elevations' },
    licence: 'Copernicus DEM licence',
    text: 'Contains modified Copernicus DEM GLO-30 data © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
  },
  {
    name: 'ESA WorldCover 2021 v200',
    use: { fr: "Couleurs du terrain, occupation du sol", en: 'Terrain colours, land cover' },
    licence: 'CC BY 4.0',
    text: 'Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).',
    url: 'https://esa-worldcover.org',
  },
  {
    name: 'WDPA',
    use: { fr: 'Limite de la réserve (simplifiée)', en: 'Reserve boundary (simplified)' },
    licence: 'UNEP-WCMC / IUCN WDPA terms – non-commercial use',
    text: 'UNEP-WCMC and IUCN (2026), Protected Planet: The World Database on Protected Areas (WDPA), www.protectedplanet.net',
    url: 'https://www.protectedplanet.net',
  },
  {
    name: 'geoBoundaries (William & Mary geoLab)',
    use: { fr: 'Frontières (approximatives)', en: 'Borders (approximate)' },
    licence: 'Guinea: CC BY-SA 2.0 · Liberia: CC BY 3.0 IGO · Côte d\'Ivoire: public domain',
    text: 'geoBoundaries (William & Mary geoLab)',
    url: 'https://www.geoboundaries.org',
  },
  {
    name: 'OpenStreetMap',
    use: { fr: 'Enclave minière (approximative), positions des villages', en: 'Mining enclave (approximate), village positions' },
    licence: 'ODbL',
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
  {
    name: 'Wikidata',
    use: { fr: 'Coordonnées des sommets et lieux', en: 'Coordinates of peaks and places' },
    licence: 'CC0',
    text: 'Wikidata (CC0)',
    url: 'https://www.wikidata.org',
  },
];

const SOFTWARE = [
  ['three.js', 'MIT', 'https://threejs.org'],
  ['Vite', 'MIT', 'https://vite.dev'],
  ['Fraunces · Inter (Fontsource)', 'SIL Open Font License 1.1', 'https://fontsource.org'],
];

export interface AboutHandlers {
  tier: Tier;
  savedTier: () => Tier | null;
  setTier: (t: Tier | null) => void;
  atmo: () => AtmoName;
  setAtmo: (a: AtmoName) => void;
}

export class AboutSheet {
  private dlg: HTMLDialogElement;

  constructor(private credits: Map<string, PhotoCredit>, private h: AboutHandlers) {
    this.dlg = document.createElement('dialog');
    this.dlg.className = 'about';
    this.dlg.setAttribute('aria-labelledby', 'about-title');
    document.body.append(this.dlg);
    this.dlg.addEventListener('click', (e) => { if (e.target === this.dlg) this.dlg.close(); }); // backdrop click
  }

  get isOpen() { return this.dlg.open; }

  open() {
    this.render();
    this.dlg.showModal();
    (this.dlg.querySelector('#about-title') as HTMLElement).focus({ preventScroll: true });
  }

  relabel() { if (this.dlg.open) this.render(); }

  private render() {
    const lang = getLang();
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const link = (url: string, label: string) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}<span class="sr-only"> ${esc(t('panel.newTab'))}</span></a>`;
    const saved = this.h.savedTier();
    const tierName = (x: Tier) => t(`about.quality${x === 'high' ? 'High' : x === 'mid' ? 'Mid' : 'Low'}`);
    const tierOpts = (['auto', 'high', 'mid', 'low'] as const).map((k) => {
      const checked = k === 'auto' ? saved === null : saved === k;
      const label = k === 'auto' ? t('about.qualityAuto') : tierName(k);
      return `<label class="opt"><input type="radio" name="tier" value="${k}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    }).join('');
    const atmoOpts = (['clear', 'golden', 'mist'] as AtmoName[]).map((a) =>
      `<label class="opt"><input type="radio" name="atmo" value="${a}" ${this.h.atmo() === a ? 'checked' : ''}><span>${esc(t(`atmo.${a}`))}</span></label>`).join('');
    const photos = [...this.credits.values()];
    const photoItems = photos.map((p) => `
      <li><img src="${thumbUrl(BASE, p.id)}" alt="" width="64" height="${Math.round((64 * p.height) / p.width)}" loading="lazy" decoding="async">
        <span>${esc(lang === 'en' ? p.alt_en : p.alt_fr)}<br><small>${link(p.source_url, p.attribution.replace(/\s*\(https?:[^)]*\)\s*$/, ''))}</small></span></li>`).join('');

    this.dlg.innerHTML = `
      <div class="about-head">
        <h2 id="about-title" tabindex="-1">${esc(t('about.title'))}</h2>
        <button type="button" class="btn-icon about-close" aria-label="${esc(t('about.close'))}">${icons.close}</button>
      </div>
      <div class="about-body">
        <p class="about-lead">${esc(t('about.project'))}</p>
        <p>${esc(t('about.howTo'))}</p>
        <p class="about-privacy">${esc(t('about.privacy'))}</p>

        <h3>${esc(t('about.settings'))}</h3>
        <fieldset><legend>${esc(t('about.quality'))}</legend><div class="opts">${tierOpts}</div>
          <p class="hint-text">${esc(t('about.qualityCurrent', { tier: tierName(this.h.tier) }))} · ${esc(t('about.qualityNote'))}</p></fieldset>
        <fieldset><legend>${esc(t('about.atmosphere'))}</legend><div class="opts">${atmoOpts}</div></fieldset>

        <h3>${esc(t('about.data'))}</h3>
        <p class="hint-text">${esc(t('about.dataNote'))}</p>
        <ul class="data-list">${DATA.map((d) => `
          <li><strong>${esc(d.name)}</strong> – ${esc(d.use[lang])}<br>
            <span class="attr" lang="en">${esc(d.text)}</span><br>
            <small>${esc(d.licence)} · ${link(d.url, new URL(d.url).hostname.replace(/^www\./, ''))}</small></li>`).join('')}
        </ul>

        <h3>${esc(t('about.photos', { n: String(photos.length) }))}</h3>
        <p class="hint-text">${esc(t('about.photosNote'))}</p>
        <ul class="photo-list">${photoItems}</ul>

        <h3>${esc(t('about.texts'))}</h3>
        <p>${esc(t('about.textsBody'))}</p>

        <h3>${esc(t('about.software'))}</h3>
        <ul class="data-list">${SOFTWARE.map(([n, l, u]) => `<li><strong>${esc(n)}</strong> – ${esc(l)} · ${link(u, new URL(u).hostname)}</li>`).join('')}</ul>

        <h3>${esc(t('about.correct'))}</h3>
        <p>${esc(t('about.correctBody'))}</p>

        <p class="about-credit">${esc(t('footer.credit'))}</p>
      </div>`;
    this.dlg.querySelector('.about-close')!.addEventListener('click', () => this.dlg.close());
    this.dlg.querySelectorAll<HTMLInputElement>('input[name="tier"]').forEach((i) => i.addEventListener('change', () => {
      this.h.setTier(i.value === 'auto' ? null : (i.value as Tier));
    }));
    this.dlg.querySelectorAll<HTMLInputElement>('input[name="atmo"]').forEach((i) => i.addEventListener('change', () => {
      this.h.setAtmo(i.value as AtmoName);
    }));
  }
}
