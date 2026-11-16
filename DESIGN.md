# DESIGN.md – Monts Nimba 3D demo

**Design idea:** "A mountain breathing above the clouds." The terrain is the hero; the UI is quiet, dark-forest glass that lets the landscape show through. Warm laterite and savanna-gold accents come from the real place (red tracks, golden grass), cool mist blues from the cloud-capped ridge. Everything is calm, premium and readable on a phone in sunlight.

## 1. Palette (sampled from the kit's own Nimba photographs and the land-cover map)
| Token | Hex | Where it comes from / use |
|---|---|---|
| `--forest-950` | `#0F1A0B` | App background, loading screen |
| `--forest-900` | `#16210F` | Panel background (at 88–92 % opacity + blur), PWA theme colour |
| `--forest-800` | `#2A3C1B` | Canopy shadow (photo `forest-canopy`); cards, chips background |
| `--forest-700` | `#424E2D` | Dense lowland forest (`hero-massif`) |
| `--forest-600` | `#435B2F` | Mid leaf green (`grassland-valley`); buttons pressed |
| `--moss-500` | `#62714F` | Montane moss; secondary lines |
| `--sage-400` | `#81948A` | Hazy forest on the horizon; muted text on dark |
| `--mist-300` | `#ACC2C5` | Mist / cloud shadow; dividers, inactive icons |
| `--cloud-50` | `#EFF4F2` | Cloud white; primary text on dark |
| `--savanna-500` | `#AE905B` | Dry-season savanna gold; primary accent / focus ring |
| `--straw-300` | `#C1B69E` | Dry grass; hover states, captions |
| `--umber-700` | `#786B59` | Bare soil; borders on light surfaces |
| `--laterite-500` | `#B4532A` | Red earth tracks of Bossou (approx., from the village/market photos); culture accent, enclave outline |
| `--dusk-600` | `#375D77` | Ridge at dusk (`peak-cloudcap`); conservation accent |
| `--dusk-800` | `#1C4662` | Deep sky blue; top of the sky gradient at golden hour |
| `--water-500` | `#3FA7B5` | Water pins and spring glints (not photo-sampled; chosen to read on dark green) |
| `--alert-500` | `#E0643F` | Danger List / mining warnings (use sparingly) |

**Category colours (pin fill + chip):** peak `#D7B26A`, habitat `#7DB26B`, species `#E0B04A` with dark glyph, culture `#C8683F`, conservation `#5C93B5`, water `#3FA7B5`. Each pin also has a **glyph** (▲ peak, leaf habitat, paw species, hut culture, shield conservation, drop water) – colour is never the only cue.
Light surfaces (credits sheet in light mode, tooltips): background `#F4F1E8`, text `#1B2314`, border `#C9C0AA`.

**Scene colours:** Clear day sky `#8FB6D9 → #DCE9EF` (zenith → horizon); golden hour `#1C4662 → #F2B26B` with sun `#FFD9A0`, fog `#D9B98E`; mist `#B9C6C9 → #E6ECEB`, fog `#CBD6D6` density high. Cloud sprites `#FFFFFF` at 55–85 % alpha, shaded `#9FB1BA` at the base.

## 2. Typography (Google Fonts, SIL OFL, **self-hosted** via fontsource – no runtime request to Google)
* **Display / titles:** **Fraunces** (variable, opsz + wght; use 600, optical size auto) – warm, characterful serif that feels editorial, handles French accents (é, è, ô, ç, œ) and `1 752 m` numerals.
* **UI / body:** **Inter** (variable, 400/500/600) – excellent legibility on small phones; `font-feature-settings: "tnum"` for numbers/elevations.
* Load only **Latin + Latin-ext** subsets, `font-display: swap`, preload the two woff2 files (≤ 80 KB together). Fallback stack: `Fraunces, "Iowan Old Style", Georgia, serif` / `Inter, system-ui, "Segoe UI", Roboto, sans-serif`.
* Scale (rem, fluid with `clamp`): H1 `clamp(1.75rem, 4vw, 3rem)` · panel title `clamp(1.375rem, 2.2vw, 1.75rem)` · body `1rem/1.6` (never below 16 px) · caption `0.8125rem/1.4` · chip `0.75rem` uppercase tracking `.06em`.

## 3. Layout – three breakpoints
Safe areas: use `env(safe-area-inset-*)`. Canvas is `100dvh`. All controls ≥ 44 px.

### Phone portrait (≤ 599 px)
```
┌───────────────────────────┐  top bar (56 px, translucent): title "Nimba" left, FR|EN pill, ☰ menu right
│ Nimba         [FR|EN] [≡] │
│                           │
│        3D CANVAS          │  floating mode pills just below top bar: [Nature][Culture][Conservation] (horizontal scroll)
│    ●  pins as small dots  │  pins: 28 px dots; label only on tap/focus; below 600 px show numbered badges when > 8 overlap
│                           │  bottom-left: ☀︎ atmosphere button, ⌂ reset view; bottom-right: list view button
├───────────────────────────┤
│ ▔▔  bottom sheet ▔▔       │  snap 18 vh (peek: title + chip) / 55 vh (short text + photo) / 92 vh (everything). Drag handle 4×36 px.
└───────────────────────────┘  footer credit line sits inside the About sheet on phones (not over the canvas)
```
### Tablet (600–1023 px)
Canvas fills the screen; **side panel 380 px** slides over from the right (or bottom sheet in portrait ≤ 820 px wide). Mode pills top-centre, controls bottom-left, hotspot list as a left drawer. Footer credit line (one line, 12 px) bottom-centre, 60 % opacity.

### Desktop (≥ 1024 px)
Canvas fills the screen; **side panel 440 px** (max 36 vw) glass card inset 16 px from the right with 20 px radius; left rail (64 px) with icon buttons (Tour, List, Atmosphere, Layers, Language, About) and tooltips; mode toggle as a segmented control top-centre; mini **ridge elevation profile** (stretch) bottom-centre; footer credits bottom-left. When the panel is open the camera target shifts so the hotspot sits in the visible area (offset the projection centre by half the panel width).

## 4. Surfaces, shape and motion
* Radius 20 px panels / 12 px cards / full pill for chips and toggles. Shadow `0 12px 40px rgba(0,0,0,.35)`. Panel: `background: rgba(22,33,15,.90); backdrop-filter: blur(14px) saturate(1.1);` with solid fallback `#16210F` when `backdrop-filter` is unsupported or on the Low tier.
* 1 px inner border `rgba(239,244,242,.12)`. Dividers `rgba(172,194,197,.18)`.
* Motion: 220 ms `cubic-bezier(.2,.8,.2,1)` for panels, 120 ms for hover; camera tweens 1.0–1.4 s cubic ease-in-out; everything off under `prefers-reduced-motion`.
* Focus ring: 3 px `--savanna-500` + 2 px offset, always visible on keyboard focus.

## 5. Intro: loading → title card → flyover
1. **Loading screen** (forest-950): a thin contour-line SVG of the ridge draws itself (stroke animation), text "Chargement du massif… 38 %" with real progress; after 6 s a secondary button "Voir la liste des sites" (list view). Weight ≤ 15 KB inline.
2. **Title card** over the live terrain (slowly rotating): H1 *Monts Nimba*, subtitle "Réserve naturelle intégrale · Patrimoine mondial de l'UNESCO depuis 1981", big pill button **Explorer** and smaller *Passer / Skip*. FR/EN toggle visible. Credit line at the bottom.
3. **Flyover** 12 s as in `CLAUDE.md` §6.9 with subtitles that fade in/out (≤ 6 words each): "Trois pays, une montagne" → "1 752 m au-dessus des nuages" → "Un château d'eau pour la région". Ends in the default orbit and shows a hint "Touchez un repère / Tap a pin" (once, stored).

## 6. Hotspot marker style
* **Pin:** 28 px (phone) / 32 px (desktop) circular glass button: fill = category colour at 92 %, 2 px `--cloud-50` ring, centred glyph (dark `#16210F` on light fills), soft drop-shadow. A **stem** (1.5 px line, 24 px long, white 60 %) drops to the terrain point with a 6 px ground dot so the pin reads as anchored.
* **Idle:** gentle 2.4 s pulse ring (scale 1 → 1.8, opacity .5 → 0), staggered; no pulse under reduced motion or Low tier.
* **Hover/focus:** pin scales 1.15, label chip appears to the right (title, 1 line, max 22 ch + …).
* **Selected:** ring becomes `--savanna-500`, pin scales 1.25, others dim to 55 % opacity.
* **Occluded** (behind a ridge): fade to 25 % and stop receiving clicks; **generalised/area** hotspots (`location_precision` area/symbolic) draw a **dashed halo** (radius ≈ 600 m projected) instead of a precise stem.
* Number badge variant (phones when crowded): circle with `order` number.

## 7. Modes (segmented control; keyboard arrows; state in the URL `?mode=`)
| Mode | Pins shown | Scene changes |
|---|---|---|
| **Nature / Nature** | `modes` includes `nature`: peaks, habitats, species, water | Habitat bands tint the terrain lightly (forest <1,000 m, montane 1,000–1,400 m, grassland >1,400 m using DEM), water glints; mist stays |
| **Culture / Culture** | `culture`: Bossou, IREB, cultural landscape, N'Zo, Yéalé… | Warm golden-hour grade, village dots, labels of Bossou/Séringbara/Gbakoré/N'Zo/Yéalé/Yekepa appear as small text on the terrain |
| **Conservation / Conservation** | `conservation`: unesco, danger list, tripoint, mining enclave, CEGENS, corridor, Yekepa | Reserve boundary glows amber, enclave outlined terracotta + hatched label "approximate / approximatif", border lines visible, legend chip "Danger List since 1992" |
Default on load: **Nature**. Switching modes keeps the open panel if its hotspot is still visible, otherwise closes it.

## 8. Info panel / bottom-sheet anatomy
1. Drag handle (phone) / close ✕ (44 px).
2. **Chip row:** category chip (colour + glyph + "Espèce / Species"), elevation chip `▲ 1 752 m`, precision chip for `area`/`approximate` ("Zone indicative · Approximate area").
3. **Title** (Fraunces 600) + one-line short text (Inter 500, `--straw-300`).
4. **Photo carousel**: 3:2 crop, swipe/arrow keys, dots, caption `alt + © author · licence` (link to Commons), tap = full-screen viewer (pinch zoom). If no photo: tasteful SVG silhouette card with text "Illustration – pas de photo libre disponible".
5. **Long text** (body 16 px, max 62 ch line length), then **Key facts** 2-column grid (label muted, value bold, tabular numbers).
6. **Sources** accordion (open by default on desktop): each source = label + hostname, external-link icon.
7. Footer actions: ← Précédent · Suivant → (in `order`), "Partager" (Web Share API → copy link), "Voir sur la carte" (re-centres).
Status messages: `aria-live` announces "Ouvert : Mont Richard-Molard".

## 9. Free-click readout (tooltip card at the tap point)
`▲ 1 420 m · Prairie d'altitude · Dans la réserve (Guinée) · Plus proche : Pierre Richaud (1,2 km)` – tap to open nearest hotspot. Dismiss on next tap/drag. Land-cover labels FR/EN: Forêt / Forest, Arbustes / Shrub, Prairie / Grassland, Cultures / Cropland, Bâti / Built-up, Sol nu / Bare, Eau / Water.

## 10. Atmosphere presets (button cycles; also in the About sheet)
* **Clear (Dégagé):** sun azimuth 135°, elevation 52°, fog density low, clouds sparse high.
* **Golden hour (Heure dorée):** sun azimuth 255°, elevation 9°, warm fog `#D9B98E`, long shadows, bloom strength .35 on High tier only.
* **Mist (Brume):** sea of clouds at ≈ 1,350 m filling valleys, summits above, desaturated palette, subtle drifting animation (0.6 m/s).
Cross-fade presets over 1.2 s (lerp of light/fog/sky uniforms; not by reloading anything).

## 11. Language toggle
Pill `FR | EN` in the top bar (phone) or left rail (desktop); `aria-pressed`, persists; switching re-renders panel text in place without closing it and re-announces the title. Default is **French** for everyone (primary audience); EN is used only after an explicit choice, or on first visit when `navigator.language` is English and the visitor has not chosen yet (then show a small "Switch to English?" hint instead of switching silently).

## 12. Credit footer (plain text, no logos)
FR: `Prototype non officiel – Phase 0 · Un projet Tech Guinée pour le CSIG (fiche P19) · Données : Copernicus DEM, ESA WorldCover, WDPA, OpenStreetMap · Photos : voir Crédits`
EN: `Unofficial prototype – Phase 0 · A Tech Guinée project for CSIG (fiche P19) · Data: Copernicus DEM, ESA WorldCover, WDPA, OpenStreetMap · Photos: see Credits`
The "Crédits / Credits" link opens the About sheet with the full attribution list (see `docs/DATA_LICENCES.md`, `assets/photos/credits.json`). 12 px on desktop/tablet, inside the About sheet on phones.

## 13. Iconography
Simple 1.75 px-stroke line icons (Lucide or Phosphor, MIT/ISC, import only needed ones as inline SVG). Custom glyphs only for the six categories. No emojis in the production UI (use them only in this document).

## 14. Quality bar (self-review before showing Dean)
* Take screenshots at the three sizes in Clear, Golden hour and Mist; terrain should look like a real mountain photograph from a drone, not a plastic height map – if it looks flat, raise exaggeration to 2.2×, add noise detail, strengthen fog layering.
* Panel text legible in bright sunlight (contrast ≥ 7:1 for body on dark glass).
* No layout shift when fonts load; no flash of unstyled text on the loading screen.
