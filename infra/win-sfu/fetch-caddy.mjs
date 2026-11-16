// Downloads caddy.exe (Windows amd64) WITH the layer4 module into ./bin, from Caddy's own build service. The plain
// release on GitHub has no layer4, and the SFU needs it to split 443 by SNI (signaling vs TURN/TLS).
//   node infra/win-sfu/fetch-caddy.mjs
// The build service compiles on demand, so there is no published checksum to pin: this prints the SHA-256 of what
// arrived and refuses a binary that does not report the layer4 modules.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = join(dirname(fileURLToPath(import.meta.url)), 'bin')
const exe = join(bin, 'caddy.exe')
const url = 'https://caddyserver.com/api/download?os=windows&arch=amd64&p=github.com%2Fmholt%2Fcaddy-l4'

mkdirSync(bin, { recursive: true })
console.log(`[caddy] baixando ${url}`)
const res = await fetch(url, { signal: AbortSignal.timeout(300_000) })
if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`)
const buf = Buffer.from(await res.arrayBuffer())
if (buf.length < 10_000_000 || buf.subarray(0, 2).toString('latin1') !== 'MZ') throw new Error(`resposta inesperada (${buf.length} bytes): não é um executável do Windows`)
const tmp = `${exe}.tmp`
writeFileSync(tmp, buf)
try {
  const version = execFileSync(tmp, ['version'], { encoding: 'utf8' }).trim()
  const mods = execFileSync(tmp, ['list-modules'], { encoding: 'utf8' })
  for (const m of ['layer4', 'layer4.handlers.proxy', 'layer4.handlers.tls', 'layer4.matchers.tls']) {
    if (!new RegExp(`^${m.replaceAll('.', '\\.')}$`, 'm').test(mods)) throw new Error(`o binário não tem o módulo ${m}`)
  }
  renameSync(tmp, exe)
  const sha = createHash('sha256').update(buf).digest('hex')
  writeFileSync(join(bin, 'caddy.txt'), `caddy ${version}\nsha256 ${sha}\nfonte ${url}\nbaixado ${new Date().toISOString()}\n`)
  console.log(`[caddy] ${version}\n[caddy] ${(buf.length / 1048576).toFixed(1)} MB, sha256 ${sha}\n[caddy] módulos layer4 presentes -> ${exe}`)
} catch (e) {
  rmSync(tmp, { force: true })
  throw e
}
