# Alga Worlds asset pipeline

Builds the downloadable 3D asset pack of Alga Worlds into `apps/server/assets/worlds/v1/`: furniture and decor,
tiling PBR texture sets, skies, two mannequins and their animation clips, plus a `manifest.json` that lists every
file with its SHA-256 and a `CREDITS.md`.

This folder is a standalone npm package on purpose. It is not one of the repository's workspaces, so its
dependencies (glTF-Transform, meshoptimizer, sharp) never reach the app or the server.

## Rebuild from scratch

```sh
cd tools/worlds-assets
npm install          # or `npm ci` to reproduce the lockfile exactly
node build.mjs       # downloads sources into .cache/ (first run: about 220 MB), writes the pack
node validate.mjs    # checks the pack against its manifest
```

Node 24 or newer. A full build with a warm cache takes well under a minute. `node build.mjs --only=models`
(or `textures`, `sky`, `avatar`, comma-separated) rebuilds some steps and reuses the last report of the others;
the manifest and credits are always rewritten.

The build stops with a non-zero exit code if the pack exceeds its budget (48 MiB, `BUDGET_BYTES` in `config.mjs`).
If that ever happens, lower `WEBP_QUALITY` a little or the texture sizes before touching geometry.

## The licence rule: CC0 only

Every source must be dedicated to the public domain under CC0 1.0. Nothing with attribution, share-alike or
non-commercial terms goes in, however good it looks. Today that means two sources:

- [Poly Haven](https://polyhaven.com) (models, textures, HDRIs; everything there is CC0, see
  https://polyhaven.com/license).
- [Quaternius](https://quaternius.com) Universal Animation Library 1 and 2 (CC0, `License.txt` inside each
  archive; mirrored at https://opengameart.org/content/universal-animation-library and
  https://opengameart.org/content/universal-animation-library-2).

To add an asset: confirm its licence at the source, add its id to `config.mjs`, rebuild. `CREDITS.md` is generated
from the same list, so an asset cannot ship uncredited. The art direction is a realistic, clean, modern interior:
no cartoon, no low-poly, nothing worn or dirty.

## What each step does

Everything that drives the build lives in `config.mjs`.

### models (`lib/models.mjs`)

For each Poly Haven model id, downloads the 1k glTF with its `.bin` and textures
(`GET https://api.polyhaven.com/files/<id>` -> `gltf.1k.gltf`, MD5-checked) and writes `models/<id>.glb`
(lower-cased id):

1. Node animations are dropped (a couple of models ship sliding doors); the model keeps its authored pose.
2. Every node transform is baked into the vertices and the scene is collapsed to one node with one mesh, one
   primitive per material (`flatten`, `transformMesh`, `join`), then welded. Only `POSITION`, `NORMAL`, `TANGENT`
   and `TEXCOORD_0` are kept.
3. Above 60 000 triangles the mesh is simplified with meshoptimizer (error <= 0.001 of the mesh radius, never
   below 60 % of the original triangle count). Plants and anything with a cut-out or blended material are never
   simplified.
4. If the bounding box disagrees with the real dimensions Poly Haven publishes for the asset by more than 5 %,
   the model was exported at the wrong unit scale and is scaled back to metres (the build log says `RESCALED`).
5. The model is moved, never rotated: bounding box centred on X and Z, lowest point at Y = 0.
6. Textures are re-encoded as WebP (`EXT_texture_webp`): colour maps at quality 85, normal and
   roughness/metalness maps at 90, at most 1024 px, or 512 px when the model's largest dimension is under 0.6 m.
   Alpha is kept, untouched, wherever a `MASK`/`BLEND` material reads it. Materials are otherwise left exactly as
   Poly Haven exported them.
7. Geometry is reordered, quantized (`KHR_mesh_quantization`: positions 14 bits, normals 12, UVs 12) and
   compressed with `EXT_meshopt_compression`.

The manifest records `size` (metres, after recentring), `tris`, `bytes` and `source` for each model.

### textures (`lib/textures.mjs`)

For each set, downloads the 1k `Diffuse`, `nor_gl` (OpenGL normals) and `arm` maps of a Poly Haven texture and
writes `textures/<set>/color.webp`, `normal.webp`, `arm.webp` at 1024 x 1024. `arm` is AO (R), roughness (G),
metalness (B) as Poly Haven packs it; if a set has no `arm`, it is packed from the separate maps. `tileMeters` is
the real size of one tile, from the asset's `dimensions` (millimetres).

A set marked `neutral` in `config.mjs` has its colour map rewritten as luminance (optionally lifted to a light
grey), so that a scan which happens to be a saturated colour can still be tinted by multiplying a colour over it.
Normal and ARM maps are never altered.

### sky (`lib/skies.mjs`)

For each sky, `sky/<id>.hdr` is the 1k Radiance file of a Poly Haven HDRI, byte for byte (for image-based
lighting), and `sky/<id>.webp` is its tonemapped panorama resized to 4096 x 2048 (the backdrop behind the windows).

### avatar (`lib/avatar.mjs`)

Reads three GLBs straight out of the two Quaternius archives (pinned by SHA-256; they are downloaded into the
cache when missing):

- `avatar/mannequin_a.glb` and `avatar/mannequin_b.glb`: mesh + skin + skeleton, no clips. Materials are named by
  role: `body` is the one covering the most surface area, `joints` the other. Only `POSITION`, `NORMAL`,
  `TEXCOORD_0`, `JOINTS_0` and `WEIGHTS_0` are kept; quantized and meshopt-compressed.
- `avatar/animations.glb`: the skeleton (no mesh, no skin) and the clips listed in `CLIPS`.

All three share one skeleton, the 65-joint UE-style rig of library 2. Library 1 uses Rigify names (`DEF-hips`,
`DEF-upper_arm.L`, ...); they are renamed through `unifiedBoneName()`, and the build proves the mapping instead of
trusting it: each mapped joint must have the mapped parent and the same rest transform within 1e-3.

Clips keep their authored keys (same times, never resampled). Scale tracks are removed, translation tracks are
kept only on `root` and `pelvis`, rotations are stored as normalized 16-bit quaternions. After writing the file
the build reads it back and compares the world position of `hand_l`, `foot_l` and `Head` at t = 0 and at
mid-clip with the original clip; more than 1 mm of drift fails the build.

### manifest (`lib/manifest.mjs`)

Writes `CREDITS.md` (one row per source asset, with the authors Poly Haven lists, plus the Quaternius licence
texts) and `manifest.json` (`files` holds every file of the pack except the manifest itself, with size and
SHA-256). A file on disk that no record points at fails the build.

## Loading the pack (three.js)

- GLBs need `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`. They require `EXT_meshopt_compression` and
  `KHR_mesh_quantization`, and models also `EXT_texture_webp`. No Draco, no KTX2.
- Units are metres, Y is up. A model's `gltf.scene` has an identity transform and contains one node named after
  the model; that node carries the de-quantization scale and offset, so place and rotate the scene (or a parent),
  and take world matrices into account before reusing a child geometry elsewhere (instancing, merging).
- Texture sets: `color` is sRGB, `normal` and `arm` are linear data. `arm` serves as `aoMap`, `roughnessMap` and
  `metalnessMap` at once. All three tile (`RepeatWrapping`).
- Mannequins face +Z at rest (left hand on +X), feet at Y = 0. Hierarchy: `Armature` > `Mannequin` (skinned mesh)
  and `Armature` > `root` > `pelvis` > ... Clips from `animations.glb` bind by bone name, so an `AnimationMixer`
  on a mannequin's scene plays them directly. The clips are in place: `root` does not travel.

## Curation helpers

- `node scripts/contact-sheet.mjs textures oak --all wood,floor --flat` renders the thumbnails (or the real colour
  maps, or whole HDRI panoramas with `--pano`) of matching Poly Haven assets into `.cache/sheets/`, to judge a
  texture or a sky by eye before writing it into `config.mjs`. The header of the script lists the options.
- `node scripts/preview.mjs` draws every built model, and both mannequins posed by a few clips, with a small CPU
  rasteriser that reads the final GLBs. It is a smoke test for shape, placement, UVs and clip binding.

## Downloads are untrusted data

Everything fetched lands under `.cache/` (git-ignored), from an allow-list of hosts, with a generic user agent.
Poly Haven files are checked against the MD5 its API publishes, the Quaternius archives against a SHA-256 pinned
in `config.mjs`. Nothing downloaded is ever executed; the files are only parsed by the scripts in this folder.

## Known gaps

- `decorative_book_set_01` is in the curated list, but Poly Haven publishes no glTF for it (its covers are driven
  by a Blender shader). The build reports it and leaves it out.
- Poly Haven's glTF exports wire the ARM texture as metallic-roughness only. The AO channel is in the image, but
  no `occlusionTexture` is declared, and the pipeline does not add one: on some materials (the boombox speakers,
  the ceiling lamp) that channel is empty and would black out indirect light.
