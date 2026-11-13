// Shared glTF-Transform plumbing: I/O with every extension registered, WebP texture encoding, mesh statistics.
import { Material, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { listTextureSlots } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { WEBP_QUALITY } from '../config.mjs'

export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
}

/** Texture slots whose pixels are colours (sRGB); every other slot holds data (normals, ORM, masks). */
const COLOR_SLOT = /^(baseColor|emissive|diffuse|sheenColor|specularColor)Texture$/

/**
 * Encodes one image as WebP. `kind` picks the quality; `maxSize` caps the longest side (never enlarges);
 * `size` forces exact dimensions instead. Alpha is dropped unless `keepAlpha`, and when kept it is carried
 * through straight (sharp only premultiplies internally while resampling and undoes it afterwards). Embedded ICC
 * profiles are ignored, as three.js ignores them on upload: the stored pixel values are what the shader samples.
 */
export async function encodeWebp(input, { kind, maxSize, size, keepAlpha = false }) {
  let image = sharp(input, { limitInputPixels: false, ignoreIcc: true })
  if (size) image = image.resize(size[0], size[1], { fit: 'fill' })
  else if (maxSize) image = image.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
  if (!keepAlpha) image = image.removeAlpha()
  return image.webp({ quality: WEBP_QUALITY[kind], alphaQuality: 100, effort: 6, smartSubsample: true }).toBuffer()
}

/** Re-encodes every texture of a document to WebP (EXT_texture_webp, required) at `maxSize` or below. */
export async function convertTexturesToWebp(document, maxSize) {
  const textures = document.getRoot().listTextures()
  for (const texture of textures) {
    const slots = listTextureSlots(texture)
    const isColor = slots.length > 0 && slots.every((slot) => COLOR_SLOT.test(slot))
    // Alpha only matters where a MASK/BLEND material reads it from its base colour; there it must survive intact.
    const keepAlpha = texture.listParents().some((parent) => parent instanceof Material && parent.getBaseColorTexture() === texture && parent.getAlphaMode() !== 'OPAQUE')
    const encoded = await encodeWebp(Buffer.from(texture.getImage()), { kind: isColor ? 'color' : 'data', maxSize, keepAlpha })
    texture.setImage(new Uint8Array(encoded)).setMimeType('image/webp')
    if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.\w+$/, '.webp'))
  }
  if (textures.length) document.createExtension(EXTTextureWebP).setRequired(true)
}

/** Drops every animation together with its channels and samplers, so prune() can reclaim their accessors. */
export function removeAnimations(document) {
  const animations = document.getRoot().listAnimations()
  for (const animation of animations) {
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
  }
  return animations.length
}

export function countTriangles(document) {
  let triangles = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices()
      triangles += (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3
    }
  }
  return Math.round(triangles)
}

/** Sum of triangle areas of one primitive, in the units of its POSITION attribute. */
export function primitiveArea(primitive) {
  const position = primitive.getAttribute('POSITION')
  const indices = primitive.getIndices()
  const count = indices ? indices.getCount() : position.getCount()
  const a = [0, 0, 0]
  const b = [0, 0, 0]
  const c = [0, 0, 0]
  let area = 0
  for (let i = 0; i < count; i += 3) {
    position.getElement(indices ? indices.getScalar(i) : i, a)
    position.getElement(indices ? indices.getScalar(i + 1) : i + 1, b)
    position.getElement(indices ? indices.getScalar(i + 2) : i + 2, c)
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return area
}
