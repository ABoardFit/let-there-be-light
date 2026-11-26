# Game texture sources

Created for **빛이 있으라** with the built-in image generation tool on 2026-11-26. No third-party game art was copied. Original PNGs are included in this repository.

- `moss-ground.png` — 1254 × 1254, overhead diffuse ground texture.
- `rock-cliff.png` — 1254 × 1254, vertical earth and rock texture.
- `pine-tree.png` — 1145 × 1374, transparent tree cutout for a fixed-camera sprite.
- `sunset-clouds.png` — 1536 × 1024, cloud background.
- `hero-knight.png` — 1024 × 1536, original dawn knight, transparent ready-pose sprite.
- `hero-attack.png` — 1717 × 916, matching knight thrust animation pose.
- `shade-enemy.png` — 1086 × 1448, original purple armored wraith sprite.

The combat characters were also generated with the built-in image generation tool on 2026-11-26. They are original designs, not artwork extracted from the reference games. The three enemy classes share the wraith illustration, with separate labels, rings, and sizes. All character PNGs contain alpha transparency.

## Combat sprite generation

The knight brief specified ivory embroidered cloth, muted teal lining, bronze and gold armor, ash-blond hair, a golden sword, a right-facing three-quarter view, and a slightly elevated miniature camera. The enemy brief specified a left-facing purple armored wraith with a horned hood, magenta eyes, claws, and torn robes.

Final ready-pose edit prompt:

> Edit this original knight game sprite. Preserve the knight's face, costume, sword, ready stance and rightward facing direction. REMOVE ALL brown haze, all glows around the silhouette, all background, all floor and all cast shadows. Keep only the solid character and held sword. Output a clean isolated full-body game character with actual transparent alpha immediately outside the precise silhouette. Add generous empty transparent padding 10% on every side, especially left cloak edge and top of head. The sword's solid golden surface can remain bright but no surrounding halo. Do not add a platform, background color or vignette. No text.

Attack-pose edit prompt:

> Edit the supplied original knight into a matching ATTACK FRAME for the same tactical game sprite. Same identity, face, ivory embroidered cloak, muted teal lining, bronze armor, boots and golden sword, same detailed miniature fantasy rendering, same rightward three-quarter facing and slightly overhead camera. Change only pose: powerful forward lunge toward screen RIGHT, front leg bent, rear leg braced, both arms extending the golden sword horizontally forward in a thrust, cloak trailing left. Entire figure and blade fully in frame with transparent margin. Remove ALL brown background haze and glows; isolate the solid character with exact clean alpha silhouette, no floor, no shadow, no magic effects outside silhouette, no text. Actual transparent background.

Original generated files retained in the local generation archive:
- Ready pose: `exec-56ecf401-dd57-459b-879f-2f824ee89a86.png`
- Attack pose: `exec-a73b6d39-4dd7-4e91-a43d-4e5cf37cfeb9.png`
- Enemy: `exec-418a25c9-a42b-4321-936b-5e0e9e5b1460.png`

## Generation prompts

### Moss ground

Use case: stylized-concept. Asset type: production game texture, square seamless albedo/diffuse ground tile. Create a full-bleed perfectly overhead orthographic macro view of an old moss-covered compact earth turf surface for a richly textured miniature fantasy floating island board game. Dense velvety short olive-green moss interwoven with fine individual grass blades, weathered ochre earth patches, tiny beige mineral grit and scattered minute pale pebbles. Lived-in, tactile, handcrafted realism like high-quality prerendered strategy game terrain. Predominantly muted olive and forest green, earthy golden-brown, fine detailed variation throughout. Each texture represents about one square meter. Natural irregular ground, no square divisions inside image, no border, no bevel or sides, no perspective, no tall plants, no flowers, no structures. Soft neutral diffuse lighting with fine surface occlusion only; no strong cast shadows, no sunlight gradient. Edges must tile seamlessly. 1024 square, no text or watermark.

### Rock cliff

Use case: stylized-concept. Asset type: production game texture for vertical side walls of a floating earth island, square full-bleed seamless horizontally tileable albedo/diffuse. Weathered fractured gray-brown limestone and compact ochre soil with fine stratification, irregular small cracks, gritty mineral facets, occasional thin dark dangling roots and patches of dark green moss near the upper edge. Richly detailed tactile miniature fantasy strategy game material, hand-crafted natural realism. Front-on orthographic flat material scan, no perspective, no 3D block, no external background, no floor, no large stones or boulders projecting out, no water. Surface fills entire image. Soft neutral diffuse light, realistic local crevice occlusion, no harsh directional shadows. Muted brown-gray earth palette with restrained olive moss. 1024 square, no text, no watermark.

### Pine tree

Use case: stylized-concept. Asset type: single transparent-background game sprite for fixed-view isometric miniature fantasy garden. A richly detailed mature evergreen fir tree, entire tree including trunk base visible centered with generous transparent margin. Viewed from an elevated camera looking down about 35 degrees, like a beautifully prerendered strategy game prop. Distinct irregular tiers of sweeping needle-covered branches, thousands of delicate short dark green needles with olive-gold highlights, some visible woody twig structure and a short rough brown trunk. Narrow pointed crown, spreading branches toward base; organic asymmetrical jagged silhouette with visible gaps between branches. NOT smooth cone, NOT spherical bush, NOT flat vector, NOT toy low-poly, NOT cartoon emoji. Tactile natural detailed tree as if a handcrafted miniature photographed for a fantasy board game. Warm upper-left soft sunlight, deep green shadows. Isolated single tree only, no ground, no grass platform, no scenery, no cast shadow outside tree silhouette, no text. Actual transparent alpha background, portrait composition.

### Sunset clouds

Use case: stylized-concept. Asset type: wide background painting for a miniature fantasy floating-island game. A vast luminous sea of softly billowing cumulus clouds viewed from high above, sunset peach orange and warm apricot glowing cloud tops, soft lavender and muted mauve shadows, atmospheric depth and gentle diffusion. Camera looks downward at the clouds from a floating island, no straight horizon line. Painterly cinematic but convincingly volumetric fluffy clouds, like a gorgeous fantasy strategy game sky backdrop. Large soft cloud masses especially around bottom and sides, calmer hazier open area in the middle for gameplay readability. Warm sunlight from upper left, restrained contrast, magical serene mood. Absolutely no islands, terrain, trees, buildings, people, sun disk, letters, UI or watermark. Not abstract marble, not swirling fluid texture, not smoke. Full-bleed landscape composition, 1536x1024.
