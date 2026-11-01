import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, crashReporter } from 'electron'
import { isDeepLinkArg, redactLink } from './deep-link-logic'

// Tiny rotating file log: userData/logs/main.log, rotated at 1 MB, 3 old files kept.
const MAX_BYTES = 1_000_000
const KEEP = 3

let file: string | null = null
let size = 0

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function rotate(): void {
  if (!file) return
  rmSync(`${file}.${KEEP}`, { force: true })
  for (let i = KEEP - 1; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`)
    } catch {}
  }
  try {
    renameSync(file, `${file}.1`)
  } catch {}
  size = 0
}

function detail(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function write(level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${[msg, ...extra.map(detail)].join(' ')}\n`
  if (!app.isPackaged) (level === 'ERROR' ? console.error : console.log)(line.trimEnd())
  if (!file) return
  try {
    if (size + line.length > MAX_BYTES) rotate()
    appendFileSync(file, line)
    size += Buffer.byteLength(line)
  } catch {
    // Logging must never take the app down (disk full, file locked by AV...).
  }
}

export const log = {
  info: (msg: string, ...extra: unknown[]) => write('INFO', msg, extra),
  warn: (msg: string, ...extra: unknown[]) => write('WARN', msg, extra),
  error: (msg: string, ...extra: unknown[]) => write('ERROR', msg, extra),
}

/** Call once, after userData is final (profile) and before anything else logs. */
export function initLog(): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    file = join(logDir(), 'main.log')
    try {
      size = statSync(file).size
    } catch {
      size = 0
    }
  } catch {
    file = null
  }
  // Minidumps stay local (userData/Crashpad); nothing is uploaded.
  crashReporter.start({ uploadToServer: false })

  process.on('uncaughtException', (err) => log.error('uncaughtException', err))
  process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason))
  app.on('render-process-gone', (_e, wc, d) => log.error('render-process-gone', { url: wc.getURL(), ...d }))
  app.on('child-process-gone', (_e, d) => log.error('child-process-gone', d))
  log.info(`start v${app.getVersion()} electron ${process.versions.electron} pid ${process.pid} argv`,
    // a deep link carries a bearer token/invite code: log its scheme + host only
    process.argv.slice(1).map((a) => (isDeepLinkArg(a) ? redactLink(a) : a)),
  )
}
