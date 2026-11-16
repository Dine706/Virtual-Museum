# Geographic data – what we have, where it comes from, how good it is

All coordinates are WGS84 (EPSG:4326), decimal degrees, **lat, lon** order in tables (GeoJSON files use lon, lat).

## 1. Study window (the area of the 3D scene)
| | value |
|---|---|
| West / East | -8.56 / -8.28 |
| South / North | 7.48 / 7.76 |
| Size | ≈ 30.9 km (E–W) × 31.0 km (N–S), 1008 × 1008 DEM pixels (≈ 30.7 m × 30.7 m) |
| Elevation in window | 352.97 m – 1755.34 m (Copernicus GLO-30 DSM) |
| Centre | lon -8.42, lat 7.62 (used as the local-metre origin) |

## 2. Reserve (World Heritage property) – bounds of the two WDPA polygons
| Part | WDPA ID | West | East | South | North | Reported area | GIS area |
|---|---|---|---|---|---|---|---|
| Guinea – Réserve naturelle intégrale des monts Nimba | 29067 | -8.5003 | -8.3201 | 7.5582 | 7.7200 | 125.4 km² | 135.5 km² |
| Côte d'Ivoire – Réserve intégrale du Mont Nimba | 1295 | -8.4697 | -8.3804 | 7.5307 | 7.6278 | 50.93 km² | 50.96 km² |

* UNESCO text: 17,540 ha total (12,540 ha Guinea + 5,000 ha Côte d'Ivoire). UNESCO property field says 17,632.62 ha. **Use "about 175 km²" and cite UNESCO.**
* UNESCO property point: N7°36'11.45" W8°23'27.49" = **7.60319, -8.39097**.
* The Liberian part of the massif (East Nimba Nature Reserve, ≈ 11,553 ha, created 2003) is **not** part of the World Heritage property and is **not** in the boundary file (no open polygon was fetched; add it from WDPA if you want it).
* The OSM relation for the reserve (R21148160) is coarse and oversized (≈ 216 km²) – do not use it; use `public/data/reserve_boundary.geojson` (simplified WDPA, see licence).

## 3. Peaks
| Peak | Height by source | Position used | Note |
|---|---|---|---|
| Mont Richard-Molard (summit) | 1,752 m UNESCO/Wikipedia/Wikidata; **DEM max 1,755 m** at 7.6219, -8.4083 | 7.62259, -8.40806 (Wikidata) snapped to DEM max | Highest point of Guinea and of Côte d'Ivoire. DEM is a surface model: ~3 m above the survey height is normal. |
| Grands Rochers | 1,694 m (Wikipedia) | DEM max within 800 m of Wikidata point: 7.6567, -8.3797 (1,681 m) | Medium confidence |
| Mont Pierre Richaud | 1,670 m (Wikipedia), 1,611 m (Tentative List), DEM 1,610 m | 7.6739, -8.3636 | Near the mining enclave |
| Mont Sempéré 1,682 m / Mont Tô 1,675 m / Mont Leclerc 1,577 m / Monts Génies 1,531 m | Wikipedia / Tentative List (Sempéré 1,650; Leclerc 1,568) | **not located** | No reliable coordinates found. Wikidata's point for Leclerc (7.68, -8.38444) is NOT on a summit (DEM 999 m). Do not place markers for them. |
| DEM local maxima (unnamed) | 1,751 m (7.6169, -8.4119), 1,698 m (7.6303, -8.4031), 1,681 m (7.6567, -8.3797), 1,668 m (7.6603, -8.3731), 1,665 m (7.6650, -8.3792), 1,610 m (7.6739, -8.3636) | – | Useful for the ridge profile |

## 4. Places (verified positions)
| Place | lat | lon | Source |
|---|---|---|---|
| Bossou (village) | 7.6508 | -8.5055 | OSM Nominatim |
| Bossou Hills / chimpanzee forest | 7.64875 | -8.50537 | Wikidata |
| IREB building (Bossou) | 7.64446 | -8.50299 | Wikimedia Commons geotag |
| Séringbara (village) | 7.6311 | -8.4629 | OSM Nominatim |
| Gbakoré (village, CEGENS base per press) | 7.7241 | -8.4059 | OSM Nominatim |
| N'Zo / N'Zoo (sub-prefecture) | 7.6794 | -8.3142 | Wikidata |
| Lola (town / prefecture) | 7.7997 | -8.5286 | OSM Nominatim (Wikidata: 7.8, -8.5333) |
| Yéalé (Côte d'Ivoire) | 7.5279 | -8.4222 | OSM Nominatim |
| Yekepa (Liberia) | 7.5753 | -8.5419 | OSM Nominatim (Wikidata: 7.5833, -8.5333) |
| Danané (Côte d'Ivoire) | 7.2631 | -8.1546 | OSM Nominatim |
| Tripoint Côte d'Ivoire – Guinea – Liberia | 7.55556 | -8.47222 | Wikidata |
| Diougou (= upper Cavally) watercourse | 7.7153 | -8.4419 | Wikidata |
| Mining enclave "Mine de Nimba" (OSM polygon, centroid) | 7.6700 | -8.3743 | OSM way 307934062 (≈ 269 ha); only ≈ 2 % overlaps the WDPA Guinea polygon → consistent with "enclave adjacent to the property". **Volunteer data, not official.** |

Rivers: Wikidata lists many small watercourses in the window with approximate points only. No open river-line dataset was integrated. If you want drawn rivers, derive them from the DEM (flow accumulation, `whitebox` or `pysheds`) and label them "derived from the DEM, approximate".

## 5. Hotspots (23) – generated from `public/data/content.json`
| id | category | lat | lon | elev (m) | DEM (m) | precision / confidence | coordinate source |
|---|---|---|---|---|---|---|---|
| richard-molard | peak | 7.62190 | -8.40830 | 1752 | 1753.2 | exact / high | Wikidata 7.62259,-8.40806 snapped to the DEM maximum (≈40 m away) |
| grands-rochers | peak | 7.65670 | -8.37970 | 1694 | 1679.0 | approximate / medium | Wikidata gives a point for the 'Grands Rochers' range at 7.65,-8.38333; marker snapped to the DEM maximum within 800 m |
| pierre-richaud | peak | 7.67390 | -8.36360 | 1670 | 1608.9 | exact / medium | Wikidata 7.6742,-8.3642, snapped to DEM maximum |
| montane-grassland | habitat | 7.63970 | -8.39580 | 1660 | 1660.3 | area / medium | Illustrative point on the summit ridge inside the WDPA polygon (grassland covers the whole ridge) |
| cloud-forest | habitat | 7.67000 | -8.40000 | 1120 | 1117.8 | area / low | Illustrative point on a ~1,100 m slope inside the WDPA polygon (cloud forest is a belt, not a point) |
| lowland-forest | habitat | 7.67500 | -8.44000 | 580 | 575.9 | area / low | Illustrative point in the lowland foothills inside the WDPA polygon |
| savanna-fire | habitat | 7.71000 | -8.34000 | 540 | 536.4 | area / low | Illustrative point on lowland savanna at the north-eastern edge |
| cavally | water | 7.71530 | -8.44190 | 520 | 518.4 | approximate / low | Wikidata point for the 'Diougou' watercourse (7.7153,-8.4419; Diougou is a local name of the Cavally) used as a symbolic headwater marker north of the massif |
| viviparous-toad | species | 7.64860 | -8.38800 | 1550 | 1548.1 | area / low | Deliberately generalised: grassland slope inside the strict reserve (exact sites not published) |
| otter-shrew | species | 7.65500 | -8.44000 | 630 | 628.0 | area / low | Deliberately generalised: forested stream zone inside the reserve |
| lamotte-bat | species | 7.66400 | -8.37700 | 1540 | 1541.5 | area / low | Deliberately generalised near the Guinean mining area (roost sites are not published) |
| bossou-chimpanzees | species | 7.64875 | -8.50537 | 540 | 543.6 | exact / high | Wikidata 'Bossou Hills / Chimpanzé de Bossou' 7.64875,-8.50537 (the hill forest is a publicly known site) |
| ireb-bossou | culture | 7.64446 | -8.50299 | 560 | 557.0 | exact / high | Wikimedia Commons geotag of the IREB building photo |
| green-corridor | conservation | 7.63700 | -8.48700 | 550 | 547.8 | approximate / low | Approximate midpoint between the Bossou hills and the foot of the massif (the corridor is a 4 km strip; no polygon found) |
| cultural-landscape | culture | 7.63110 | -8.46290 | 570 | 568.8 | area / medium | Village of Séringbara (OSM Nominatim 7.6311076,-8.4629177) used as anchor for the cultural landscape; individual sacred sites are deliberately NOT mapped |
| cegens-gbakore | conservation | 7.72410 | -8.40590 | 490 | 491.6 | approximate / medium | Village of Gbakoré (OSM Nominatim 7.7241019,-8.4058834); the CEGENS base is reported there but its exact point was not found |
| nzo | culture | 7.67940 | -8.31420 | 450 | 452.5 | exact / high | Wikidata / OSM Nominatim 7.6794,-8.3137 |
| yeale | culture | 7.52790 | -8.42220 | 370 | 370.9 | exact / high | OSM Nominatim 7.5278570,-8.4221620 (Yéalé, Tonkpi, Côte d'Ivoire) |
| yekepa-lamco | conservation | 7.57530 | -8.54190 | 510 | 505.1 | exact / medium | OSM Nominatim 7.5753094,-8.5419387 (Yekepa, Nimba County); Wikidata gives 7.5833,-8.5333 |
| mining-enclave | conservation | 7.67000 | -8.37430 | 1310 | 1310.7 | approximate / medium | Centroid of OSM polygon 'Mine de Nimba' (way 307934062, ≈269 ha); only ≈2% of it overlaps the WDPA reserve polygon, consistent with an enclave adjacent to the property |
| tripoint | conservation | 7.55556 | -8.47222 | 1230 | 1229.2 | exact / medium | Wikidata tripoint Côte d'Ivoire–Guinea–Liberia 7.55556,-8.47222 |
| unesco-inscription | conservation | 7.60320 | -8.39100 | 790 | 791.1 | approximate / high | UNESCO property coordinate N7°36'11.45" W8°23'27.49" |
| danger-list | conservation | 7.64470 | -8.42310 | 740 | 741.4 | symbolic / n/a | Symbolic anchor on the central ridge (this hotspot describes the whole property, not a place) |
Species hotspots (toad, otter shrew, bat) are **deliberately generalised** – never replace them with precise locations (poaching and disturbance risk).

## 6. Known data gaps / conflicts (also flagged per hotspot)
1. No official boundary of the Guinean mining enclave found (OSM polygon only).
2. Heights of the secondary peaks differ between Wikipedia and the Guinean Tentative List; Sempéré/Tô not located.
3. Total area: 17,540 ha (UNESCO text) vs 17,632.62 ha (UNESCO property field) vs WDPA GIS 135.5 + 51.0 km².
4. The Tentative List coordinates (7°23'30"–7°14'25" N, 10°29'–10°40' W) are garbled – ignore.
5. Wikipedia names the Sassandra among the rivers rising on Nimba: doubtful, not used as fact. The Cavally rises north of Mont Nimba in Guinea (Wikipedia, "Cavalla River").
6. Species counts differ (UNESCO: > 317 vertebrates incl. 107 mammals; Wikipedia: 680 / 132). Use UNESCO.
7. Border lines (geoBoundaries) from three countries do not match each other exactly in the window; show them thin and dashed, or hide them and show only the tripoint.
8. The Copernicus DEM is a DSM (includes canopy); the ground under forest is 10–30 m lower than shown.
9. Bossou chimpanzee count (7 in 2017) may be outdated.
