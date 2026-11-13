// Step E: CREDITS.md and manifest.json. The manifest lists every file of the pack with its SHA-256, so a client
// can verify a download and the server can serve the files as immutable.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { OUT_DIR, PACK_VERSION, QUATERNIUS } from '../config.mjs'
import { polyhavenList, sha256 } from './cache.mjs'

const polyhavenId = (source) => source.replace(/^polyhaven:/, '')

/** Every file under the pack folder, as forward-slash relative paths, sorted. */
export async function listPackFiles() {
  const entries = await readdir(OUT_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => joinPath(entry.parentPath, entry.name).slice(OUT_DIR.length + 1).replaceAll('\\', '/'))
    .sort()
}

async function credits({ models, textures, skies, licenses }) {
  const lists = { model: await polyhavenList('models'), texture: await polyhavenList('textures'), sky: await polyhavenList('hdris') }
  const rows = []
  const add = (kind, usedAs, source) => {
    const id = polyhavenId(source)
    const asset = lists[kind][id]
    rows.push(`| ${asset.name} | ${kind} | \`${usedAs}\` | ${Object.keys(asset.authors).join(', ')} | CC0 1.0 | https://polyhaven.com/a/${id} |`)
  }
  for (const model of Object.values(models)) add('model', model.file, model.source)
  for (const [name, set] of Object.entries(textures)) add('texture', `textures/${name}/`, set.source)
  for (const [id, sky] of Object.entries(skies)) add('sky', `sky/${id}.*`, sky.source)

  const quaternius = Object.entries(QUATERNIUS).flatMap(([key, pack]) => [
    `### ${pack.title}`,
    '',
    `Quaternius, CC0 1.0. ${pack.page} (archive: ${pack.zip})`,
    '',
    'License.txt as shipped in the archive:',
    '',
    '```text',
    licenses[key].replaceAll('\r\n', '\n').trim(),
    '```',
    '',
  ])

  return [
    '# Alga Worlds asset pack: credits',
    '',
    'Everything in this folder is derived from works their authors dedicated to the public domain under',
    '[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required; this file',
    'exists because the people who made these deserve to be named. The files were converted (WebP textures, meshopt',
    'geometry, recentred models, a unified skeleton) by `tools/worlds-assets`; see its README for the exact steps.',
    '',
    '## Poly Haven',
    '',
    'https://polyhaven.com, licence: https://polyhaven.com/license (CC0 1.0).',
    '',
    '| Asset | Type | Used as | Author(s) | Licence | Source |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Quaternius',
    '',
    '`avatar/mannequin_a.glb` is the mannequin of Universal Animation Library 2, `avatar/mannequin_b.glb` its female',
    'mannequin, and `avatar/animations.glb` holds clips from both libraries on the skeleton of library 2.',
    '',
    ...quaternius,
  ].join('\n')
}

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Writes CREDITS.md and manifest.json from the step reports; returns the manifest. */
export async function writeManifest({ models, textures, skies, avatar, licenses }) {
  await writeFile(joinPath(OUT_DIR, 'CREDITS.md'), await credits({ models, textures, skies, licenses }))

  // Anything on disk that no record points at would be shipped unverified and uncredited: refuse it.
  const expected = new Set(['CREDITS.md', avatar.animations, ...Object.values(avatar.bodies)])
  for (const model of Object.values(models)) expected.add(model.file)
  for (const set of Object.values(textures)) for (const key of ['color', 'normal', 'arm']) expected.add(set[key])
  for (const sky of Object.values(skies)) for (const key of ['image', 'hdr']) expected.add(sky[key])
  const onDisk = (await listPackFiles()).filter((file) => file !== 'manifest.json')
  const stray = onDisk.filter((file) => !expected.has(file))
  const missing = [...expected].filter((file) => !onDisk.includes(file))
  if (stray.length || missing.length) throw new Error(`pack folder out of sync: stray [${stray.join(', ')}] missing [${missing.join(', ')}]`)

  const files = {}
  for (const file of onDisk) {
    const bytes = await readFile(joinPath(OUT_DIR, file))
    files[file] = { sha256: sha256(bytes), bytes: bytes.length }
  }
  const manifest = { version: PACK_VERSION, pack: process.env.WORLDS_PACK_DATE ?? localDate(), files, models, textures, skies, avatar }
  await writeFile(joinPath(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}
