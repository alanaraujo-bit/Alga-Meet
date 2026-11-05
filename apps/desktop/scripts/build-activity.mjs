// Compiles native/activity/AlgaActivity.cs with the csc.exe that ships with Windows (.NET Framework 4).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') process.exit(0)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'native', 'activity', 'AlgaActivity.cs')
const out = join(root, 'build', 'bin', 'alga-activity.exe')
if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) process.exit(0)

const csc = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
if (!existsSync(csc)) {
  console.warn('build-activity: csc.exe not found, activity helper skipped')
  process.exit(0)
}
mkdirSync(dirname(out), { recursive: true })
execFileSync(csc, ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', '/r:System.Drawing.dll', `/out:${out}`, src], { stdio: 'inherit' })
console.log('build-activity: built', out)
