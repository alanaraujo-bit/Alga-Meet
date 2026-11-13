// Step C: Poly Haven HDRIs -> sky/<id>.webp (what is seen through the windows) + sky/<id>.hdr (the light).
import { mkdir, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { OUT_DIR, SKIES, SKY_SIZE } from '../config.mjs'
import { polyhavenFile, polyhavenFiles } from './cache.mjs'
import { encodeWebp } from './gltf.mjs'

async function buildSky(id, { source }) {
  const files = await polyhavenFiles(source)
  const hdrEntry = files.hdri?.['1k']?.hdr
  if (!hdrEntry || !files.tonemapped) throw new Error(`${source}: not a Poly Haven HDRI with a 1k .hdr and a tonemapped preview`)
  // The 1k Radiance file goes out byte for byte; the tonemapped JPG (full resolution, 8k and up) is the backdrop.
  const hdr = await polyhavenFile(hdrEntry, `polyhaven/hdris/${source}/${source}_1k.hdr`)
  const tonemapped = await polyhavenFile(files.tonemapped, `polyhaven/hdris/${source}/${source}_tonemapped.jpg`)
  const image = await encodeWebp(tonemapped, { kind: 'sky', size: SKY_SIZE })

  await mkdir(joinPath(OUT_DIR, 'sky'), { recursive: true })
  const record = { image: `sky/${id}.webp`, hdr: `sky/${id}.hdr` }
  await Promise.all([writeFile(joinPath(OUT_DIR, record.image), image), writeFile(joinPath(OUT_DIR, record.hdr), hdr)])
  console.log(`  sky/${id}  <- ${source}  webp ${(image.length / 1024).toFixed(0)} KiB  hdr ${(hdr.length / 1024).toFixed(0)} KiB`)
  return { ...record, source: `polyhaven:${source}` }
}

export async function buildSkies() {
  const skies = {}
  // One at a time: each tonemapped source decodes to several hundred megabytes of pixels.
  for (const [id, sky] of Object.entries(SKIES)) skies[id] = await buildSky(id, sky)
  return skies
}
