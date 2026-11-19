# Generated world artwork

These are **AI-generated references and texture sources**, not photographs of Nimba. Dean requested replacement card imagery and generated world materials, with no “AI” badge in the visitor interface. Cards explicitly say “Reconstitution numérique / Digital reconstruction”. The asset records retain the generation method and prompts.

`manifest.json` records the source image paths, SHA-256 checksums, prompts and generation method. Large source PNGs remain in `/workspace/generated_images`; compact runtime images are committed under `public/photos/reconstruction-*` and `public/walk/art/`. Do not delete the originals. The application and Blender sapling build use the committed compressed images, so runtime startup does not require an image generation service or credentials.

Run `node scripts/build_world_art.mjs` to regenerate encoded versions when those raw PNGs are available. A missing raw file is an explicit prerequisite; do not silently create a different image or alter its checksum. The image generator is invoked through the session tool, not a paid external image API.

## Visual review

- Eight habitat/scenery illustrations cover all 23 cards. They are illustrative viewpoints, not precise geographic reconstructions or proof of a particular building or animal occurrence.
- Species cards deliberately show habitat scenes. No unverified generated animal anatomy is used. Sourced animal sheets, real-photo comparison, model cleanup and rigs remain a separate animal milestone.
- Village artwork shows generic fictional houses, following `docs/VILLAGE_SOURCES.md`; no real person's likeness, sacred site or ceremony is depicted.
- The former pit-lake illustration is an artistic environment reference, not a bathymetric or engineering survey. The walk scene continues using the measured terrain and existing lake-level calculation.
- Generic leaf sprays and a dense canopy texture are filler materials, not species identifications. They must not be relabelled as Parinari, Protea or another particular taxon without appropriate reference work.
- Generated diffuse textures are not physical scans. The derived normal maps are deliberately subtle illustrative bump; luminance is not measured surface relief.

## Blender animation

`scripts/blender/build_animated_sapling.py` uses Blender 5.3 to build a generic sapling from actual mesh geometry and the generated leaf/bark textures. It exports a two-second looping branch animation as glTF; this is an animated 3D model, not an animated flat landscape image.

Build:

```sh
/workspace/.tools/nimba-blender/bin/python scripts/blender/build_animated_sapling.py
npx --no-install gltf-transform optimize public/walk/models/generated_sapling.glb scripts/blender/out/generated_sapling.optimized.glb --compress meshopt --texture-compress webp --texture-size 1024
cp scripts/blender/out/generated_sapling.optimized.glb public/walk/models/generated_sapling.glb
```

The Blender scene remains in the existing ignored `scripts/blender/out/` folder. The compact GLB is committed. High-quality walk mode loads it lazily and drives its exported clip through `THREE.AnimationMixer`; reduced motion freezes the animation. Low/Mid retain the lightweight procedural assets.

`documentary-map.json` preserves the original card-to-photo associations. Original photos and licences remain in `assets/photos/` and `public/photos/documentary-credits.json`. All sourced card text, source URLs and location generalisation remain unchanged.
