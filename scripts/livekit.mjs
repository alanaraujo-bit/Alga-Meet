// Runs the local LiveKit SFU, downloading the pinned, checksum-verified binary on first use.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '1.13.11'
const SHA256 = '5d071ea43339f0140d24a66f0b2ff8a7bf6c4d0dceb19b30abca835670213667' // windows_amd64.zip
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'livekit')
const binDir = join(root, 'bin')
const exe = join(binDir, process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server')

if (!existsSync(exe)) {
  if (process.platform !== 'win32') throw new Error('Auto-download only wired for Windows; install livekit-server manually.')
  mkdirSync(binDir, { recursive: true })
  const zip = join(binDir, 'livekit.zip')
  const url = `https://github.com/livekit/livekit/releases/download/v${VERSION}/livekit_${VERSION}_windows_amd64.zip`
  console.log(`[livekit] downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== SHA256) throw new Error(`checksum mismatch: ${got}`)
  await import('node:fs/promises').then((fs) => fs.writeFile(zip, buf))
  execFileSync('tar', ['-xf', zip, '-C', binDir])
  rmSync(zip)
}

const child = spawn(exe, ['--config', join(root, 'livekit.dev.yaml')], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill())
