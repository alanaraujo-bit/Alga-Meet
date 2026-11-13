// Curation helper: lists Poly Haven assets matching some words and renders their thumbnails into one labelled
// sheet under .cache/sheets/, so a texture or sky can be judged by eye before it is written into config.mjs.
//
//   node scripts/contact-sheet.mjs textures oak-floors --all wood,floor --none dirty,worn,old
//   node scripts/contact-sheet.mjs hdris dusk --ids rooftop_night,shanghai_bund --pano
//
// --all a,b   every word must appear in the asset's id, name, tags or categories
// --any a,b   at least one word must appear
// --none a,b  no word may appear
// --ids a,b   explicit ids (skips the filters)
// --pano      HDRIs only: use the whole equirectangular preview instead of the square thumbnail
// --flat      textures only: use the real 1k colour map (what will actually tile) instead of the sphere render
// --big       with --pano: one 1024x512 panorama per row (keep it to 3 ids per sheet)
// --page n    with --pano: show the n-th group of 24 (default 1)
// --size n    cell size in pixels for --flat (default 384); 2 columns from 600 up
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { cachePath, mapLimit, polyhavenFile, polyhavenFiles, polyhavenList, polyhavenPreview, polyhavenThumb } from '../lib/cache.mjs'

const [type, sheetName, ...rest] = process.argv.slice(2)
const option = (flag) => (rest.includes(flag) ? (rest[rest.indexOf(flag) + 1] ?? '').split(',').filter(Boolean) : [])
const all = option('--all')
const any = option('--any')
const none = option('--none')
const ids = option('--ids')
const pano = rest.includes('--pano')
const flat = rest.includes('--flat')
const big = rest.includes('--big')
const page = Number(option('--page')[0] ?? 1)
const flatSize = Number(option('--size')[0] ?? 384)

const assets = await polyhavenList(type)
const haystack = (id, asset) => [id, asset.name, ...(asset.tags ?? []), ...(asset.categories ?? [])].join(' ').toLowerCase()
const matched = ids.length
  ? ids.filter((id) => assets[id] || console.warn(`unknown id: ${id}`))
  : Object.keys(assets).filter((id) => {
      const text = haystack(id, assets[id])
      return all.every((word) => text.includes(word)) && (!any.length || any.some((word) => text.includes(word))) && !none.some((word) => text.includes(word))
    })
const picked = pano ? matched.slice((page - 1) * 24, page * 24) : matched

const cellWidth = pano ? (big ? 1024 : 512) : flat ? flatSize : 200
const cellHeight = pano ? (big ? 512 : 256) : flat ? flatSize : 200
const labelHeight = 34
const columns = pano && big ? 1 : flat && flatSize >= 600 ? 2 : pano || flat ? 3 : 6
const escapeXml = (text) => text.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char])

const cells = await mapLimit(picked, 6, async (id) => {
  let source
  if (pano) {
    source = await polyhavenPreview(id, big ? 512 : 256)
  } else if (flat) {
    const files = await polyhavenFiles(id)
    const colorKey = ['Diffuse', 'col1', 'coll1'].find((key) => files[key])
    source = await polyhavenFile(files[colorKey]['1k'].jpg, `polyhaven/textures/${id}/${colorKey}_1k.jpg`)
  } else {
    source = await polyhavenThumb(id)
  }
  const image = await sharp(source).resize(cellWidth, cellHeight, { fit: 'contain', background: '#808080' }).flatten({ background: '#808080' }).png().toBuffer()
  const asset = assets[id]
  const detail = type === 'textures' ? `${(asset.dimensions ?? []).map((mm) => Math.round(mm)).join(' x ')} mm` : (asset.categories ?? []).filter((category) => /night|sunrise|midday|morning|urban|pure/.test(category)).join(' ')
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111"/>` +
      `<text x="4" y="14" font-family="Arial" font-size="12" fill="#fff">${escapeXml(id)}</text>` +
      `<text x="4" y="29" font-family="Arial" font-size="10" fill="#9cf">${escapeXml(detail)}</text></svg>`,
  )
  return { id, image, label }
})

const rows = Math.ceil(cells.length / columns)
const composite = cells.flatMap((cell, index) => {
  const left = (index % columns) * cellWidth
  const top = Math.floor(index / columns) * (cellHeight + labelHeight)
  return [
    { input: cell.image, left, top },
    { input: cell.label, left, top: top + cellHeight },
  ]
})
const outFile = cachePath('sheets', `${sheetName}.png`)
await mkdir(cachePath('sheets'), { recursive: true })
const sheet = await sharp({ create: { width: columns * cellWidth, height: Math.max(1, rows) * (cellHeight + labelHeight), channels: 3, background: '#222' } })
  .composite(composite)
  .png()
  .toBuffer()
await writeFile(outFile, sheet)
console.log(`${picked.length} of ${matched.length} assets -> ${outFile}`)
for (const id of picked) console.log(`  ${id}  [${(assets[id].categories ?? []).join(', ')}]  {${(assets[id].tags ?? []).join(', ')}}`)
