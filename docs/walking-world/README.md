# Monts Nimba on foot

The High preview uses the original playable-area elevation, land cover and canopy data. Its outer horizon now follows another 100 km-wide sample of the same Copernicus DEM. A sky-visibility bake from the local elevation grid shades gullies and shoulders. In the middle distance, solid crown clusters change silhouette as the player turns. Near the player, broadleaf models, scanned ground surfaces and fallen timber give the forest a physical scale.

The two broadleaf models and the timber scan illustrate structure. Individual trees, fallen logs and vegetation below the resolution of the habitat data are reconstructions. The [credits](../../CREDITS.md) and the in-game credits identify the source assets.

## Published walk-through

Chromium used NVIDIA Vulkan on a rented Higgsfield L40S, with High selected and a 1280 × 800 viewport. Starting from the title screen, the walker followed the forest edge for 42 m. Mapped canopy fell from 12.4 m to 2.1 m at the ridge. The forest and village checks used relocation to reach each area, followed by keyboard walking and camera rotation. The terrain streamer reported no errors in these three checks.

| Location | Median animation-frame interval over 32 frames | Capture |
| --- | ---: | --- |
| Montane grassland ridge | 16.9 ms | [Ridge](ridge.webp) |
| Cloud forest | 17.8 ms | [Forest](forest.webp) |
| Village | 19.3 ms | [Village](village.webp) |

These brief measurements cover rendering on the rental. Network latency and sustained performance vary. The durable browser preview renders on the visitor's device. The private streaming player renders on the rental while that session is active.

[Play the tested build](https://raw.githack.com/Dine706/Virtual-Museum/adc4f810f0dddb0d123a2f8f14030340f54accc4/public/preview.html?tier=high)
