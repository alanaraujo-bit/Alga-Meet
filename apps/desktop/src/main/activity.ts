import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { ACTIVITY_ICON_MAX, ActivitySchema, sameActivity } from '@alga/shared'
import { app, nativeImage, powerMonitor } from 'electron'
import type { DetectedApp, LocalActivity } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { classify, defaultShown, exeNameOf, initialState, step, type Classified, type Sample, type State } from './activity-logic'
import { bool, emit, handle, str } from './ipc'
import { log } from './log'
import { ACTIVITY_APPS_MAX, getSettings, updateSettings, type SavedActivityApp } from './settings'

// Rich presence: native/activity/AlgaActivity.cs reports the foreground app; activity-logic.ts decides what counts.

interface Foreground {
  pid: number
  path: string
  start: number
  product: string
  desc: string
  fs: boolean
}

const TICK_MS = 1000
const PERSIST_MS = 60_000
const KEY_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,128}$/

let helper: ChildProcessWithoutNullStreams | null = null
let timer: NodeJS.Timeout | null = null
let restarts = 0
let restartTimer: NodeJS.Timeout | null = null
let fg: Foreground | null = null
let st: State = initialState()
let last: LocalActivity | null = null

const icons = new Map<string, string>() // exe path -> data URL, '' = none / too big
const asked = new Set<string>()
const pathOfKey = new Map<string, string>() // app key -> last seen exe path
const meta = new Map<string, { manifestName?: string; steamAppId?: number }>() // exe path -> install manifest data

/** Dev/QA only (screenshots): a fixed activity from the environment, "off" for none. */
let fakeCache: { activity: LocalActivity | null } | null | undefined
function fake(): { activity: LocalActivity | null } | null {
  if (fakeCache !== undefined) return fakeCache
  const raw = process.env.ALGA_FAKE_ACTIVITY
  fakeCache = null
  if (app.isPackaged || !raw) return null
  if (raw === 'off') return (fakeCache = { activity: null })
  try {
    fakeCache = { activity: { ...ActivitySchema.parse(JSON.parse(raw)), key: 'fake.exe' } }
  } catch (err) {
    log.warn('ALGA_FAKE_ACTIVITY ignored', err)
  }
  return fakeCache
}

function helperPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin', 'alga-activity.exe') : join(app.getAppPath(), 'build', 'bin', 'alga-activity.exe')
}

// ---- install manifests (Steam / Epic) for pretty names ----

const steamDirs = new Map<string, { at: number; list: Array<{ dir: string; name: string; appId: number }> }>()
let epic: { at: number; list: Array<{ loc: string; name: string }> } | null = null

function steamLookup(path: string): { name: string; appId: number } | undefined {
  const m = /^(.*\\steamapps)\\common\\([^\\]+)\\/i.exec(path)
  if (!m) return undefined
  const [, root = '', dir = ''] = m
  const find = () => steamDirs.get(root)?.list.find((e) => e.dir.toLowerCase() === dir.toLowerCase())
  const cached = steamDirs.get(root)
  if (!cached || (!find() && Date.now() - cached.at > 60_000)) {
    const list: Array<{ dir: string; name: string; appId: number }> = []
    try {
      for (const f of readdirSync(root))
        if (/^appmanifest_\d+\.acf$/i.test(f)) {
          const t = readFileSync(join(root, f), 'utf8')
          const g = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(t)?.[1]
          const appId = Number(g('appid'))
          const name = g('name')
          const installdir = g('installdir')
          if (appId > 0 && appId <= 2_147_483_647 && name && installdir) list.push({ dir: installdir, name, appId })
        }
    } catch {}
    steamDirs.set(root, { at: Date.now(), list })
  }
  const e = find()
  return e && { name: e.name, appId: e.appId }
}

function epicLookup(path: string): string | undefined {
  if (!epic || Date.now() - epic.at > 5 * 60_000) {
    const list: Array<{ loc: string; name: string }> = []
    const dir = join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
    try {
      for (const f of readdirSync(dir))
        if (f.endsWith('.item')) {
          const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { DisplayName?: unknown; InstallLocation?: unknown }
          if (typeof j.DisplayName === 'string' && typeof j.InstallLocation === 'string') list.push({ loc: j.InstallLocation.toLowerCase().replace(/[\\/]+$/, ''), name: j.DisplayName })
        }
    } catch {}
    epic = { at: Date.now(), list }
  }
  const p = path.toLowerCase()
  return epic.list.find((e) => p.startsWith(e.loc + '\\'))?.name
}

function metaOf(path: string): { manifestName?: string; steamAppId?: number } {
  let m = meta.get(path)
  if (!m) {
    const s = steamLookup(path)
    m = s ? { manifestName: s.name, steamAppId: s.appId } : { manifestName: epicLookup(path) }
    meta.set(path, m)
  }
  return m
}

// ---- state ----

const savedApps = (): SavedActivityApp[] => getSettings().activityApps
const shownFor = (key: string, c: Classified): boolean => savedApps().find((a) => a.key === key)?.shown ?? defaultShown(c)

function resolve(f: Foreground): { key: string; c: Classified | 'ignore'; steamAppId?: number } {
  const key = exeNameOf(f.path)
  const m = metaOf(f.path)
  const c = classify({ path: f.path, product: f.product, desc: f.desc, fs: f.fs, exeName: key, manifestName: m.manifestName })
  return { key, c, steamAppId: m.steamAppId }
}

/** Remember the app in the list (new apps at once; known ones at most once a minute). */
function noteSeen(key: string, c: Classified, now: number): void {
  const apps = savedApps()
  const old = apps.find((a) => a.key === key)
  if (old && old.name === c.name && old.kind === c.kind && now - old.lastSeen < PERSIST_MS) return
  const entry: SavedActivityApp = { key, name: c.name, kind: c.kind, lastSeen: now, shown: old?.shown ?? defaultShown(c) }
  updateSettings({ activityApps: [entry, ...apps.filter((a) => a.key !== key)].slice(0, ACTIVITY_APPS_MAX) })
}

/** E2E runs on an unattended PC (scripts/activity-shots.mjs): there, nobody is ever "away". */
const idleMs = () => (!app.isPackaged && process.env.ALGA_E2E === '1' ? 0 : powerMonitor.getSystemIdleTime() * 1000)

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function view(): LocalActivity | null {
  const f = fake()
  if (!getSettings().activityShare) return null
  if (f) return f.activity
  const cur = st.current
  // Every app reaches the saved list before it can become current: no entry = not shown.
  if (!cur || !savedApps().find((a) => a.key === cur.key)?.shown) return null
  const icon = icons.get(pathOfKey.get(cur.key) ?? '')
  return { kind: cur.kind, name: cur.name, startedAt: Math.round(cur.startedAt), key: cur.key, ...(icon && { icon }), ...(cur.steamAppId && { steamAppId: cur.steamAppId }) }
}

function publish(): void {
  const next = view()
  if (sameActivity(last, next) && last?.key === next?.key) return
  last = next
  emit(IPC.activityChanged, next)
}

function tick(): void {
  try {
    tickOnce()
  } catch (err) {
    log.warn('activity tick failed', err)
  }
}

function tickOnce(): void {
  const now = Date.now()
  let sample: Sample | null = null
  if (fg && fg.pid > 0 && fg.path) {
    const r = resolve(fg)
    if (r.c === 'ignore') sample = { pid: fg.pid, key: r.key, name: '', kind: null, ignored: true, shown: false, procStart: fg.start }
    else {
      pathOfKey.set(r.key, fg.path)
      noteSeen(r.key, r.c, now)
      sample = { pid: fg.pid, key: r.key, name: r.c.name, kind: r.c.kind, ignored: false, shown: shownFor(r.key, r.c), procStart: fg.start, steamAppId: r.steamAppId }
      askIcon(fg.path)
    }
  }
  st = step(st, sample, now, alive, idleMs())
  publish()
}

/**
 * Store (UWP/MSIX) apps keep their icon in the package, not in the exe: AppxManifest's Square44x44Logo, preferring the
 * transparent ("unplated") variant nearest 64 px, scaled to 64 × 64. '' when there is none.
 */
export function storeLogo(exePath: string): string {
  const m = /^(.*\\WindowsApps\\[^\\]+)\\/i.exec(exePath)
  if (!m) return ''
  try {
    const root = m[1]!
    const rel = /Square44x44Logo="([^"]+)"/.exec(readFileSync(join(root, 'AppxManifest.xml'), 'utf8'))?.[1]
    if (!rel) return ''
    const dir = join(root, dirname(rel))
    const base = basename(rel, extname(rel)).toLowerCase()
    const score = (f: string) => {
      const size = Number(/targetsize-(\d+)/i.exec(f)?.[1] ?? 0)
      const fit = size ? (size >= 48 ? 100 - Math.abs(size - 64) / 4 : size) : /scale-(200|400)/i.test(f) ? 40 : 10
      return fit + (/altform-unplated/i.test(f) ? 50 : 0)
    }
    const best = readdirSync(dir)
      .filter((f) => f.toLowerCase().startsWith(`${base}.`) && !/contrast|lightunplated/i.test(f))
      .sort((a, b) => score(b) - score(a))[0]
    const img = best ? nativeImage.createFromPath(join(dir, best)) : null
    if (!img || img.isEmpty()) return ''
    return compactIcon(img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL())
  } catch {
    return ''
  }
}

/**
 * Icons ride every presence update to every friend: past ICON_SOFT_MAX a 64 px icon is redrawn at 48 px; past the
 * wire limit it is dropped (the kind's glyph shows instead).
 */
const ICON_SOFT_MAX = 6000
function compactIcon(url: string): string {
  if (!url || url.length <= ICON_SOFT_MAX) return url
  const small = nativeImage.createFromDataURL(url).resize({ width: 48, height: 48, quality: 'best' }).toDataURL()
  if (small.length <= ACTIVITY_ICON_MAX) return small
  log.info('activity icon too large, dropped', small.length)
  return ''
}

function askIcon(path: string): void {
  if (asked.has(path) || !helper) return
  asked.add(path)
  // Local executables only: no UNC (a dead share would stall the helper), nothing but an .exe.
  if (!/^[a-z]:\\[^\t\r\n]+\.exe$/i.test(path)) return void icons.set(path, '')
  const logo = storeLogo(path)
  if (logo) {
    icons.set(path, logo)
    return publish()
  }
  if (path.includes('\n') || path.includes('\t')) return icons.set(path, '') && undefined
  helper.stdin.write(`icon\t${path}\n`)
}

// ---- helper process ----

function onLine(line: string): void {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(line)
  } catch {
    return log.warn('activity helper: bad line', line.slice(0, 200))
  }
  restarts = 0
  if (j.t === 'fg' && typeof j.pid === 'number' && typeof j.path === 'string') {
    fg = { pid: j.pid, path: j.path, start: Number(j.start) || 0, product: String(j.product ?? ''), desc: String(j.desc ?? ''), fs: j.fs === true }
    tick() // react to focus changes now, not at the next second
  } else if (j.t === 'icon' && typeof j.path === 'string' && typeof j.png === 'string') {
    const url = compactIcon(j.png ? `data:image/png;base64,${j.png}` : '')
    icons.set(j.path, url)
    publish()
  }
}

function startHelper(): void {
  if (helper || process.platform !== 'win32' || fake()) return
  const exe = helperPath()
  if (!existsSync(exe)) return log.warn('activity helper missing, feature off', exe)
  try {
    const h = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    helper = h
    let buf = ''
    h.stdout.setEncoding('utf8')
    h.stdout.on('data', (d: string) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) onLine(line)
      }
      if (buf.length > 1_000_000) buf = '' // never grow without a newline
    })
    h.stdin.on('error', () => {})
    h.stderr.on('data', (d: Buffer) => log.warn('activity helper stderr', d.toString().slice(0, 300)))
    h.on('error', (err) => log.warn('activity helper error', err))
    h.on('exit', (code) => {
      if (helper !== h) return
      helper = null
      fg = null
      asked.clear() // a restarted helper must be asked for icons again
      if (!getSettings().activityShare || restarts >= 5) return log.warn('activity helper stopped', code)
      restarts++
      log.warn('activity helper exited, restarting', code)
      restartTimer = setTimeout(startHelper, 5000)
    })
  } catch (err) {
    log.warn('activity helper failed to start', err)
    helper = null
  }
}

function stopHelper(): void {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  const h = helper
  helper = null
  fg = null
  asked.clear()
  if (!h) return
  h.stdin.end()
  h.kill()
}

// ---- public ----

function begin(): void {
  if (timer) return
  startHelper()
  timer = setInterval(tick, TICK_MS)
}

function end(): void {
  if (timer) clearInterval(timer)
  timer = null
  stopHelper()
  st = initialState()
  publish()
}

export function startActivity(): void {
  if (getSettings().activityShare) begin()
}

export function stopActivity(): void {
  if (timer) clearInterval(timer)
  timer = null
  stopHelper()
}

function apps(): DetectedApp[] {
  return savedApps().map((a) => {
    const icon = icons.get(pathOfKey.get(a.key) ?? '')
    return { key: a.key, name: a.name, kind: a.kind, lastSeen: a.lastSeen, shown: a.shown, ...(icon && { icon }) }
  })
}

export function registerActivityIpc(): void {
  handle(IPC.activityCurrent, () => view())
  handle(IPC.activityGetShare, () => getSettings().activityShare)
  handle(IPC.activitySetShare, (v) => {
    const on = bool(v)
    if (on === getSettings().activityShare) return
    updateSettings({ activityShare: on })
    if (on) begin()
    else end()
  })
  handle(IPC.activityApps, () => apps())
  handle(IPC.activitySetAppShown, (k, v) => {
    const key = str(k, 128)
    const shown = bool(v)
    if (!KEY_RE.test(key)) throw new TypeError('invalid app key')
    const list = savedApps()
    if (!list.some((a) => a.key === key)) throw new TypeError('unknown app')
    updateSettings({ activityApps: list.map((a) => (a.key === key ? { ...a, shown } : a)) })
    if (!shown && st.current?.key === key) st = { ...st, current: null } // a hidden app is never shared, and must not block the next one
    publish()
  })
}
