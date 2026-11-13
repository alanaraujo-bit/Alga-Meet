// Step A: Poly Haven models -> one self-contained, recentred, WebP + meshopt GLB each.
import { mkdir, writeFile } from 'node:fs/promises'
import { join as joinPath, posix } from 'node:path'
import { dedup, flatten, join, listTextureInfoByMaterial, meshopt, prune, simplify, transformMesh, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { MODEL_OPTIONS, MODELS, OUT_DIR } from '../config.mjs'
import { cachePath, mapLimit, polyhavenFile, polyhavenFiles, polyhavenList } from './cache.mjs'
import { convertTexturesToWebp, countTriangles, removeAnimations } from './gltf.mjs'

/** Vertex attributes a model keeps. Extra UV sets are dropped (no material samples them); anything else is an error. */
const KEPT_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0'])
const UNUSED_ATTRIBUTE = /^TEXCOORD_[1-9]$/

/** Downloads the 1k glTF of a model with its .bin and textures; returns the local path of the .gltf. */
export async function downloadModel(id) {
  const files = await polyhavenFiles(id)
  const entry = files.gltf?.['1k']?.gltf
  if (!entry) throw new Error('Poly Haven publishes no 1k glTF for it')
  const dir = posix.join('polyhaven/models', id)
  const gltfName = posix.basename(new URL(entry.url).pathname)
  await polyhavenFile(entry, posix.join(dir, gltfName))
  // `include` maps paths relative to the .gltf (textures/…, *.bin); cachePath() rejects anything escaping the cache.
  await mapLimit(Object.entries(entry.include ?? {}), 6, ([relPath, include]) => polyhavenFile(include, posix.join(dir, relPath)))
  return cachePath(dir, gltfName)
}

function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const point = [0, 0, 0]
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION')
    for (let i = 0, count = position.getCount(); i < count; i++) {
      position.getElement(i, point)
      for (let axis = 0; axis < 3; axis++) {
        if (point[axis] < min[axis]) min[axis] = point[axis]
        if (point[axis] > max[axis]) max[axis] = point[axis]
      }
    }
  }
  return { min, max }
}

/**
 * Collapses the scene into one node holding one mesh, one primitive per material, with every node transform
 * baked into the vertices. Returns that mesh.
 */
async function bakeIntoSingleMesh(document, name) {
  const root = document.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (root.listSkins().length) throw new Error('skinned models are not supported here')
  // A few models ship node animations (sliding doors); the pack holds static props, posed as authored.
  removeAnimations(document)
  for (const material of root.listMaterials()) {
    if (listTextureInfoByMaterial(material).some((info) => info.getTexCoord() !== 0)) throw new Error(`material "${material.getName()}" samples a UV set other than TEXCOORD_0`)
  }

  await document.transform(dedup(), flatten())
  const baked = document.createMesh(name)
  for (const node of root.listNodes()) {
    const source = node.getMesh()
    if (!source) continue
    // An instanced mesh (several nodes, one mesh) gets one baked copy per placement.
    const mesh = source.listParents().filter((parent) => parent.propertyType === 'Node').length > 1 ? source.clone() : source
    node.setMesh(null)
    transformMesh(mesh, node.getWorldMatrix())
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (KEPT_ATTRIBUTES.has(semantic)) continue
        if (!UNUSED_ATTRIBUTE.test(semantic)) throw new Error(`unexpected vertex attribute ${semantic}`)
        primitive.setAttribute(semantic, null)
      }
      mesh.removePrimitive(primitive)
      baked.addPrimitive(primitive)
    }
  }
  for (const node of scene.listChildren()) scene.removeChild(node)
  scene.setName(name).addChild(document.createNode(name).setMesh(baked))

  // One primitive per material: join() merges compatible primitives of the same mesh.
  await document.transform(join({ keepNamed: false }), weld())
  return baked
}

/**
 * Poly Haven publishes each model's real dimensions (millimetres). A glTF whose bounding box disagrees with them
 * was exported at the wrong unit scale; this returns the uniform factor that brings it back to metres (1 if fine).
 */
function unitScaleFix(mesh, dimensionsMm) {
  const { min, max } = meshBounds(mesh)
  const largest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  const expected = Math.max(...dimensionsMm) / 1000
  return Math.abs(largest / expected - 1) > 0.05 ? expected / largest : 1
}

/** Scales by `scale`, then centres the bounding box on X and Z and rests it on Y = 0. Returns the final size. */
function recentre(mesh, scale) {
  const { min, max } = meshBounds(mesh)
  const offset = [(-(min[0] + max[0]) / 2) * scale, -min[1] * scale, (-(min[2] + max[2]) / 2) * scale]
  // prettier-ignore
  transformMesh(mesh, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, offset[0], offset[1], offset[2], 1])
  return [(max[0] - min[0]) * scale, (max[1] - min[1]) * scale, (max[2] - min[2]) * scale]
}

/** Builds `models/<id>.glb` and returns its manifest record plus a few facts for the build log. */
export async function buildModel(io, id) {
  const outName = id.toLowerCase()
  const document = await io.read(await downloadModel(id))
  const root = document.getRoot()
  const sourceTriangles = countTriangles(document)
  // The origin travels with the bytes: glTF `asset.copyright`.
  root.getAsset().copyright = `CC0 1.0. Poly Haven, https://polyhaven.com/a/${id}`

  const mesh = await bakeIntoSingleMesh(document, outName)

  const hasCutout = root.listMaterials().some((material) => material.getAlphaMode() !== 'OPAQUE')
  let simplified = false
  if (sourceTriangles > MODEL_OPTIONS.simplifyAbove && !hasCutout && !MODEL_OPTIONS.neverSimplify.test(outName)) {
    // The simplifier rounds each primitive's target down to whole triangles; the margin keeps the total at the floor.
    const ratio = MODEL_OPTIONS.simplifyRatio + (mesh.listPrimitives().length + 1) / sourceTriangles
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: MODEL_OPTIONS.simplifyError }))
    simplified = true
  }
  // keepAttributes/keepSolidTextures: the Poly Haven material setup and vertex streams stay exactly as authored.
  await document.transform(prune({ keepAttributes: true, keepSolidTextures: true, keepLeaves: false }))

  const unitScale = unitScaleFix(mesh, (await polyhavenList('models'))[id].dimensions)
  const size = recentre(mesh, unitScale)
  const triangles = countTriangles(document)
  if (triangles < sourceTriangles * MODEL_OPTIONS.simplifyRatio) throw new Error(`simplified below ${MODEL_OPTIONS.simplifyRatio * 100}% (${triangles}/${sourceTriangles})`)

  const textureSize = Math.max(...size) < MODEL_OPTIONS.smallMeters ? MODEL_OPTIONS.smallTextureSize : MODEL_OPTIONS.textureSize
  await convertTexturesToWebp(document, textureSize)

  // reorder + KHR_mesh_quantization + EXT_meshopt_compression. 'medium' keeps normals and tangents as plain
  // quantized attributes (12 bits here) instead of the 8-bit octahedral filter, which bands on glossy surfaces.
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 12, quantizeTexcoord: 12 }))

  const glb = await io.writeBinary(document)
  const file = `models/${outName}.glb`
  await mkdir(joinPath(OUT_DIR, 'models'), { recursive: true })
  await writeFile(joinPath(OUT_DIR, file), glb)

  return {
    id: outName,
    record: { file, size: size.map((meters) => Number(meters.toFixed(3))), tris: triangles, bytes: glb.byteLength, source: `polyhaven:${id}` },
    log: { sourceTriangles, simplified, unitScale, textureSize, materials: root.listMaterials().length, textures: root.listTextures().length, primitives: mesh.listPrimitives().length, cutout: hasCutout },
  }
}

/** Builds every model; a failure is reported and skipped, never substituted. */
export async function buildModels(io, ids = MODELS) {
  const models = {}
  const failed = []
  const logs = {}
  await mapLimit(ids, 3, async (id) => {
    try {
      const { id: outName, record, log } = await buildModel(io, id)
      models[outName] = record
      logs[outName] = log
      console.log(`  ${record.file}  ${record.size.join(' x ')} m  ${record.tris} tris${log.simplified ? ` (from ${log.sourceTriangles})` : ''}  ${(record.bytes / 1024).toFixed(0)} KiB  tex<=${log.textureSize}${log.unitScale !== 1 ? `  RESCALED x${log.unitScale.toFixed(4)}` : ''}`)
    } catch (error) {
      failed.push({ id, error: error.message })
      console.error(`  FAILED ${id}: ${error.message}`)
    }
  })
  // Manifest order follows the curated list, not completion order.
  const ordered = Object.fromEntries(ids.map((id) => id.toLowerCase()).filter((id) => models[id]).map((id) => [id, models[id]]))
  return { models: ordered, failed, logs }
}
