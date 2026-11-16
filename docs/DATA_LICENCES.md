# Data licences and required attributions (read before publishing anything)

| Item | Where in kit | Licence | What you must do |
|---|---|---|---|
| Copernicus DEM GLO-30 (heightmaps, terrain GLB, Terrarium, hillshade, preview) | `public/data/heightmap*.png`, `terrarium*.png`, `terrain_lod*.glb`, `hillshade.png`, `albedo_*.jpg` | Copernicus DEM licence: free for any use incl. commercial, with attribution | Footer text: "Contains modified Copernicus DEM GLO-30 data © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved." |
| ESA WorldCover 2021 v200 (land cover, albedo colours) | `public/data/landcover_classes.png`, `albedo_*.jpg` | CC BY 4.0 | "Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0)." |
| WDPA polygons (simplified reserve boundary) | `public/data/reserve_boundary.geojson` | **UNEP-WCMC / IUCN WDPA terms: NON-COMMERCIAL use; redistribution of raw data not allowed.** The kit ships only a simplified (~30 m) derivative and no raw files. | OK for a non-commercial Phase 0 demo. Cite "UNEP-WCMC and IUCN (2026), Protected Planet: The World Database on Protected Areas (WDPA), www.protectedplanet.net". Before a public/commercial launch, replace with an official boundary (Guinea: CEGENS/Ministry; Côte d'Ivoire: OIPR) or digitise from the UNESCO nomination map. |
| geoBoundaries (country outlines) | `public/data/borders_clipped.geojson` | GIN: CC BY-SA 2.0; LBR: CC BY 3.0 IGO; CIV: public domain | Credit "geoBoundaries (William & Mary geoLab)"; share-alike applies to the Guinea outline. |
| OpenStreetMap (mining polygon, village positions via Nominatim) | `public/data/mining_enclave_osm.geojson`, `data/src/osm_nominatim_lookup_*.json` | ODbL | "© OpenStreetMap contributors". Keep the OSM-derived layer separable (share-alike on the database). |
| Wikidata coordinates | `data/src/wikidata_box_query.json`, hotspot coordinates | CC0 | none |
| Photos (32) | `assets/photos/` + `credits.json` | CC BY 4.0, CC BY-SA 4.0 or CC BY-SA 3.0 IGO (Wikimedia Commons) | Show the author + licence + link under every photo (use `attribution` in `credits.json`) and add a full credits page. CC BY-SA means a modified/derived image must carry the same licence; the resized web copies are labelled "resized and recompressed". |
| Texts in `content.json` | `public/data/content.json` | Written for this project from the listed sources (facts are not copyrightable; wording is original) | Keep the `sources` links visible in the panel ("Sources" section). |
| Fonts | Google Fonts (see DESIGN.md) | SIL OFL 1.1 | Self-host; no attribution needed in UI, keep licence files in the repo. |

No logos are included. Do **not** add the UNESCO, CSIG, OIPR or Kyoto University logos without written permission; use plain text credits.
