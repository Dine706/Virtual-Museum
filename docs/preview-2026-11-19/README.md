# Monts Nimba preview

The playable revision tested on 19 November 2026 is [49a5fb0](https://github.com/Dine706/Virtual-Museum/commit/49a5fb0a20b1e339d1c322fe0145ef66007accec). Choose **Partir à pied** or **Start on foot**. Walk straight ahead from the forest edge to reach the open saddle. The standalone [browser build](https://raw.githack.com/Dine706/Virtual-Museum/49a5fb0a20b1e339d1c322fe0145ef66007accec/public/preview.html) renders on the player's device. The separate private player supplied to the owner streams the rented GPU's browser and forwards keyboard and pointer input.

## Hardware walk-through

Chromium identified its WebGL2 renderer as ANGLE Vulkan on NVIDIA L40S. The game ran at High, 1280 × 800 and device pixel ratio 1. Starting from the title, forward input covered 42.07 m from a mapped canopy height of 12.4 m to 2.1 m. For the remaining location checks, the test relocated the walker to a dense cloud forest and then to a mapped village house near Bossou. It moved and turned at each location. All three reported High quality and no terrain error.

| Location | Travel during turn check | Camera turn | Median browser frame interval |
| --- | ---: | ---: | ---: |
| Ridge | 0.52 m | 15.3° | 16.8 ms |
| Dense forest | 0.68 m | 19.9° | 18.5 ms |
| Village | 0.66 m | 21.4° | 22.7 ms |

Each median covers 32 animation-frame intervals just after the input check. These measurements describe those brief views on the rental. They exclude network delivery time. A separate browser opened the streaming player, received frames, clicked the start button, walked and turned. Its resulting view is captured below. The production TypeScript/Vite build and all eight walking physics checks passed.

[Title](title.webp) · [Ridge](ridge.webp) · [Cloud forest](forest.webp) · [Village](village.webp) · [Streamed client](stream.webp)

## Landscape and art

The regional surface is a 10 m Copernicus Sentinel-2 true-colour observation from 15 December 2024 (S2A_29NNJ_20241215_0_L2A), reprojected to the game bounds. It supplies actual patterns of grassland, ravines and woodland. The original Copernicus elevation, land cover and canopy data drive relief and vegetation placement. A CC0 Poly Haven sky supplies cloud detail. Trees, grass, village facades and wildlife are reconstructions. The photographed sky and generated opening view are illustrative.

Higgsfield generated the [canopy](https://d8j0ntlcm91z4.cloudfront.net/user_3MKfEEPT6ltboLh2sYMbj00K3xw/hf_20261119_173048_c2d70462-9ad2-430f-9e04-54b92fde1012.png), opening artwork, four wildlife portraits and village material swatches. Provenance is recorded in the landscape manifest and game credits. The foreground includes bending 3D blades, Blender-authored sapling roots and branches, and a Blender-baked hornbill wingbeat/glide cycle. Distant tree silhouettes and some foreground vegetation can still show repetition.

## Preview lifetime

The private stream serves one player at a time and ends with the GPU rental. The browser build and captures remain on the GitHub branch. The rental used here bills 71 credits per hour while active and has a 10-minute idle auto-pause. The public relay transfers the game's frames and a limited set of key and pointer events. The game-only invite is supplied separately.

## Rebuilding the standalone preview

Vercel runs the normal production build. The branch also includes a standalone HTML entry and compiled assets for testing without a Vercel login. When source changes, move the previous compiled `public/assets` folder outside the checkout, run `npm ci` and `npm run build`, then copy `dist/assets` to `public/assets` and `dist/index.html` to `public/preview.html`. Commit those compiled files together.

The rental's stream service is in `scripts/gpu-preview`. It uses aiohttp and Chromium through Playwright, with NVIDIA Vulkan enabled. It serves a single authenticated game session bound to loopback, with a temporary HTTPS relay for the owner. The relay address and player key are ephemeral.
