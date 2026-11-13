// Builds the Alga Worlds asset pack into apps/server/assets/worlds/v1.
//
//   node build.mjs                      everything, from a clean output folder
//   node build.mjs --only=models,sky    rebuild some steps, reuse the last report of the others
//
// Steps: models, textures, sky, avatar. The manifest and CREDITS.md are always rewritten at the end.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { BUDGET_BYTES, OUT_DIR } from './config.mjs'
import { buildAvatar } from './lib/avatar.mjs'
import { cachePath } from './lib/cache.mjs'
import { createIO } from './lib/gltf.mjs'
import { writeManifest } from './lib/manifest.mjs'
import { buildModels } from './lib/models.mjs'
import { buildSkies } from './lib/skies.mjs'
import { buildTextures } from './lib/textures.mjs'

const STEPS = {
  models: { folder: 'models', run: (io) => buildModels(io) },
  textures: { folder: 'textures', run: async () => ({ textures: await buildTextures() }) },
  sky: { folder: 'sky', run: async () => ({ skies: await buildSkies() }) },
  avatar: { folder: 'avatar', run: (io) => buildAvatar(io) },
}

const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice(7).split(',')
const selected = only ?? Object.keys(STEPS)
for (const step of selected) if (!STEPS[step]) throw new Error(`unknown step "${step}" (steps: ${Object.keys(STEPS).join(', ')})`)

const reportPath = (step) => cachePath('build', `${step}.json`)
const started = Date.now()
const io = await createIO()
// glTF-Transform narrates every prune and quantize; only its warnings are worth reading here. One of them is
// expected: tiling UVs outside [0,1] cannot be quantized and simply stay float.
const expectedWarning = /TEXCOORD_\d+; out of \[0,1\] range/
io.setLogger({ debug() {}, info() {}, warn: (message) => expectedWarning.test(message) || console.warn(`    warning: ${message}`), error: (message) => console.error(message) })

if (!only) await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
await mkdir(cachePath('build'), { recursive: true })

const reports = {}
for (const [step, { folder, run }] of Object.entries(STEPS)) {
  if (selected.includes(step)) {
    console.log(`\n== ${step}`)
    await rm(joinPath(OUT_DIR, folder), { recursive: true, force: true })
    reports[step] = await run(io)
    await writeFile(reportPath(step), JSON.stringify(reports[step], null, 2))
  } else {
    if (!existsSync(reportPath(step))) throw new Error(`no earlier report for "${step}": run a full build first`)
    reports[step] = JSON.parse(await readFile(reportPath(step), 'utf8'))
  }
}

console.log('\n== manifest')
const manifest = await writeManifest({
  models: reports.models.models,
  textures: reports.textures.textures,
  skies: reports.sky.skies,
  avatar: reports.avatar.avatar,
  licenses: reports.avatar.licenses,
})

const sizes = Object.entries(manifest.files).map(([file, { bytes }]) => [file, bytes])
const total = sizes.reduce((sum, [, bytes]) => sum + bytes, 0) + (await readFile(joinPath(OUT_DIR, 'manifest.json'))).length
const mebibytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`
const folderTotal = (prefix) => sizes.filter(([file]) => file.startsWith(prefix)).reduce((sum, [, bytes]) => sum + bytes, 0)
console.log(`  pack ${manifest.pack}: ${sizes.length + 1} files, ${mebibytes(total)} of ${mebibytes(BUDGET_BYTES)}`)
console.log(`  models ${Object.keys(manifest.models).length} (${mebibytes(folderTotal('models/'))})  texture sets ${Object.keys(manifest.textures).length} (${mebibytes(folderTotal('textures/'))})  skies ${Object.keys(manifest.skies).length} (${mebibytes(folderTotal('sky/'))})  avatar: 2 bodies + ${Object.keys(manifest.avatar.clips).length} clips (${mebibytes(folderTotal('avatar/'))})`)
console.log('  largest files:')
for (const [file, bytes] of sizes.sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${mebibytes(bytes).padStart(9)}  ${file}`)

const { verification } = reports.avatar.report
console.log(`  clip retarget check: max ${verification.maxErrorMm.toFixed(4)} mm on ${verification.probes.join(', ')} (${verification.worst})`)
for (const { id, error } of reports.models.failed) console.warn(`  NOT IN THE PACK: model ${id}: ${error}`)
console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)} s. Next: node validate.mjs`)

if (total > BUDGET_BYTES) {
  console.error(`\nThe pack is over its ${mebibytes(BUDGET_BYTES)} budget.`)
  process.exitCode = 1
}
