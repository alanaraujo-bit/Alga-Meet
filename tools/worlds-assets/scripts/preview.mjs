// Visual smoke test: draws every model of the built pack, and both mannequins posed by a few clips, into contact
// sheets under .cache/sheets/. It is a tiny CPU rasteriser (orthographic, base colour x simple shading), reading
// the final GLBs the way a client would: meshopt-decoded, de-quantized through the node transform, WebP textures,
// skinning through the inverse bind matrices. It checks shape, placement, UVs and clip binding, not PBR looks.
//
//   node scripts/preview.mjs            -> .cache/sheets/preview-models-N.png, preview-avatar.png
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { OUT_DIR } from '../config.mjs'
import { cachePath } from '../lib/cache.mjs'
import { createIO } from '../lib/gltf.mjs'
import { clipDuration, multiply, worldMatrices } from '../lib/pose.mjs'

const CELL = 256
const YAW = (-32 * Math.PI) / 180
const PITCH = (18 * Math.PI) / 180
const LIGHT = [-0.35, 0.6, 0.72]

const transformPoint = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]

/** Model space -> view space: turn about Y, then tilt towards the viewer, who looks down -Z. */
function toView([x, y, z]) {
  const x1 = x * Math.cos(YAW) + z * Math.sin(YAW)
  const z1 = -x * Math.sin(YAW) + z * Math.cos(YAW)
  return [x1, y * Math.cos(PITCH) - z1 * Math.sin(PITCH), y * Math.sin(PITCH) + z1 * Math.cos(PITCH)]
}

const textures = new Map()
async function decodeTexture(texture) {
  if (!texture) return null
  if (!textures.has(texture)) {
    const { data, info } = await sharp(Buffer.from(texture.getImage())).raw().toBuffer({ resolveWithObject: true })
    textures.set(texture, { data, width: info.width, height: info.height, channels: info.channels })
  }
  return textures.get(texture)
}

/** Flattens a document into world-space triangles. `matrices` poses the nodes (rest pose when omitted). */
async function collect(document, matrices = worldMatrices(document, null, 0)) {
  const items = []
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const skin = node.getSkin()
    const jointMatrices = skin && skin.listJoints().map((joint, index) => multiply(matrices.get(joint), skin.getInverseBindMatrices().getElement(index, [])))
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()
      if (material.getAlphaMode() === 'BLEND') continue // glass: would only hide what sits behind it
      const position = primitive.getAttribute('POSITION')
      const uv = primitive.getAttribute('TEXCOORD_0')
      const joints = primitive.getAttribute('JOINTS_0')
      const weights = primitive.getAttribute('WEIGHTS_0')
      const count = position.getCount()
      const points = new Array(count)
      const coords = new Array(count)
      for (let i = 0; i < count; i++) {
        const local = position.getElement(i, [])
        if (jointMatrices) {
          const bone = joints.getElement(i, [])
          const weight = weights.getElement(i, [])
          const total = weight[0] + weight[1] + weight[2] + weight[3]
          const skinned = [0, 0, 0]
          for (let k = 0; k < 4; k++) {
            if (!weight[k]) continue
            const moved = transformPoint(jointMatrices[bone[k]], local)
            for (let axis = 0; axis < 3; axis++) skinned[axis] += (moved[axis] * weight[k]) / total
          }
          points[i] = skinned
        } else {
          points[i] = transformPoint(matrices.get(node), local)
        }
        coords[i] = uv ? uv.getElement(i, []) : [0, 0]
      }
      items.push({ points, coords, indices: primitive.getIndices().getArray(), texture: await decodeTexture(material.getBaseColorTexture()), factor: material.getBaseColorFactor(), cutout: material.getAlphaMode() === 'MASK' ? material.getAlphaCutoff() : -1 })
    }
  }
  return items
}

/** Rasterises the triangles into a CELL x CELL RGB buffer, fitted to the cell. */
function draw(items) {
  const min = [Infinity, Infinity]
  const max = [-Infinity, -Infinity]
  for (const item of items) {
    item.view = item.points.map(toView)
    for (const [x, y] of item.view) {
      min[0] = Math.min(min[0], x)
      min[1] = Math.min(min[1], y)
      max[0] = Math.max(max[0], x)
      max[1] = Math.max(max[1], y)
    }
  }
  const scale = (CELL - 16) / Math.max(max[0] - min[0], max[1] - min[1])
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]
  const pixels = Buffer.alloc(CELL * CELL * 3, 0x30)
  const depth = new Float32Array(CELL * CELL).fill(-Infinity)
  for (const { view, coords, indices, texture, factor, cutout } of items) {
    for (let t = 0; t < indices.length; t += 3) {
      const corners = [indices[t], indices[t + 1], indices[t + 2]]
      const [a, b, c] = corners.map((index) => [(view[index][0] - centre[0]) * scale + CELL / 2, CELL / 2 - (view[index][1] - centre[1]) * scale, view[index][2]])
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
      if (Math.abs(area) < 1e-9) continue
      const [va, vb, vc] = corners.map((index) => view[index])
      const normal = [(vb[1] - va[1]) * (vc[2] - va[2]) - (vb[2] - va[2]) * (vc[1] - va[1]), (vb[2] - va[2]) * (vc[0] - va[0]) - (vb[0] - va[0]) * (vc[2] - va[2]), (vb[0] - va[0]) * (vc[1] - va[1]) - (vb[1] - va[1]) * (vc[0] - va[0])]
      const length = Math.hypot(...normal) || 1
      const shade = 0.35 + 0.65 * Math.abs((normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]) / length)
      const [uvA, uvB, uvC] = corners.map((index) => coords[index])
      for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.min(CELL - 1, Math.ceil(Math.max(a[1], b[1], c[1]))); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(CELL - 1, Math.ceil(Math.max(a[0], b[0], c[0]))); x++) {
          const w0 = ((b[0] - x - 0.5) * (c[1] - y - 0.5) - (c[0] - x - 0.5) * (b[1] - y - 0.5)) / area
          const w1 = ((c[0] - x - 0.5) * (a[1] - y - 0.5) - (a[0] - x - 0.5) * (c[1] - y - 0.5)) / area
          const w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = a[2] * w0 + b[2] * w1 + c[2] * w2
          if (z <= depth[y * CELL + x]) continue
          let colour = [255, 255, 255, 255]
          if (texture) {
            const u = uvA[0] * w0 + uvB[0] * w1 + uvC[0] * w2
            const v = uvA[1] * w0 + uvB[1] * w1 + uvC[1] * w2
            const tx = Math.min(texture.width - 1, Math.floor((u - Math.floor(u)) * texture.width))
            const ty = Math.min(texture.height - 1, Math.floor((v - Math.floor(v)) * texture.height))
            const offset = (ty * texture.width + tx) * texture.channels
            colour = [texture.data[offset], texture.data[offset + 1], texture.data[offset + 2], texture.channels === 4 ? texture.data[offset + 3] : 255]
          }
          if (cutout >= 0 && (colour[3] / 255) * factor[3] < cutout) continue
          depth[y * CELL + x] = z
          for (let channel = 0; channel < 3; channel++) pixels[(y * CELL + x) * 3 + channel] = Math.min(255, colour[channel] * factor[channel] ** (1 / 2.2) * shade)
        }
      }
    }
  }
  return pixels
}

async function sheet(name, cells, columns) {
  const label = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="18"><rect width="100%" height="100%" fill="#000"/><text x="4" y="13" font-family="Arial" font-size="12" fill="#fff">${text}</text></svg>`)
  const composite = []
  for (const [index, cell] of cells.entries()) {
    const left = (index % columns) * CELL
    const top = Math.floor(index / columns) * (CELL + 18)
    composite.push({ input: cell.pixels, raw: { width: CELL, height: CELL, channels: 3 }, left, top }, { input: label(cell.label), left, top: top + CELL })
  }
  const file = cachePath('sheets', `${name}.png`)
  await mkdir(cachePath('sheets'), { recursive: true })
  await sharp({ create: { width: columns * CELL, height: Math.ceil(cells.length / columns) * (CELL + 18), channels: 3, background: '#111' } })
    .composite(composite)
    .png()
    .toFile(file)
  console.log(file)
}

const io = await createIO()
const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'))

const modelCells = []
for (const [id, model] of Object.entries(manifest.models)) {
  const document = await io.read(join(OUT_DIR, model.file))
  modelCells.push({ label: `${id}  ${model.size.join(' x ')}`, pixels: draw(await collect(document)) })
}
for (let page = 0; page * 20 < modelCells.length; page++) await sheet(`preview-models-${page + 1}`, modelCells.slice(page * 20, page * 20 + 20), 5)

// Bodies posed by clips from animations.glb, bound by bone name exactly as an AnimationMixer would bind them.
const animations = await io.read(join(OUT_DIR, manifest.avatar.animations))
const avatarCells = []
for (const [key, file] of Object.entries(manifest.avatar.bodies)) {
  const body = await io.read(join(OUT_DIR, file))
  const bones = new Map(body.getRoot().listNodes().map((node) => [node.getName(), node]))
  avatarCells.push({ label: `${key}: rest pose`, pixels: draw(await collect(body)) })
  for (const clip of ['walk', 'sit_idle', 'idle_fold', 'drink']) {
    const animation = animations.getRoot().listAnimations().find((candidate) => candidate.getName() === clip)
    const time = clipDuration(animation) / 2
    const undo = []
    for (const channel of animation.listChannels()) {
      const bone = bones.get(channel.getTargetNode().getName())
      const input = channel.getSampler().getInput()
      let index = 0
      while (index + 1 < input.getCount() && input.getScalar(index + 1) <= time) index++
      const value = channel.getSampler().getOutput().getElement(index, [])
      if (channel.getTargetPath() === 'rotation') {
        const rest = bone.getRotation()
        undo.push(() => bone.setRotation(rest))
        const length = Math.hypot(...value)
        bone.setRotation(value.map((component) => component / length))
      } else {
        const rest = bone.getTranslation()
        undo.push(() => bone.setTranslation(rest))
        bone.setTranslation(value)
      }
    }
    avatarCells.push({ label: `${key}: ${clip} @ ${time.toFixed(2)} s`, pixels: draw(await collect(body)) })
    for (const restore of undo) restore()
  }
}
await sheet('preview-avatar', avatarCells, 5)
