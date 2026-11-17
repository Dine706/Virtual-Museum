# Asset list – what each hero zone needs

This is the shopping and modelling list for the photoreal Unreal world. For every zone it says what to put in the scene, how the world pack drives its placement, and where the asset comes from:

* **Library**: a ready-made asset from a general 3D library. **Check the licence and price at the time you download**, because library terms change.
* **Model**: no faithful asset exists, so it has to be built (SpeedTree or Unreal's procedural vegetation tools, Blender, photogrammetry of a stand-in, or a commissioned artist).
* **Find**: needs reference material first (photos, herbarium sheets, papers), then a model.

Candidate libraries:
* Fab, which includes Quixel Megascans.
* Poly Haven and ambientCG (CC0 textures and HDRIs).
* Sketchfab, filtered by CC licence.

Most libraries are strong on European and North American vegetation and weak on West African montane species. Expect the **specific Nimba plants to be "Model"**, and use library assets only for generic material: soil, rock, leaf litter, grass clumps, moss, and generic tropical broadleaf trees as fillers.

Vegetation statements below come from `public/data/content.json`, which cites the UNESCO property page (whc.unesco.org/en/list/155), the Wikipedia article "Mount Nimba Strict Nature Reserve" and Guinea's Tentative List. Nothing here adds new facts. Where a species is named, it is named in those sources.

## What drives placement (all zones)

| World-pack layer | Use in Unreal |
|---|---|
| `heightmap_ground.png` | Landscape shape (real metres). |
| `canopy_height_m.png` | Tree height per metre of ground: pick the tree size class and scale (0–46 m measured). |
| `mask_forest.png` | Tree density. |
| `mask_grass.png` | Grass and shrub density. |
| `mask_rock.png` | Rock and scree material, plus boulder scatter. |
| `mask_band_lowland/montane/summit.png` | Which species mix to use (soft 100 m transitions). |
| `mask_stream.png` | Stream-bed material, wet-ground plants, tree ferns (approximate positions). |
| `landcover_worldcover.png` | Built-up (50) and crop (40) for the Bossou village edge; water (80). |
| `species/species.json` | Which plants and animals may appear in each altitude band, with names FR/EN, IUCN status and sources. |

## Shared base set (all zones)

| Asset | Kind | Source | Notes |
|---|---|---|---|
| Red lateritic soil, dirt paths | material | Library | Tint toward the iron-rich red of the region; validate against the licensed photos in `public/photos/`. |
| Leaf litter (broadleaf, wet) | material + decals | Library | Lowland and montane forest floors. |
| Granite / quartzite outcrops, boulders, scree | meshes + material | Library | Driven by `mask_rock`. Colour-match to summit photos. |
| Sky, sun, clouds, fog | Unreal Sky Atmosphere, Volumetric Clouds, Exponential Height Fog | Built-in | Cloud base ~900 m for the cloud-forest look (UNESCO: cloud cover from ≈ 900 m almost all year). |
| Generic tropical broadleaf trees (3–4 size classes) | trees | Library, then **Model** | Fillers only, so the forest reads correctly at distance. Replace with Nimba-specific trees in the hero areas. |
| Ambient audio | sound | **Find** | Prefer recordings from the region with a clear licence (e.g. xeno-canto, per-recording licence). Never use made-up "jungle" packs that include species absent from West Africa. |

## Z1 – Summit, Mount Richard-Molard (ground 966–1,751 m)

The terrain is 43 % tree cover and 57 % grass. Mean canopy is 4.8 m, but 95th-percentile trees reach 23 m in the ravines. 35 % of the ground is steeper than 38°.

| Asset | Kind | Source | Placement |
|---|---|---|---|
| Montane grass tussocks, high-altitude turf | foliage | Library base, re-coloured; **Model** for hero clumps | `mask_grass` × `mask_band_summit`. The sources describe "montane savanna and high-altitude turf". |
| *Protea* bushland shrubs (transition belt) | shrubs | **Model** (reference: herbarium and Commons photos of West African *Protea*) | Edge of grassland, ≈ 1,200–1,400 m (`mask_band_montane`). |
| Endemic plants *Asplenium schnellii* (fern), *Osbeckia porteresii*, *Blaeria nimbana* | small plants | **Find**, then **Model** | Sparse hero placements only; label them in the info panel. Check `species.json` for photos with usable licences. |
| Gallery-forest trees in ravines | trees | Generic + **Model** | Wherever `canopy_height_m` > 8 m inside the summit band. |
| Exposed rock ridges, scree | rock | Library | `mask_rock`. |
| Low cloud wisps passing the crest | VFX | Built-in (volumetric clouds / fog cards) | The summit is cloud-capped much of the year. |
| *Nimbaphrynoides occidentalis* (viviparous toad) | animal | **Model** | **Sensitive species.** Show it only as a generalised, non-located encounter (e.g. an info card in the grassland band), never at a specific spot. |

## Z2 – Cloud forest (ground 762–1,567 m)

The terrain is 62 % tree cover. Mean canopy is 10 m and the 95th percentile is 26.5 m. 21 % of the ground is steeper than 38°.

| Asset | Kind | Source | Placement |
|---|---|---|---|
| *Parinari excelsa* forest trees | trees | **Model** (key hero tree; gather reference first) | `mask_forest` × `mask_band_montane`, sized by `canopy_height_m`. |
| Mossy trunk and branch layers | material layer | Library moss + **Model** blend | All trees above ≈ 900 m ("mossy forest" in the sources). |
| Epiphytes (mosses, ferns, orchids on branches) | foliage cards | Library generic + **Model** | UNESCO: "montane forest rich in epiphytes". |
| Tree ferns | trees | **Model** (reference: African tree ferns) | Wet valleys: along `mask_stream`. |
| Forest-floor ferns, seedlings | foliage | Library | Under the canopy, density from `mask_forest`. |
| Persistent mist | VFX | Built-in height fog + local fog volumes | Strongest from ≈ 900 m. |
| Fallen logs, buttress roots | meshes | Library + **Model** | Scatter. |
| *Hipposideros lamottei* (Lamotte's roundleaf bat) | animal | **Model** | **Sensitive.** Generalised only. |

## Z3 – Bossou hills (ground 533–683 m)

The terrain is 81 % tree cover, 12 % grass and 7.5 % built-up. Mean canopy is 6.7 m and the maximum is 46 m.

| Asset | Kind | Source | Placement |
|---|---|---|---|
| Oil palm *Elaeis guineensis* | trees | Library (oil palms exist in libraries; verify the look) | Forest edges, near the village. The Bossou chimpanzees crack its nuts with stones. |
| Secondary and hill forest trees | trees | Generic + **Model** | `mask_forest`, `canopy_height_m`. |
| Stone hammer-and-anvil sets, nut shells | props | **Model** (from published photos as reference, not copied) | A few hero spots, for the tool-use story. |
| Village edge: houses, fields, paths | buildings, crops | **Find** (local architecture reference), then **Model** | `landcover` 50 (built-up) and 40 (crop). Keep it generic. Do not reproduce identifiable private homes, and consult the community before adding cultural detail (CLAUDE.md §10.3). |
| Chimpanzees (*Pan troglodytes verus*) | animal | **Model** + animation (commission) | Respectful, wild, at a distance. Never shown tame or approachable (CLAUDE.md §10.4). |
| Sacred forest | — | **Do not model or map** | CLAUDE.md §10.3. |

## Z4 – Foothill forest (ground 536–661 m)

The terrain is 83 % tree cover. Mean canopy is 14.8 m, the 95th percentile is 26 m and the maximum is 39 m. This is the tallest, densest forest of the four zones.

| Asset | Kind | Source | Placement |
|---|---|---|---|
| Emergent trees (above the main canopy) | trees | **Model** (2–3 hero emergents) | Where `canopy_height_m` ≥ 30 m. The sources describe "a main canopy and an emergent layer". |
| Main-canopy semi-deciduous trees | trees | Generic + **Model** (aim for variety: 40–70 tree species per hectare per the sources) | `mask_forest`; vary species per instance. |
| Understorey shrubs, lianas, saplings | foliage | Library + **Model** | Dense under closed canopy. |
| Streams with gallery vegetation | water + foliage | Built-in water + Library | `mask_stream` (approximate). |
| *Micropotamogale lamottei* (Nimba otter shrew) | animal | **Model** | **Sensitive.** Generalised only, never placed on a specific stream. |

## Fauna (all zones)

Animals are the most expensive assets: model, rig, animation and behaviour. Recommended order:
1. Ambient-only presence (sound, birds in the distance).
2. Static info cards when you click a habitat.
3. A small number of animated hero animals (chimpanzee group at Bossou; a bird species; the toad as a close-up "specimen" view rather than a wild placement).

Use `species.json` to pick candidates: it lists every recorded species with its altitude band, IUCN category and a `sensitive` flag.

## Priority (what to build first)

1. Landscape import for Z2 (cloud forest) + generic trees + moss + fog. This is the strongest "alive, photoreal" image for the least modelling.
2. Z1 grass and rock (cheap: mostly library materials) for the panorama.
3. Hero trees: *Parinari excelsa*, a tree fern, an emergent lowland tree, the oil palm.
4. Z4 and Z3, then animals.
