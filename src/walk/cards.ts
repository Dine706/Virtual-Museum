// Info cards of walk mode: what the visitor tapped (tree, animal, villager, house, ground…) → sourced text.
// Every statement comes from content.json (UNESCO / Wikipedia…), GBIF, the canopy-height and land-cover data,
// OpenStreetMap, or docs/VILLAGE_SOURCES.md; anything reconstructed says so.
import type * as THREE from 'three';
import { getLang, t, fmtMeters } from '../i18n';
import { loc, type Content, type Hotspot } from '../data/content';
import { AREA, type SpeciesRef, type WalkData } from './data';
import type { TreeInst } from './forest';
import type { Agent } from './fauna';
import type { Person } from './village';
import type { Card, CardItem } from './hud';
import { biomeAt, habitatOf, type HabitatId } from './biome';

export type Hit =
  | { kind: 'tree'; tree: TreeInst } | { kind: 'animal'; agent: Agent } | { kind: 'site' } | { kind: 'ground'; p: THREE.Vector3 }
  | { kind: 'person'; person: Person } | { kind: 'house'; round: boolean };

const HABITAT_HOTSPOT: Record<HabitatId, string> = {
  lowlandForest: 'lowland-forest', cloudForest: 'cloud-forest', montaneGrass: 'montane-grassland', savanna: 'savanna-fire',
  regrowth: 'lowland-forest', village: 'cultural-landscape', gallery: 'cavally',
};
const PLANT_HOTSPOT: Record<string, string> = {
  emergent: 'lowland-forest', canopy: 'lowland-forest', understory: 'lowland-forest', montane: 'cloud-forest', treefern: 'cloud-forest',
  oilpalm: 'bossou-chimpanzees', raphia: 'lowland-forest', protea: 'montane-grassland', savanna: 'savanna-fire', regrowth: 'lowland-forest', pole: 'lowland-forest',
};
const PLANT_TAXA: Record<string, string> = { treefern: 'tree_fern', protea: 'protea', montane: 'parinari', oilpalm: 'oil_palm', raphia: 'raphia' };
const ANIMAL_TAXA: Record<string, string> = { hornbill: 'hornbill', turaco: 'turaco', sunbird: 'sunbird', acraea: 'acraea', swallowtail: 'swallowtail', graphium: 'swallowtail' };

const SRC = {
  guinea: { label: 'Countries and Their Cultures – Guinea', url: 'https://www.everyculture.com/Ge-It/Guinea.html' },
  gret: { label: 'Gret – Guide pratique de l\'huile de palme (Guinée forestière)', url: 'https://gret.org/wp-content/uploads/2021/12/Guide-Pratique-Huile-de-Palme.pdf' },
  bossou: { label: 'Yamakoshi & Leblan 2013, Revue de primatologie 5', url: 'https://journals.openedition.org/primatologie/1762' },
  green: { label: 'Green Corridor Project – People of Bossou', url: 'https://www.greencorridor.info/en/people/' },
  kpelle: { label: 'Encyclopedia of World Cultures – Kpelle economy', url: 'https://www.everyculture.com/Africa-Middle-East/Kpelle-Economy.html' },
  kpelleS: { label: 'Encyclopedia of World Cultures – Kpelle settlements', url: 'https://www.everyculture.com/Africa-Middle-East/Kpelle-Settlements.html' },
  liberia: { label: 'Countries and Their Cultures – Liberia', url: 'https://www.everyculture.com/Ja-Ma/Liberia.html' },
  osm: { label: '© OpenStreetMap contributors (ODbL)', url: 'https://www.openstreetmap.org/copyright' },
  wc: { label: 'ESA WorldCover 2021 (CC BY 4.0)', url: 'https://esa-worldcover.org/' },
  chm: { label: 'Meta / WRI – High Resolution Canopy Height Maps (CC BY 4.0)', url: 'https://registry.opendata.aws/dataforgood-fb-forests/' },
  gbif: { label: 'GBIF.org – occurrence records (Nimba window)', url: 'https://www.gbif.org/occurrence/search?geometry=POLYGON((-8.56%207.48,-8.28%207.48,-8.28%207.76,-8.56%207.76,-8.56%207.48))' },
};

export function makeCards(data: WalkData, content: Content) {
  const lang = getLang();
  const nf = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB');
  const hotspot = (id: string) => content.hotspots.find((h) => h.id === id) as Hotspot | undefined;
  const bandOf = (elev: number) => elev < 1000 ? 'lowland_lt1000m' : elev < 1400 ? 'montane_1000-1400m' : 'summit_gt1400m';
  const sciItems = (refs: SpeciesRef[] | undefined, max = 5): CardItem[] => (refs ?? []).slice(0, max).map((s) => ({
    label: (lang === 'fr' ? s.fr : s.en) ? `${lang === 'fr' ? s.fr : s.en} (${s.sci})` : s.sci,
    sub: [t('walk.recorded', { n: nf.format(s.records) }), s.iucn && s.iucn !== 'NE' ? t('walk.iucn', { c: s.iucn }) : ''].filter(Boolean).join(' · '),
    url: s.gbif,
  }));

  function person(p: Person, habitat: HabitatId): Card {
    const src:{label:string;url:string}[]=[];
    const lines = [t(`walk.act.${p.activity}`)];
    if (p.village === 'Bossou') { lines.push(t('walk.village.bossou')); src.push(SRC.bossou, SRC.green); } else if (p.village) lines.push(t('walk.village.generic', { name: p.village }));
    return { kicker: p.village ?? t(`walk.habitat.${habitat}`), title: t('walk.person.title'), lines, note: t('walk.person.note'), sources: src };
  }

  function tree(tr: TreeInst): Card {
    const hs = hotspot(PLANT_HOTSPOT[tr.type]);
    const taxa = PLANT_TAXA[tr.type] ? data.species.taxa[PLANT_TAXA[tr.type]] : undefined;
    const hab = t(`walk.habitat.${habitatOf(biomeAt(data, tr.x, tr.z))}`);
    const heightLine = tr.measured ? t('walk.height.measured', { h: fmtMeters(Math.round(tr.h)) }) : t('walk.height.model', { h: fmtMeters(Math.max(1, Math.round(tr.h))) });
    const single = taxa && taxa.length === 1 ? taxa[0] : null;
    return {
      kicker: `${hab} · ${fmtMeters(Math.round(tr.y))}`,
      title: t(`walk.plant.${tr.type}`),
      sci: single ? single.sci : undefined,
      lines: [t(`walk.desc.${tr.type}`), heightLine],
      items: taxa && taxa.length > 1 ? sciItems(taxa) : single ? sciItems([single]) : undefined,
      itemsTitle: taxa && taxa.length > 1 && tr.type !== 'treefern' ? t('walk.recordedSpecies') : undefined,
      note: t('walk.illustrative'),
      sources: [...(hs?.sources ?? []), SRC.chm],
    };
  }

  function animal(a: Agent, habitat: HabitatId): Card {
    const taxa = data.species.taxa[ANIMAL_TAXA[a.kind]];
    const refs = a.kind === 'graphium' ? taxa?.filter((s) => s.sci.startsWith('Graphium')) : a.kind === 'swallowtail' ? taxa?.filter((s) => s.sci.startsWith('Papilio')) : taxa;
    return { kicker: t(`walk.habitat.${habitat}`), title: t(`walk.animal.${a.kind}`), lines: [], items: sciItems(refs), itemsTitle: t('walk.recordedSpecies'), note: t('walk.animalNote'), sources: [SRC.gbif] };
  }

  /** Mapped terrain types (OSM land use / WorldCover classes) get their own card. */
  function area(p: THREE.Vector3): Card | null {
    const code = data.areaAt(p.x, p.z);
    const cls = data.attrAt(p.x, p.z).cls;
    const elev = fmtMeters(Math.round(p.y));
    if (code === AREA.mine || code === AREA.enclave) {
      const enclave = code === AREA.enclave;
      const lamco = !enclave && p.z > 8000; // the Liberian side, south of the massif
      const hs = hotspot(enclave ? 'mining-enclave' : lamco ? 'yekepa-lamco' : '');
      return {
        kicker: elev, title: t(enclave ? 'walk.area.enclave' : lamco ? 'walk.area.lamco' : 'walk.area.industrial'),
        lines: hs ? [loc(hs, 'short', lang)] : [t('walk.area.industrialText')],
        note: t(enclave ? 'walk.area.enclaveNote' : 'walk.area.mineNote'), sources: [...(hs?.sources ?? []), SRC.osm],
      };
    }
    if (code === AREA.water || cls === 80) {
      return { kicker: elev, title: t('walk.area.water'), lines: [loc(hotspot('cavally')!, 'short', lang)], note: t(code ? 'walk.area.osmNote' : 'walk.area.wcNote'), sources: [...(hotspot('cavally')?.sources ?? []), code ? SRC.osm : SRC.wc] };
    }
    if (code === AREA.field || cls === 40) {
      return { kicker: elev, title: t('walk.area.field'), lines: [t('walk.area.fieldText')], note: t(code ? 'walk.area.osmNote' : 'walk.area.wcNote'), sources: [SRC.bossou, SRC.green, code ? SRC.osm : SRC.wc] };
    }
    if (code === AREA.rock || cls === 60) {
      return { kicker: elev, title: t('walk.area.rock'), lines: [t('walk.area.rockText')], note: t(code ? 'walk.area.osmNote' : 'walk.area.wcNote'), sources: [code ? SRC.osm : SRC.wc] };
    }
    if (code === AREA.sand) return { kicker: elev, title: t('walk.area.sand'), lines: [], note: t('walk.area.osmNote'), sources: [SRC.osm] };
    if (code === AREA.wetland || cls === 90) return { kicker: elev, title: t('walk.area.wetland'), lines: [t('walk.area.wetlandText')], note: t(code ? 'walk.area.osmNote' : 'walk.area.wcNote'), sources: [code ? SRC.osm : SRC.wc] };
    return null;
  }

  function ground(p: THREE.Vector3): Card {
    const special = area(p);
    if (special) return special;
    const b = biomeAt(data, p.x, p.z);
    const hId = habitatOf(b);
    const inWater = b.streamDist < b.streamWidth * 1.2;
    const hs = hotspot(inWater ? 'cavally' : HABITAT_HOTSPOT[hId]);
    const band = bandOf(p.y);
    const bd = data.species.bands[band];
    const lines = [hs ? loc(hs, 'short', lang) : ''];
    if (hId === 'regrowth' && !inWater) lines.unshift(t('walk.desc.regrowth'));
    lines.push(t('walk.band', { band: t(`walk.band.${band}`) }));
    if (bd) lines.push(t('walk.bandCounts', { n: nf.format(bd.counts.species), p: nf.format(bd.counts.plants), b: nf.format(bd.counts.birds) }));
    return {
      kicker: fmtMeters(Math.round(p.y)), title: inWater ? t('walk.water') : t(`walk.habitat.${hId}`), lines: lines.filter(Boolean),
      items: sciItems(bd?.plants, 5), itemsTitle: t('walk.topPlants'), note: inWater ? t('walk.waterNote') : undefined, sources: hs?.sources ?? [],
    };
  }

  /** Card for whatever was hit; `here` names the walker's habitat and nearest village. */
  return function cardFor(hit: Hit, here: { habitat: HabitatId; village: string }): Card {
    switch (hit.kind) {
      case 'person': return person(hit.person, here.habitat);
      case 'house': return {
        kicker: here.village, title: t(hit.round ? 'walk.house.round' : 'walk.house.rect'), lines: [t(hit.round ? 'walk.house.roundText' : 'walk.house.rectText')],
        note: t('walk.house.note'), sources: [SRC.kpelleS, SRC.liberia, SRC.osm],
      };
      case 'tree': return tree(hit.tree);
      case 'animal': return animal(hit.agent, here.habitat);
      case 'site': {
        const hs = hotspot('bossou-chimpanzees');
        return { kicker: hs ? loc(hs, 'title', lang) : '', title: t('walk.site.title'), lines: hs ? [loc(hs, 'short', lang)] : [], note: t('walk.site.note'), sources: hs?.sources ?? [] };
      }
      case 'ground': return ground(hit.p);
    }
  };
}
