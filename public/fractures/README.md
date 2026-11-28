# Baked terrain damage

Regenerate these 16 source-linked templates with `npm run bake:fractures`.
The command is deliberately separate from the normal site build. It uses the
same closed terrain, rounded fracture generator and fixed-step Havok solver as
the development checks; no mesh simplification or replacement artwork occurs.

Each template contains its intact source, crack deformation, supported fragment
poses, additional impact fragments and contact-driven falling timeline. Source
seeds 0–15 preserve different grass UV regions, stone atlas regions and earth
silhouettes. Eight templates fold inward and eight outward. Runtime board code
assigns patterns before damage and keeps neighboring patterns distinct.

`manifest.json` records compressed and encoded byte counts and SHA-256 hashes.
The `LTBF` files use shared binary sections, meshoptimizer codecs and gzip.
Coordinates and UVs use bounded 16-bit quantization, normals use octahedral
16-bit encoding, and colors use 12 bits. Thin triangles receive exact float32
vertex corrections to preserve topology. Timeline channels use separate
20-bit ranges so binary contact flags remain exact. The measured coordinate
error is below 0.000009 world units and UV error below 0.000011.

The initial loading screen fetches all templates. Encoded buffers remain in
memory; typed render arrays are expanded on demand and cached for three recent
patterns. Eviction never invalidates existing mesh instances or template
references. Damage playback performs no network request, mesh fracturing or
physics solve.

meshoptimizer and the Havok package are MIT licensed; their notices are served
in `../licenses/meshoptimizer.txt` and `../licenses/havok.txt`.
