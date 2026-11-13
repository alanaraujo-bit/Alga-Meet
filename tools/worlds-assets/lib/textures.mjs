// Step B: Poly Haven tiling textures -> textures/<set>/{color,normal,arm}.webp (1024², seamless as shipped).
import { mkdir, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import sharp from 'sharp'
import { OUT_DIR, TEXTURE_SIZE, TEXTURES, WEBP_QUALITY } from '../config.mjs'
import { mapLimit, polyhavenFile, polyhavenFiles, polyhavenList } from './cache.mjs'
import { encodeWebp } from './gltf.mjs'

const SQUARE = [TEXTURE_SIZE, TEXTURE_SIZE]

/** Poly Haven names the colour map `Diffuse`; a few multi-variant sets call it `col1` / `coll1` instead. */
const COLOR_KEYS = ['Diffuse', 'col1', 'coll1']

function mapEntry(files, key, id) {
  const entry = files[key]?.['1k']?.jpg ?? files[key]?.['1k']?.png
  if (!entry) throw new Error(`${id}: no 1k "${key}" map`)
  return entry
}

async function downloadMap(files, key, id) {
  const entry = mapEntry(files, key, id)
  return polyhavenFile(entry, `polyhaven/textures/${id}/${key}_1k.${entry.url.endsWith('.png') ? 'png' : 'jpg'}`)
}

const srgbToLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (value) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)

/**
 * Rewrites a colour map as its luminance, optionally lifted so the mean sits at `level` (0..1, sRGB). The lift is
 * a single multiplication in linear light, so the weave or nap keeps its relative contrast; it is capped where
 * the brightest half percent of pixels would clip.
 */
async function neutralColor(input, { level }) {
  const { data, info } = await sharp(input, { ignoreIcc: true }).removeAlpha().resize(SQUARE[0], SQUARE[1], { fit: 'fill' }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const pixels = info.width * info.height
  const luminance = new Float32Array(pixels)
  let sum = 0
  for (let i = 0; i < pixels; i++) {
    const offset = i * info.channels
    const value = 0.2126 * srgbToLinear(data[offset] / 255) + 0.7152 * srgbToLinear(data[offset + 1] / 255) + 0.0722 * srgbToLinear(data[offset + 2] / 255)
    luminance[i] = value
    sum += value
  }
  let gain = 1
  if (level !== undefined) {
    const brightest = Float32Array.from(luminance).sort()[Math.floor(pixels * 0.995)]
    gain = Math.min(srgbToLinear(level) / (sum / pixels), 1 / brightest)
  }
  const grey = Buffer.alloc(pixels * 3)
  for (let i = 0; i < pixels; i++) grey.fill(Math.round(linearToSrgb(Math.min(1, luminance[i] * gain)) * 255), i * 3, i * 3 + 3)
  return sharp(grey, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: WEBP_QUALITY.color, effort: 6, smartSubsample: true }).toBuffer()
}

/** AO (R) / roughness (G) / metalness (B), built from separate maps when a set ships no packed `arm`. */
async function packArm(files, id) {
  const channel = async (key, fallback) => {
    if (!files[key]) return sharp({ create: { width: SQUARE[0], height: SQUARE[1], channels: 3, background: { r: fallback, g: fallback, b: fallback } } }).extractChannel(0).raw().toBuffer()
    return sharp(await downloadMap(files, key, id), { ignoreIcc: true }).resize(SQUARE[0], SQUARE[1], { fit: 'fill' }).extractChannel(0).raw().toBuffer()
  }
  if (!files.Rough) throw new Error(`${id}: neither an "arm" nor a "Rough" map`)
  const [ao, rough, metal] = await Promise.all([channel('AO', 255), channel('Rough', 255), channel('Metal', 0)])
  const packed = Buffer.alloc(SQUARE[0] * SQUARE[1] * 3)
  for (let i = 0; i < ao.length; i++) {
    packed[i * 3] = ao[i]
    packed[i * 3 + 1] = rough[i]
    packed[i * 3 + 2] = metal[i]
  }
  return sharp(packed, { raw: { width: SQUARE[0], height: SQUARE[1], channels: 3 } }).png().toBuffer()
}

async function buildSet(name, { source, neutral }) {
  const [files, list] = await Promise.all([polyhavenFiles(source), polyhavenList('textures')])
  const asset = list[source]
  if (!asset) throw new Error(`${source}: not a Poly Haven texture`)
  const colorKey = COLOR_KEYS.find((key) => files[key])
  if (!colorKey) throw new Error(`${source}: no colour map`)

  const colorSource = await downloadMap(files, colorKey, source)
  const color = neutral ? await neutralColor(colorSource, neutral) : await encodeWebp(colorSource, { kind: 'color', size: SQUARE })
  const normal = await encodeWebp(await downloadMap(files, 'nor_gl', source), { kind: 'data', size: SQUARE })
  const arm = await encodeWebp(files.arm ? await downloadMap(files, 'arm', source) : await packArm(files, source), { kind: 'data', size: SQUARE })

  const dir = `textures/${name}`
  await mkdir(joinPath(OUT_DIR, dir), { recursive: true })
  const record = { color: `${dir}/color.webp`, normal: `${dir}/normal.webp`, arm: `${dir}/arm.webp` }
  await Promise.all([writeFile(joinPath(OUT_DIR, record.color), color), writeFile(joinPath(OUT_DIR, record.normal), normal), writeFile(joinPath(OUT_DIR, record.arm), arm)])

  // `dimensions` is the real-world size of one tile in millimetres; scans are square to within a few percent.
  const sides = asset.dimensions.filter((millimetres) => millimetres > 0)
  if (!sides.length) throw new Error(`${source}: no real-world dimensions`)
  const tileMeters = Number((sides.reduce((sum, millimetres) => sum + millimetres, 0) / sides.length / 1000).toFixed(3))
  console.log(`  ${dir}  <- ${source}  tile ${tileMeters} m${neutral ? '  (neutralised colour)' : ''}  ${((color.length + normal.length + arm.length) / 1024).toFixed(0)} KiB`)
  return { ...record, tileMeters, source: `polyhaven:${source}` }
}

export async function buildTextures() {
  const names = Object.keys(TEXTURES)
  const records = await mapLimit(names, 4, (name) => buildSet(name, TEXTURES[name]))
  return Object.fromEntries(names.map((name, index) => [name, records[index]]))
}
