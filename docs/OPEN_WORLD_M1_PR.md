# Improve High landscape rendering and first-person controls

High walking scenery previously ended in a local tree ring followed by a smooth canopy shell. A shared landscape layer now textures the orbit mountain, walking shell and distant massif, while 455,889 generic instanced trees extend the forest silhouette to 22 km. High uses the full 1008-segment DEM grid, a 2.4 km local ground patch, a 650 m local forest and 110 m detailed-tree range. Generated native-resolution mountain, canopy, ridge, distant-tree and grass artwork improves the arrival and landscape; original source images, exact prompts and hashes are committed.

High clear-weather fog is reduced to preserve distant scenery, terrain sunlight is normalised, and the explicit High choice retains its resolution. Ground vegetation warms nearest-first before reveal. Scanned forest plants transition to lighter 3D plants beyond 22 m. Low/Mid retain their lighter terrain and vegetation ranges. This is a desktop realism upgrade, not a claim of completed photorealism or measured gaming-GPU performance; the 30 m DEM and procedural plant shapes remain material visual limits.

Walk mode gains jump/gravity, slope and step limits, rock collision, standard gamepad input, touch jump, a compass and a bilingual settings dialog. FOV, sensitivity, head bob and reduced motion update immediately; saved quality applies on the next walk entry. The High preset increases close foliage and terrain detail while Low/Mid retain their existing quality parameters.

All 23 information cards now use eight generated habitat/scenery illustrations in JPEG, WebP and AVIF. Public captions say “Digital reconstruction”, without an “AI” badge, as requested. Original licensed photographs remain as references; factual text, source links and location generalisation are unchanged. Generic generated foliage, lichen bark and leaf litter are integrated into High-quality walk mode.

Blender 5.3 builds a generic filler sapling with a real two-second branch-animation clip: one exported glTF clip and nine animated branch channels. The runtime model is meshopt-compressed with WebP textures, about 555 KB, and plays through AnimationMixer. Reduced motion freezes it. This is the first implementation milestone plus the requested artwork update, not completion of the eight-milestone open world.

## Content-rule update

Dean explicitly requested generated replacement card imagery and no “AI” badge. `CLAUDE.md` §10.6 now permits that artwork with reconstruction captions, retained references and asset provenance. The menu explains measured versus reconstructed detail and provides credits. A standalone bilingual credits page is linked from image captions.

Exact §10.6 wording included in this change:

> **Always show attribution** for photos, assets, sounds and data (§12). **No fake logos or stock photos passed off as Nimba.** Dean permits generated modelling references, textures, image-to-3D inputs and reconstructed card imagery for the open world. Keep prompts, source references and generation provenance in the asset records. Public card captions use **“Reconstitution numérique / Digital reconstruction”**, without an “AI” badge; never present a generated image as a documentary photograph of Nimba or as proof of an exact location, animal or building. Retain the original licensed photographs as references. The About screen distinguishes measured/model-derived data from reconstructed detail (`worldpack/REPORT.md`). Generated animal references still require sourced species sheets and comparison with real photos. These permissions do not change any other content rule.

All other §10 rules remain in force: no precise sensitive-species placement, sacred sites, invented cultural practices or unlicensed assets. Species cards show illustrative habitats; no unverified generated animal anatomy is used.

## Review and validation

The validation results and remaining visual limitations are recorded in the M1 entry of `docs/BUILD_NOTES.md`. Screenshots are illustrative software-renderer output, not photographs or hardware FPS evidence.

The low-tier forest still exposes procedural leaf clusters and bark. All fourteen High ground/bark roles use generated surface maps; broadleaf foliage and distant impostors use the generated canopy texture. Some ground-cover meshes still come from the existing CC0 library. Accurate Nimba hero plants remain M3; the sapling is deliberately a generic filler. No animal model is represented as complete. Some landscape illustrations are reused across related cards and are not exact surveyed viewpoints.

Dean requested a preview. The isolated `codex/nimba-preview-2026-11-19` branch deploys to Vercel previews; this draft remains unmerged and the production branch is unchanged. Use `?tier=high` on the preview to override an older saved quality preference. Vercel authentication is required for the preview domain.
