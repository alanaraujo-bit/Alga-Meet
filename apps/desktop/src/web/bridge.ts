/**
 * The web (PWA) implementation of `window.alga` (src/shared/bridge.ts). The renderer is the same as the desktop app's;
 * this file is the only thing that changes. Where the browser cannot do what Electron does (tray, global hotkeys,
 * hosting a film with ffmpeg, app detection), the call resolves to "nothing" and `caps` tells the UI to hide or explain.
 */
import type { AlgaBridge, AppConfig, DeepLink, UpdateStatus, Unsubscribe } from '../shared/bridge'
import { parseWebLink, webOsLabel } from './logic'

const TOKEN_KEY = 'alga.token'
const ZOOM_KEY = 'alga.zoom'

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null): void => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* private mode: lives for this page only */
    }
  },
}

/** A tiny event hub: `on` returns the unsubscribe the bridge contract asks for. */
function hub<T>() {
  const subs = new Set<(v: T) => void>()
  return {
    on: (cb: (v: T) => void): Unsubscribe => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    emit: (v: T) => subs.forEach((cb) => cb(v)),
  }
}

const nothing = async () => {}
const none = async () => null
const noSub = (): Unsubscribe => () => {}

// The API is reached on this same origin (the PWA's server proxies /api and /gateway), so no CORS is involved.
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) || location.origin
const ua = navigator.userAgent

export const config: AppConfig = {
  apiUrl,
  gatewayUrl: apiUrl.replace(/^http/, 'ws') + '/gateway',
  version: __APP_VERSION__,
  profile: 'default',
  platform: (/android/i.test(ua) ? 'android' : /iphone|ipad|mac/i.test(ua) ? 'darwin' : /win/i.test(ua) ? 'win32' : 'linux') as NodeJS.Platform,
  isPackaged: import.meta.env.PROD,
  cpuVendor: 'unknown',
  osVersion: webOsLabel(ua),
  shell: 'web',
}

// ---- notifications ------------------------------------------------------------------------------------------------
const notificationClick = hub<string | undefined>()
// A push tapped while the app was closed opens /?channel=<id> (sw.js): handed to the app once it listens.
let pendingClick: string | null = (() => {
  const id = new URLSearchParams(location.search).get('channel')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null
  history.replaceState(null, '', '/')
  return `msg:${id}`
})()
const onNotificationClick = (cb: (tag: string | undefined) => void): Unsubscribe => {
  const off = notificationClick.on(cb)
  if (pendingClick) {
    const tag = pendingClick
    pendingClick = null
    setTimeout(() => cb(tag), 0)
  }
  return off
}
navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type === 'notification-click') notificationClick.emit(typeof e.data.tag === 'string' ? e.data.tag : undefined)
})

async function notify(opts: { title: string; body: string; tag?: string; silent?: boolean }) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker?.getRegistration()
  const options: NotificationOptions = { body: opts.body, tag: opts.tag, silent: opts.silent, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', data: { tag: opts.tag } }
  if (reg) return void reg.showNotification(opts.title, options)
  const n = new Notification(opts.title, options)
  n.onclick = () => {
    window.focus()
    notificationClick.emit(opts.tag)
  }
}

// ---- power: a long time hidden or offline looks like a resume to the app (it re-checks its connections) -----------
const resume = hub<void>()
let hiddenAt = 0
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now()
  else if (hiddenAt && Date.now() - hiddenAt > 60_000) resume.emit()
})
window.addEventListener('online', () => resume.emit())

// ---- updates: a new service worker waiting = an update ready -------------------------------------------------------
let update: UpdateStatus = { state: 'idle' }
const updateHub = hub<UpdateStatus>()
let waiting: ServiceWorker | null = null
export function updateWaiting(sw: ServiceWorker) {
  waiting = sw
  update = { state: 'ready', version: 'nova' }
  updateHub.emit(update)
}

// ---- deep links: read once from the URL the app was opened with ----------------------------------------------------
let pending: DeepLink | null = parseWebLink(location.pathname, location.search)
if (pending) history.replaceState(null, '', '/')

// ---- in-page hotkeys while the tab is focused (no global hooks on the web) -----------------------------------------
const hotkeyHub = hub<{ action: 'pushToTalk' | 'toggleMute' | 'toggleDeafen' | 'pushToMute'; phase: 'down' | 'up' }>()

// ---- a small console ring for "Enviar feedback" (the desktop sends the end of main.log) ----------------------------
const logRing: string[] = []
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  const orig = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    logRing.push(`${new Date().toISOString()} ${level} ${args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ')}`.slice(0, 2000))
    if (logRing.length > 200) logRing.shift()
    orig(...args)
  }
}
function safeJson(v: unknown) {
  try {
    return v instanceof Error ? `${v.name}: ${v.message}` : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const applyZoom = (f: number) => void (document.documentElement.style.zoom = f === 1 ? '' : String(f))
const savedZoom = Number(store.get(ZOOM_KEY))
if (savedZoom >= 0.8 && savedZoom <= 1.5) applyZoom(savedZoom)

export const bridge: AlgaBridge = {
  config,
  auth: {
    getToken: async () => store.get(TOKEN_KEY),
    setToken: async (t) => store.set(TOKEN_KEY, t === null ? null : String(t)),
  },
  window: {
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: async () => false,
    onMaximizedChange: noSub,
    onFocusChange: (cb) => {
      const f = () => cb(true)
      const b = () => cb(false)
      window.addEventListener('focus', f)
      window.addEventListener('blur', b)
      return () => {
        window.removeEventListener('focus', f)
        window.removeEventListener('blur', b)
      }
    },
    setBadge: (count) => {
      const n = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
      void (count > 0 ? n.setAppBadge?.(count) : n.clearAppBadge?.())?.catch(() => {})
    },
    flashFrame: () => {},
    zoom: {
      get: async () => Number(store.get(ZOOM_KEY)) || 1,
      set: async (factor) => {
        if (!Number.isFinite(factor)) throw new TypeError('zoom must be a finite number')
        const f = Math.round(Math.min(1.5, Math.max(0.8, factor)) * 100) / 100
        store.set(ZOOM_KEY, String(f))
        applyZoom(f)
      },
    },
  },
  musicPop: { open: nothing, close: nothing, push: () => {}, onState: noSub, command: () => {}, onCommand: noSub, onClosed: noSub },
  // No source list: getDisplayMedia shows the browser's own picker (engine.ts: no sourceId = let the browser pick).
  screen: { getSources: async () => [], select: nothing },
  hotkeys: {
    set: nothing,
    record: none,
    onEvent: hotkeyHub.on,
    label: async () => '',
  },
  notify: (opts) => void notify(opts),
  onNotificationClick,
  tray: { setVoiceState: () => {}, onAction: noSub },
  power: { onSuspend: noSub, onResume: resume.on },
  updates: {
    check: async () => {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update().catch(() => {})
      return update.state === 'ready' ? update : { state: 'none' }
    },
    status: async () => update,
    onStatus: updateHub.on,
    install: () => {
      if (waiting) waiting.postMessage({ type: 'skip-waiting' })
      else location.reload()
    },
  },
  deepLinks: {
    onLink: noSub,
    takePending: async () => {
      const l = pending
      pending = null
      return l
    },
  },
  // E2EE is off in production builds too (packaged without ALGA_E2EE=1): calls behave the same for everyone.
  e2ee: {
    status: async () => ({ state: 'off', deviceId: null, persistent: false, call: null }),
    joinCall: nothing,
    leaveCall: nothing,
    handleDispatch: () => {},
    onGatewaySend: noSub,
    onFrameKey: noSub,
    onEpoch: noSub,
    verificationCode: none,
    cinemaTag: none,
  },
  // Hosting a film needs ffmpeg on a PC; watching one (as a seat) needs none of this.
  cinema: {
    checkFfmpeg: async () => ({ ok: false, reason: 'missing', detail: 'web' }),
    pick: none,
    fromDrop: async () => {
      throw new Error('Projetar um filme só pelo app do computador.')
    },
    probe: async () => ({ error: 'unreadable' as const }),
    start: nothing,
    ensure: () => {},
    addAudio: () => {},
    addSubtitle: none,
    setPlayhead: () => {},
    diag: (line) => console.info('[cinema]', line.slice(0, 2000)),
    init: none,
    piece: none,
    onPieces: noSub,
    onEvicted: noSub,
    onError: noSub,
    close: nothing,
    resumeAt: none,
    saveResume: () => {},
    captureCard: async () => false,
  },
  activity: {
    current: none,
    onChange: noSub,
    getShare: async () => false,
    setShare: nothing,
    apps: async () => [],
    setAppShown: nothing,
  },
  app: {
    getStartAtLogin: async () => false,
    setStartAtLogin: nothing,
    getCloseToTray: async () => false,
    setCloseToTray: nothing,
    getTrayAnimation: async () => false,
    setTrayAnimation: nothing,
    openExternal: async (url) => {
      const u = new URL(String(url))
      if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') window.open(u.href, '_blank', 'noopener,noreferrer')
    },
    openLogs: nothing,
    takeSetupEco: none,
    recentLog: async (previous) => (previous ? '' : logRing.join('\n')),
    captureWindow: none,
    takeCrash: none,
    quit: () => {},
  },
}
