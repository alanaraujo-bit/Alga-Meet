// Step D: Quaternius mannequins and clips on one skeleton (the UE-style rig of Universal Animation Library 2).
import { mkdir, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { Document, PropertyType } from '@gltf-transform/core'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, getBounds, meshopt, prune, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { CLIPS, OUT_DIR, QUATERNIUS, TRANSLATED_BONES } from '../config.mjs'
import { cached } from './cache.mjs'
import { primitiveArea, removeAnimations } from './gltf.mjs'
import { clipDuration, worldPositions } from './pose.mjs'
import { readZipEntry } from './zip.mjs'

// ---- Bone names: Rigify deform bones (library 1) -> UE-style (library 2) --------------------------------------

const CORE_BONES = { root: 'root', 'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03', 'DEF-neck': 'neck_01', 'DEF-head': 'Head' }
const LIMB_BONES = { shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball' }
const FINGER_BONES = { f_index: 'index', f_middle: 'middle', f_ring: 'ring', f_pinky: 'pinky', thumb: 'thumb' }

/** `DEF-upper_arm.L` -> `upperarm_l`, `DEF-f_index.02.R` -> `index_02_r`; undefined for anything else. */
export function unifiedBoneName(name) {
  if (CORE_BONES[name]) return CORE_BONES[name]
  const limb = /^DEF-([a-z_]+)\.([LR])$/.exec(name)
  if (limb && LIMB_BONES[limb[1]]) return `${LIMB_BONES[limb[1]]}_${limb[2].toLowerCase()}`
  const finger = /^DEF-([a-z_]+)\.(0[1-3])\.([LR])$/.exec(name)
  if (finger && FINGER_BONES[finger[1]]) return `${FINGER_BONES[finger[1]]}_${finger[2]}_${finger[3].toLowerCase()}`
  return undefined
}

/** Written into each file's glTF `asset.copyright`, so the origin travels with the bytes. */
const COPYRIGHT = 'CC0 1.0. Quaternius, Universal Animation Library 1 and 2'

const REST_TOLERANCE = 1e-3
const maxDifference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])))
/** q and -q are the same rotation. */
const rotationDifference = (a, b) => Math.min(maxDifference(a, b), maxDifference(a, b.map((value) => -value)))

function skeletonOf(document) {
  const [skin] = document.getRoot().listSkins()
  return new Map(skin.listJoints().map((joint) => [joint.getName(), joint]))
}

/**
 * Proves the name map instead of trusting it: every library 1 joint must land on a library 2 joint whose parent
 * is the mapped parent and whose rest translation, rotation and scale agree within 1e-3.
 */
function verifyBoneMap(library1, library2) {
  const source = skeletonOf(library1)
  const target = skeletonOf(library2)
  let worst = 0
  for (const [name, joint] of source) {
    const mapped = unifiedBoneName(name)
    const match = mapped && target.get(mapped)
    if (!match) throw new Error(`no unified bone for ${name}`)
    const parent = joint.getParentNode()
    const matchParent = match.getParentNode()
    if (source.has(parent?.getName()) && unifiedBoneName(parent.getName()) !== matchParent?.getName()) throw new Error(`${name} -> ${mapped}: parents differ`)
    const difference = Math.max(maxDifference(joint.getTranslation(), match.getTranslation()), rotationDifference(joint.getRotation(), match.getRotation()), maxDifference(joint.getScale(), match.getScale()))
    if (difference > REST_TOLERANCE) throw new Error(`${name} -> ${mapped}: rest pose differs by ${difference}`)
    worst = Math.max(worst, difference)
  }
  return { mapped: source.size, unified: target.size, restDifference: worst }
}

// ---- Sources --------------------------------------------------------------------------------------------------

async function loadSources(io) {
  const packs = {}
  for (const [key, pack] of Object.entries(QUATERNIUS)) {
    const zip = await cached(pack.zip, `quaternius/${key}.zip`, { expectedSha256: pack.sha256 })
    packs[key] = { license: readZipEntry(zip, pack.license).toString('utf8'), documents: {} }
    for (const [name, entry] of Object.entries(pack.files)) packs[key].documents[name] = await io.readBinary(new Uint8Array(readZipEntry(zip, entry)))
  }
  return packs
}

// ---- Bodies ---------------------------------------------------------------------------------------------------

const BODY_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'])

function assertSameSkeleton(document, reference, label) {
  const joints = skeletonOf(document)
  if (joints.size !== reference.size) throw new Error(`${label}: ${joints.size} joints, expected ${reference.size}`)
  for (const [name, joint] of joints) {
    const match = reference.get(name)
    if (!match) throw new Error(`${label}: joint ${name} is not part of the unified skeleton`)
    if (joint.getParentNode()?.getName() !== match.getParentNode()?.getName()) throw new Error(`${label}: joint ${name} hangs off a different parent`)
  }
}

/** Mesh + skin + skeleton, no clips, materials named by role. */
async function buildBody(io, document, file, reference) {
  const root = document.getRoot()
  root.getAsset().copyright = COPYRIGHT
  removeAnimations(document)
  assertSameSkeleton(document, reference, file)

  const [mesh] = root.listMeshes()
  const meshNode = root.listNodes().find((node) => node.getMesh() === mesh)
  meshNode.setName('Mannequin')
  mesh.setName('MannequinMesh')

  // Role, not source name or colour: `body` is the material that covers the most surface.
  const coverage = new Map()
  for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics()) if (!BODY_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null)
    const material = primitive.getMaterial()
    const entry = coverage.get(material) ?? { area: 0, triangles: 0, was: material.getName() }
    entry.area += primitiveArea(primitive)
    entry.triangles += primitive.getIndices().getCount() / 3
    coverage.set(material, entry)
  }
  if (coverage.size !== 2) throw new Error(`${file}: expected 2 materials, found ${coverage.size}`)
  const [[bodyMaterial, bodyRole], [jointsMaterial, jointsRole]] = [...coverage].sort((a, b) => b[1].area - a[1].area)
  bodyMaterial.setName('body')
  jointsMaterial.setName('joints')

  const { min, max } = getBounds(root.listScenes()[0])
  await document.transform(dedup(), weld(), prune({ keepAttributes: true, keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 12 }))

  const glb = await io.writeBinary(document)
  await writeFile(joinPath(OUT_DIR, file), glb)
  const describe = (role) => `${role.was} ${role.area.toFixed(2)} m², ${role.triangles} tris`
  console.log(`  ${file}  ${(glb.byteLength / 1024).toFixed(0)} KiB  height ${(max[1] - min[1]).toFixed(3)} m  body = ${describe(bodyRole)}; joints = ${describe(jointsRole)}`)
  return { file, height: max[1] - min[1], minY: min[1], body: bodyRole, joints: jointsRole }
}

// ---- Clips ----------------------------------------------------------------------------------------------------

function copySkeleton(source, document, scene) {
  const rootBone = skeletonOf(source).get('root')
  const armature = rootBone.getParentNode() ?? rootBone
  const copy = (node) => {
    const clone = document.createNode(node.getName()).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale())
    // The skinned mesh node is the one child that is not part of the skeleton.
    for (const child of node.listChildren()) if (!child.getMesh()) clone.addChild(copy(child))
    return clone
  }
  scene.addChild(copy(armature))
  return new Map(document.getRoot().listNodes().map((node) => [node.getName(), node]))
}

/**
 * One clip on the unified skeleton. Scale tracks go, translation tracks stay only on root and pelvis, and the
 * keys are copied one for one: same times, same count, never resampled. Rotations are stored as normalized
 * 16-bit quaternions (plain glTF, no extension), translations stay float.
 */
function convertClip(document, buffer, bones, id, source, sourceName, rename) {
  const original = source.getRoot().listAnimations().find((animation) => animation.getName() === sourceName)
  if (!original) throw new Error(`clip ${sourceName} not found`)
  const animation = document.createAnimation(id)
  const times = new Map()
  const dropped = { scale: 0, translation: 0, unknownBone: 0 }
  for (const channel of original.listChannels()) {
    const path = channel.getTargetPath()
    const bone = bones.get(rename(channel.getTargetNode().getName()))
    if (!bone) dropped.unknownBone++
    else if (path === 'scale') dropped.scale++
    else if (path === 'translation' && !TRANSLATED_BONES.includes(bone.getName())) dropped.translation++
    if (!bone || path === 'scale' || (path === 'translation' && !TRANSLATED_BONES.includes(bone.getName()))) continue
    if (path !== 'translation' && path !== 'rotation') throw new Error(`${sourceName}: unexpected ${path} track`)

    const sampler = channel.getSampler()
    const input = sampler.getInput()
    const output = sampler.getOutput()
    // Channels of a clip share their key times; keep one accessor per distinct time line.
    const timeKey = Buffer.from(input.getArray().buffer, input.getArray().byteOffset, input.getArray().byteLength).toString('base64')
    if (!times.has(timeKey)) times.set(timeKey, document.createAccessor().setType('SCALAR').setArray(Float32Array.from(input.getArray())).setBuffer(buffer))

    const values = document.createAccessor().setBuffer(buffer)
    if (path === 'rotation') {
      const quantized = new Int16Array(output.getCount() * 4)
      const element = [0, 0, 0, 1]
      for (let i = 0; i < output.getCount(); i++) {
        output.getElement(i, element)
        const length = Math.hypot(...element)
        for (let k = 0; k < 4; k++) quantized[i * 4 + k] = Math.round((element[k] / length) * 32767)
      }
      values.setType('VEC4').setArray(quantized).setNormalized(true)
    } else {
      values.setType('VEC3').setArray(Float32Array.from(output.getArray()))
    }
    const converted = document.createAnimationSampler().setInput(times.get(timeKey)).setOutput(values).setInterpolation(sampler.getInterpolation())
    animation.addSampler(converted).addChannel(document.createAnimationChannel().setTargetNode(bone).setTargetPath(path).setSampler(converted))
  }
  return { animation, original, dropped }
}

/** Bones compared between each original clip and its converted version, in unified names. */
const PROBES = ['hand_l', 'foot_l', 'Head']

async function buildAnimations(io, packs, reference) {
  const document = new Document()
  const buffer = document.createBuffer()
  const scene = document.createScene('animations')
  document.getRoot().setDefaultScene(scene)
  document.getRoot().getAsset().copyright = COPYRIGHT
  const bones = copySkeleton(packs.ual2.documents.library, document, scene)
  for (const name of reference.keys()) if (!bones.has(name)) throw new Error(`skeleton copy lost ${name}`)

  const renames = { ual1: unifiedBoneName, ual2: (name) => name }
  const clips = {}
  const originals = []
  for (const [id, [pack, sourceName]] of Object.entries(CLIPS)) {
    const source = packs[pack].documents.library
    const { animation, original, dropped } = convertClip(document, buffer, bones, id, source, sourceName, renames[pack])
    const duration = clipDuration(animation)
    clips[id] = { duration: Number(duration.toFixed(4)), loop: sourceName.endsWith('_Loop') }
    originals.push({ id, pack, source, original, duration, dropped, channels: animation.listChannels().length })
  }

  // Lossless meshopt over the buffers above (no filters): the only loss is the 16-bit rotation step already taken.
  await document.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR] }))
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const glb = await io.writeBinary(document)
  const file = 'avatar/animations.glb'
  await writeFile(joinPath(OUT_DIR, file), glb)

  // Numeric proof, read back from the bytes just written: the probes must sit where the original clip puts them.
  const written = await io.readBinary(glb)
  const inverse = Object.fromEntries([...skeletonOf(packs.ual1.documents.library).keys()].map((name) => [unifiedBoneName(name), name]))
  let maxError = 0
  let worst = ''
  const perPack = { ual1: 0, ual2: 0 }
  for (const { id, pack, source, original, duration } of originals) {
    const converted = written.getRoot().listAnimations().find((animation) => animation.getName() === id)
    const sourceNames = pack === 'ual1' ? PROBES.map((name) => inverse[name]) : PROBES
    for (const time of [0, duration / 2]) {
      const expected = worldPositions(source, original, time, sourceNames)
      const actual = worldPositions(written, converted, time, PROBES)
      PROBES.forEach((probe, index) => {
        const error = Math.hypot(...expected[sourceNames[index]].map((value, axis) => value - actual[probe][axis]))
        perPack[pack] = Math.max(perPack[pack], error)
        if (error > maxError) {
          maxError = error
          worst = `${id} ${probe} t=${time.toFixed(3)}`
        }
      })
    }
  }
  console.log(`  ${file}  ${(glb.byteLength / 1024).toFixed(0)} KiB  ${originals.length} clips  retarget max error ${(maxError * 1000).toFixed(4)} mm (${worst})`)
  if (maxError > 1e-3) throw new Error(`retargeted clips drift ${(maxError * 1000).toFixed(3)} mm from the originals (${worst})`)

  return { file, clips, verification: { maxErrorMm: maxError * 1000, worst, ual1MaxErrorMm: perPack.ual1 * 1000, ual2MaxErrorMm: perPack.ual2 * 1000, probes: PROBES }, details: originals.map(({ id, dropped, channels }) => ({ id, channels, dropped })) }
}

// ---- Entry point ----------------------------------------------------------------------------------------------

export async function buildAvatar(io) {
  await mkdir(joinPath(OUT_DIR, 'avatar'), { recursive: true })
  const packs = await loadSources(io)
  const boneMap = verifyBoneMap(packs.ual1.documents.library, packs.ual2.documents.library)
  console.log(`  bone map: ${boneMap.mapped} Rigify joints -> ${boneMap.unified}-joint unified skeleton, rest pose difference <= ${boneMap.restDifference.toExponential(1)}`)

  const reference = skeletonOf(packs.ual2.documents.library)
  // Facing and proportions, measured on the rest pose before anything is rewritten.
  const rest = worldPositions(packs.ual2.documents.library, null, 0, ['pelvis', 'foot_l', 'ball_l', 'hand_l', 'hand_r'])
  const restFemale = worldPositions(packs.ual2.documents.female, null, 0, ['pelvis'])
  const facing = { axis: rest.ball_l[2] > rest.foot_l[2] ? '+Z' : '-Z', leftHandX: rest.hand_l[0], pelvisHeight: { a: rest.pelvis[1], b: restFemale.pelvis[1] } }

  // Clips first: they read the library 2 document, which buildBody() then strips and rewrites.
  const animations = await buildAnimations(io, packs, reference)
  const a = await buildBody(io, packs.ual2.documents.library, 'avatar/mannequin_a.glb', reference)
  const b = await buildBody(io, packs.ual2.documents.female, 'avatar/mannequin_b.glb', reference)

  return {
    avatar: { bodies: { a: a.file, b: b.file }, animations: animations.file, clips: animations.clips },
    licenses: Object.fromEntries(Object.entries(packs).map(([key, pack]) => [key, pack.license])),
    report: { boneMap, facing, bodies: { a, b }, verification: animations.verification, clips: animations.details },
  }
}
