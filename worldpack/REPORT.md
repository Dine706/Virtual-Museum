# Stage 1 report – the Nimba world pack

**Goal of stage 1:** gather and prepare everything a photoreal, "alive" Unreal world of the Nimba massif can be built from, using only open data, with the limits written down honestly. No Unreal work yet. The Mac setup is in `docs/UNREAL_MAC_SETUP.md`.

**Result:**
* A 30 km massif and four 2 km hero zones are ready to import (heightmaps in real metres).
* Every metre of ground has a measured tree height.
* Masks are ready for procedural forest, grass, rock and streams.
* There is a species database of 3,914 species, with names in French and English, IUCN status, altitude zones and photo candidates.
* `ASSETS.md` gives an asset list per zone.

## 1. What we have

| Layer | Source | Resolution | Confidence |
|---|---|---|---|
| Terrain shape (massif) | Copernicus DEM GLO-30 | 30 m, resampled to 15 m | **Measured.** The summit reads 1,755 m in the DEM vs 1,752 m official, and the Grands Rochers 1,681 m vs 1,694 m quoted. For Pierre Richaud the published heights themselves disagree (1,670 / 1,611 m). |
| Terrain shape (hero zones) | Same, upsampled (cubic) | 1 m grid | Shape is real; detail under ~30 m is **reconstructed**. |
| Ground under trees | DSM − canopy height (averaged over 30 m) | same | **Approximate.** Radar partly penetrates canopies; typically within a few metres. |
| Tree height | Meta / WRI canopy height map v1 | 1.2 m | **Model-derived** from satellite imagery with lidar training. Good for structure (tall forest, gaps, grass). |
| Land cover | ESA WorldCover 2021 | 10 m | Measured classification. Tree / grass / built-up / crop are reliable; shrub vs grass less so. |
| Altitude bands | Derived from the DEM | – | **Indicative.** The thresholds (1,000 m, 1,400 m) follow the sourced vegetation belts, but real boundaries vary with slope and exposure. |
| Streams | Derived from the ground model (D8 flow) | 15 m / 1 m | **Approximate.** The right valleys, positions ± tens of metres. |
| Species | GBIF records, Wikidata names, iNaturalist photos | per record | Real records, aggregated. See §3. |

### Hero-zone figures (measured)

| Zone | Ground | Canopy mean / p95 / max | Cover | Steep (> 38°) |
|---|---|---|---|---|
| Z1 Summit | 966–1,751 m | 4.8 / 23 / 44 m | 43 % tree, 57 % grass | 35 % |
| Z2 Cloud forest | 762–1,567 m | 10.0 / 26.5 / 46 m | 62 % tree, 38 % grass | 21 % |
| Z3 Bossou hills | 533–683 m | 6.7 / 22 / 46 m | 81 % tree, 12 % grass, 7.5 % built-up | 0.3 % |
| Z4 Foothill forest | 536–661 m | 14.8 / 26 / 39 m | 83 % tree, 17 % grass | 0 % |
| Massif (30 km) | 346–1,751 m | 7.5 / 23.5 / 36 m | 79 % tree, 20 % grass, 0.7 % built-up | 2.6 % |

These numbers agree with the sourced descriptions:
* The summit is a grassland mosaic with forest in the ravines.
* The cloud-forest belt is mixed forest and grassland on steep slopes.
* The foothill forest is the tallest and most closed.

## 2. What is reconstructed (generated, not measured)

These will be **plausible, not real**. The world should say so, for example in an "About this world" panel.

* **Micro-relief:** rocks, banks, gullies and paths below ~30 m.
* **Individual trees:** positions, species and shapes. The density and height pattern come from data; each tree is procedural.
* **Plant species mix per place:** from the sourced belts (lowland, montane/cloud, summit grassland), not from a vegetation survey.
* **Stream courses:** derived from the terrain, not mapped.
* **Animal placement:** animals are generalised to habitats. Threatened species are never placed at real spots.
* **Village edge at Bossou:** generic, from land cover only.

## 3. Species database

`species/species.json` and `species.csv` were built from **79,736 GBIF records** in the window (138 datasets). Coverage:

| | Count |
|---|---|
| Species | **3,914**: 2,206 plants, 1,694 animals (847 insects, 400 birds, 80 mammals, 29 amphibians, 24 reptiles), 12 fungi |
| Altitude zone present | lowland 3,516 · montane 1,256 · summit 658 (a species can be in several) |
| IUCN threatened | 7 CR, 31 EN, 69 VU → **107 flagged `sensitive`** (plus the named Nimba species) |
| French name / English name | 511 / 877 (from Wikidata; the rest have scientific names only) |
| Photo candidates (iNaturalist, research grade) | 525 species |

**Checks against the sources:**
* The viviparous toad (*Nimbaphrynoides occidentalis*, CR) and Lamotte's roundleaf bat (CR) come out in the summit band, as published. Both are flagged sensitive.
* *Parinari excelsa* falls mainly in the montane and summit bands, matching the "Parinari excelsa forest" of the montane belt.
* The oil palm falls in the lowland band.

**Limits:**
* **Records measure collecting effort, not abundance.** For example, one museum collection of 13,682 specimens is catalogued at a single point near Yéalé.
* Altitude bands are sampled at the record's coordinates. Records with imprecise or generalised coordinates can land in the wrong band (for example, 2 of 10 chimpanzee records fall in the summit band).
* 289 records lacking a taxonomic class/family at that point were skipped. They have no species key, so no species is lost.
* **Not found in GBIF within the window:** *Micropotamogale lamottei* (otter shrew), *Blaeria nimbana*, *Osbeckia porteresii*. They may be recorded without coordinates, under other names, or withheld. Their information panels must rely on the cited literature, not GBIF.
* **Photo licences:** 1,112 of 1,117 photo candidates are **CC BY-NC**. Usable for this non-commercial prototype with attribution, not for a commercial product. Use them as **modelling references**, and pick CC0 / CC BY photos for anything shown publicly where possible.
* Names: no French name exists in Wikidata for most species. Do not invent one; show the scientific name.
* **No coordinates** are stored anywhere in the species files (checked).

## 4. What is missing (and how to get it)

| Gap | Why it matters | How to fill it |
|---|---|---|
| Ground-truth vegetation map (plots, species per belt) | Correct species mix per altitude and slope | Published botanical surveys of Nimba; partners (CEGENS, IREB, OIPR, Kyoto University) when there is an agreement. |
| Reference photos of key plants (*Parinari excelsa*, Nimba tree ferns, *Protea*, the endemics) | Faithful hero models | Commons / iNaturalist (licensed), herbarium sheets, a photo trip with permission. |
| Better terrain than 30 m | Walk-scale realism | Commercial DEM / lidar (cost), drone photogrammetry with authorisation (out of scope for now). |
| Ambient sound recorded at Nimba | "Alive" feeling | Licensed recordings (e.g. xeno-canto, per-recording licence) or a field recording. |
| Local architecture and cultural detail | Bossou and village edges | Only with community consultation (CLAUDE.md §10.3). |
| Mapped streams and springs | Accurate water features | OSM has few; field data from partners. |

## 5. Rules carried into the Unreal world

From `CLAUDE.md` §10. These are not optional.

1. Only sourced facts in info panels. Every species keeps its GBIF / Wikidata sources.
2. Threatened species (`sensitive: true`) only in generalised zones. The pack contains **no coordinates** for any species.
3. No sacred sites mapped or modelled.
4. Chimpanzees shown as wild animals, at a respectful distance, never tame.
5. Mining described only in the words of UNESCO decision 48 COM 7A.46. The enclave is "approximate".
6. Every photo and dataset attributed. No AI-generated "photos of Nimba". Generated 3D content is labelled as a reconstruction.

## 6. Licences

* Copernicus DEM: free with attribution.
* Meta/WRI canopy height and ESA WorldCover: CC BY 4.0.
* GBIF records: per dataset (CC0 / CC BY / CC BY-NC). The list is in `species/gbif_datasets.json`. **Before any public release, create a GBIF download with a DOI and cite it.**
* Wikidata: CC0.
* iNaturalist photos: per photo, recorded in `species.json`. **CC BY-NC photos are usable only in a non-commercial project.** If the museum is ever monetised, use only CC0 / CC BY / CC BY-SA.

The exact attribution texts are in `README.md`.

## 7. Next stage

Stage 2 runs on the Mac. Here is the order:
1. Install UE 5.8 + the MCP plugins (`docs/UNREAL_MAC_SETUP.md`).
2. Import Z2 (cloud forest) with the settings in `zones/z2-cloud-forest/meta.json`.
3. Build landscape materials from the masks.
4. Run a first PCG forest from `canopy_height_m.png` + `mask_forest.png`.
5. Add fog and volumetric clouds with a base near 900 m.

That gives the first "photoreal and alive" test image for the least work. Then follow the priority list in `ASSETS.md`.
