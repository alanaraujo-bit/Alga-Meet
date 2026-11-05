// Builds the setup window into build/bin/alga-setup-ui.exe: the src/setup page (one inlined index.html, Vite) and
// the native/setup-ui WebView2 host that embeds it (cargo). The installer runs it for install and update
// (build/installer.nsh), and the app ships it in resources/bin as the uninstall entry. Run by `npm run dist`.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

if (process.platform !== 'win32') process.exit(0)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'native', 'setup-ui')

await build({ configFile: join(root, 'vite.setup.config.ts'), logLevel: 'warn' })
execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(crate, 'Cargo.toml')], { stdio: 'inherit' })

const out = join(root, 'build', 'bin', 'alga-setup-ui.exe')
mkdirSync(dirname(out), { recursive: true })
copyFileSync(join(crate, 'target', 'release', 'alga-setup-ui.exe'), out)
console.log('build-setup-ui: built', out)
