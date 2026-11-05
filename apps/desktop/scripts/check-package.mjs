// Fails `npm run dist` when app.asar is missing a runtime dependency. 0.1.3 and 0.1.4 shipped without
// electron-updater's own dependencies (built in a worktree whose node_modules was a folder of per-package
// junctions), so auto-update died silently on every install. Walks package.json `dependencies` from the app root
// with Node's resolution order (nearest node_modules first). Optional and peer dependencies are not required.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const archive = process.argv[2] ?? join(import.meta.dirname, '../release/win-unpacked/resources/app.asar')

const files = new Set(asar.listPackage(archive).map((p) => p.split(sep).join('/')))
const read = (dir) => JSON.parse(asar.extractFile(archive, `${dir}/package.json`.slice(1).split('/').join(sep)).toString())

const missing = []
const seen = new Set()
function walk(dir) {
  if (seen.has(dir)) return
  seen.add(dir)
  for (const dep of Object.keys(read(dir).dependencies ?? {})) {
    let at = dir
    for (;;) {
      if (files.has(`${at}/node_modules/${dep}/package.json`)) {
        walk(`${at}/node_modules/${dep}`)
        break
      }
      if (!at) {
        missing.push(`${dep} (needed by ${dir || 'the app'})`)
        break
      }
      at = at.slice(0, at.lastIndexOf('/node_modules/'))
    }
  }
}
walk('')

if (missing.length) {
  console.error(`app.asar is missing ${missing.length} runtime dependencies:\n  ${missing.join('\n  ')}`)
  console.error('Build in a checkout whose node_modules is a real install or one junction to it (see docs/STATE.md).')
  process.exit(1)
}
console.log(`app.asar: ${seen.size - 1} runtime packages, all dependencies present`)

// A worker copied with `?url` instead of bundled keeps bare imports (`from 'abslink'`) a browser can't resolve: it never
// starts (the cinema's ASS renderer, JASSUB, shipped like that). Renderer assets may only import relative paths.
const bare = [...files].filter((f) => f.startsWith('/out/renderer/assets/') && f.endsWith('.js')).filter((f) =>
  /^\s*import\s[^;]*?\bfrom\s*['"](?![./])[^'"]+['"]/m.test(asar.extractFile(archive, f.slice(1).split('/').join(sep)).toString()))
if (bare.length) {
  console.error(`renderer assets with bare imports (a worker not bundled? use ?worker&url):\n  ${bare.join('\n  ')}`)
  process.exit(1)
}

// The uninstall entry points at the setup window (build/installer.nsh): without it "Desinstalar" would do nothing.
const setupUi = join(archive, '..', 'bin', 'alga-setup-ui.exe')
if (!existsSync(setupUi)) {
  console.error(`missing ${setupUi}: run scripts/build-setup-ui.mjs before electron-builder`)
  process.exit(1)
}
