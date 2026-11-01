import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { log } from './log'

export interface SavedBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface Settings {
  closeToTray: boolean
  window?: SavedBounds
}

const DEFAULTS: Settings = { closeToTray: true }
let cache: Settings | null = null

const file = () => join(app.getPath('userData'), 'settings.json')

/** Write-then-rename so a crash mid-write never leaves a truncated file. */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s: Settings = { closeToTray: typeof r.closeToTray === 'boolean' ? r.closeToTray : DEFAULTS.closeToTray }
  const w = (r.window && typeof r.window === 'object' ? r.window : null) as Record<string, unknown> | null
  const width = num(w?.width)
  const height = num(w?.height)
  if (w && width && height) s.window = { x: num(w.x), y: num(w.y), width, height, maximized: w.maximized === true }
  return s
}

export function getSettings(): Settings {
  if (!cache) {
    try {
      cache = sanitize(JSON.parse(readFileSync(file(), 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('settings unreadable, using defaults', err)
      cache = { ...DEFAULTS }
    }
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...getSettings(), ...patch }
  try {
    writeFileAtomic(file(), JSON.stringify(cache, null, 2))
  } catch (err) {
    log.error('settings write failed', err)
  }
}
