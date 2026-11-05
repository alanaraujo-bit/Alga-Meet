import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVITY_KINDS, type ActivityKind } from '@alga/shared'
import { app } from 'electron'
import { log } from './log'
import { clampZoom } from './ui-logic'

export interface SavedBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** An app seen in the foreground (Activity list in Settings), without its icon. */
export interface SavedActivityApp {
  key: string
  name: string
  kind: ActivityKind | null
  lastSeen: number
  shown: boolean
}

export const ACTIVITY_APPS_MAX = 30

export interface Settings {
  closeToTray: boolean
  /** Renderer zoom factor (webContents.setZoomFactor), ZOOM_MIN..ZOOM_MAX. */
  zoomFactor: number
  /** Tray icon breathes while in voice (also off when Windows asks for reduced motion). */
  trayAnimation: boolean
  /** Share what I am doing (rich presence) with friends and co-members. */
  activityShare: boolean
  activityApps: SavedActivityApp[]
  window?: SavedBounds
}

const DEFAULTS: Settings = { closeToTray: true, zoomFactor: 1, trayAnimation: true, activityShare: true, activityApps: [] }
let cache: Settings | null = null

const file = () => join(app.getPath('userData'), 'settings.json')

/** Write-then-rename so a crash mid-write never leaves a truncated file. */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)

function sanitizeApps(raw: unknown): SavedActivityApp[] {
  if (!Array.isArray(raw)) return []
  const out: SavedActivityApp[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const kind = ACTIVITY_KINDS.find((k) => k === r.kind) ?? null
    if (typeof r.key !== 'string' || !r.key || r.key.length > 128 || typeof r.name !== 'string' || !r.name || r.name.length > 64) continue
    if (typeof r.lastSeen !== 'number' || !Number.isFinite(r.lastSeen) || out.some((x) => x.key === r.key)) continue
    out.push({ key: r.key, name: r.name, kind, lastSeen: Math.round(r.lastSeen), shown: typeof r.shown === 'boolean' ? r.shown : kind !== null })
  }
  return out.sort((x, y) => y.lastSeen - x.lastSeen).slice(0, ACTIVITY_APPS_MAX)
}

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s: Settings = {
    closeToTray: typeof r.closeToTray === 'boolean' ? r.closeToTray : DEFAULTS.closeToTray,
    zoomFactor: typeof r.zoomFactor === 'number' && Number.isFinite(r.zoomFactor) ? clampZoom(r.zoomFactor) : DEFAULTS.zoomFactor,
    trayAnimation: typeof r.trayAnimation === 'boolean' ? r.trayAnimation : DEFAULTS.trayAnimation,
    activityShare: typeof r.activityShare === 'boolean' ? r.activityShare : DEFAULTS.activityShare,
    activityApps: sanitizeApps(r.activityApps),
  }
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
