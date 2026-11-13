// Checks the built pack against its manifest. Exits non-zero on the first category that fails.
//
//   node validate.mjs
import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { getBounds } from '@gltf-transform/functions'
import sharp from 'sharp'
import { BUDGET_BYTES, CLIPS, OUT_DIR, SKY_SIZE, TEXTURE_SIZE } from './config.mjs'
import { sha256 } from './lib/cache.mjs'
import { countTriangles, createIO } from './lib/gltf.mjs'
import { listPackFiles } from './lib/manifest.mjs'
import { clipDuration } from './lib/pose.mjs'

/** Models must be centred and grounded to within a millimetre (position quantization moves vertices by less). */
const PLACEMENT_TOLERANCE = 1e-3

const problems = []
const check = (condition, message) => {
  if (!condition) problems.push(message)
  return condition
}
const sameSet = (a, b) => a.length === b.length && a.every((value) => b.includes(value))

const manifest = JSON.parse(await readFile(joinPath(OUT_DIR, 'manifest.json'), 'utf8'))
const io = await createIO()
io.setLogger({ debug() {}, info() {}, warn() {}, error: (message) => problems.push(String(message)) })

// 1. Every listed file is on disk with the listed size and hash, and nothing unlisted is shipped.
const onDisk = (await listPackFiles()).filter((file) => file !== 'manifest.json')
check(sameSet(onDisk, Object.keys(manifest.files)), `files on disk and manifest.files differ: ${[...onDisk.filter((file) => !manifest.files[file]), ...Object.keys(manifest.files).filter((file) => !onDisk.includes(file))].join(', ')}`)
let totalBytes = (await readFile(joinPath(OUT_DIR, 'manifest.json'))).length
const contents = new Map()
for (const [file, listed] of Object.entries(manifest.files)) {
  const bytes = await readFile(joinPath(OUT_DIR, file)).catch(() => null)
  if (!check(bytes, `${file}: missing`)) continue
  contents.set(file, bytes)
  totalBytes += bytes.length
  check(bytes.length === listed.bytes, `${file}: ${bytes.length} bytes on disk, manifest says ${listed.bytes}`)
  check(sha256(bytes) === listed.sha256, `${file}: SHA-256 differs from the manifest`)
}
console.log(`files     ${contents.size} hashed, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB in total (budget ${(BUDGET_BYTES / 1024 / 1024).toFixed(0)} MiB)`)
check(totalBytes <= BUDGET_BYTES, `pack is over budget: ${totalBytes} bytes`)

// 2. Every GLB loads (meshopt + WebP + quantization extensions registered); models sit centred on the ground.
const load = async (file) => {
  if (!check(contents.has(file), `${file}: referenced by the manifest but not listed in files`)) return null
  try {
    return await io.readBinary(new Uint8Array(contents.get(file)))
  } catch (error) {
    problems.push(`${file}: does not load (${error.message})`)
    return null
  }
}
let worstPlacement = 0
let modelTriangles = 0
for (const [id, model] of Object.entries(manifest.models)) {
  const document = await load(model.file)
  if (!document) continue
  const root = document.getRoot()
  const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0])
  const offCentre = Math.max(Math.abs((min[0] + max[0]) / 2), Math.abs((min[2] + max[2]) / 2), Math.abs(min[1]))
  worstPlacement = Math.max(worstPlacement, offCentre)
  check(offCentre <= PLACEMENT_TOLERANCE, `${id}: bounding box is ${(offCentre * 1000).toFixed(2)} mm off centre / off the ground`)
  check(max.every((value, axis) => Math.abs(value - min[axis] - model.size[axis]) <= 2 * PLACEMENT_TOLERANCE), `${id}: size ${max.map((value, axis) => (value - min[axis]).toFixed(3))} differs from manifest ${model.size}`)
  check(countTriangles(document) === model.tris, `${id}: ${countTriangles(document)} triangles, manifest says ${model.tris}`)
  check(model.bytes === manifest.files[model.file]?.bytes, `${id}: bytes differ between models and files`)
  check(root.listTextures().every((texture) => texture.getMimeType() === 'image/webp'), `${id}: has a texture that is not WebP`)
  check(root.listExtensionsRequired().some((extension) => extension.extensionName === 'EXT_meshopt_compression'), `${id}: not meshopt-compressed`)
  modelTriangles += model.tris
}
console.log(`models    ${Object.keys(manifest.models).length} load, ${modelTriangles} triangles, worst placement error ${(worstPlacement * 1000).toFixed(3)} mm`)

// 3. Avatar: two bodies on the same skeleton, and exactly the expected clips.
const animations = await load(manifest.avatar.animations)
const clipIds = Object.keys(CLIPS)
if (animations) {
  const found = animations.getRoot().listAnimations()
  check(sameSet(found.map((animation) => animation.getName()), clipIds), `animations.glb holds [${found.map((animation) => animation.getName())}], expected exactly [${clipIds}]`)
  check(sameSet(Object.keys(manifest.avatar.clips), clipIds), 'manifest.avatar.clips does not list exactly the expected clip ids')
  const bones = new Set(animations.getRoot().listNodes().map((node) => node.getName()))
  for (const animation of found) {
    const listed = manifest.avatar.clips[animation.getName()]
    check(listed && Math.abs(clipDuration(animation) - listed.duration) < 1e-3, `${animation.getName()}: duration differs from the manifest`)
    check(animation.listChannels().every((channel) => channel.getTargetPath() !== 'scale'), `${animation.getName()}: still has a scale track`)
    check(animation.listChannels().every((channel) => channel.getTargetPath() !== 'translation' || ['root', 'pelvis'].includes(channel.getTargetNode().getName())), `${animation.getName()}: translation track on a bone other than root/pelvis`)
  }
  for (const [key, file] of Object.entries(manifest.avatar.bodies)) {
    const body = await load(file)
    if (!body) continue
    const root = body.getRoot()
    const joints = root.listSkins()[0]?.listJoints().map((joint) => joint.getName()) ?? []
    check(joints.length > 0 && joints.every((joint) => bones.has(joint)), `body ${key}: skeleton is not the one the clips animate`)
    check(sameSet(root.listMaterials().map((material) => material.getName()), ['body', 'joints']), `body ${key}: materials are [${root.listMaterials().map((material) => material.getName())}]`)
    check(root.listAnimations().length === 0, `body ${key}: carries clips`)
  }
  console.log(`avatar    2 bodies, ${found.length} clips: ${found.map((animation) => animation.getName()).join(' ')}`)
}

// 4. Images have the promised dimensions; the HDR files are Radiance files.
for (const [name, set] of Object.entries(manifest.textures)) {
  for (const key of ['color', 'normal', 'arm']) {
    const meta = contents.has(set[key]) ? await sharp(contents.get(set[key])).metadata() : {}
    check(meta.format === 'webp' && meta.width === TEXTURE_SIZE && meta.height === TEXTURE_SIZE, `${name}.${key}: expected a ${TEXTURE_SIZE}² WebP`)
  }
  check(set.tileMeters > 0, `${name}: tileMeters missing`)
}
for (const [id, sky] of Object.entries(manifest.skies)) {
  const meta = contents.has(sky.image) ? await sharp(contents.get(sky.image)).metadata() : {}
  check(meta.format === 'webp' && meta.width === SKY_SIZE[0] && meta.height === SKY_SIZE[1], `sky ${id}: expected a ${SKY_SIZE.join('x')} WebP`)
  check(contents.get(sky.hdr)?.subarray(0, 10).toString('latin1') === '#?RADIANCE', `sky ${id}: ${sky.hdr} is not a Radiance .hdr`)
}
console.log(`images    ${Object.keys(manifest.textures).length} texture sets at ${TEXTURE_SIZE}², ${Object.keys(manifest.skies).length} skies at ${SKY_SIZE.join('x')} + .hdr`)

if (problems.length) {
  console.error(`\nFAILED: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`\nOK: pack ${manifest.pack} (version ${manifest.version}) matches its manifest.`)
