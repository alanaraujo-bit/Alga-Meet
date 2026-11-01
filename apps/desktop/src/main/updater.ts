import { app } from 'electron'
import type { UpdateStatus } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { emit, handle, on } from './ipc'
import { log } from './log'
import { setQuitting } from './window'

// electron-updater against GitHub Releases (publish config in electron-builder.yml -> app-update.yml).
// Every failure (offline, 404 while the repo/release doesn't exist) becomes an 'error' status, never a crash.
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = app.isPackaged
  ? { state: 'idle' }
  : { state: 'disabled', reason: 'Atualizações automáticas só funcionam na versão instalada.' }
let updater: typeof import('electron-updater').autoUpdater | null = null

function set(s: UpdateStatus): void {
  status = s
  emit(IPC.updatesStatus, s)
}

// First line only: electron-updater errors embed full HTTP response headers (cookies included).
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300)

function friendly(err: unknown): string {
  const msg = firstLine(err)
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK/i.test(msg))
    return 'Sem conexão para verificar atualizações.'
  if (/\b404\b|HttpError: 404|Cannot find latest/i.test(msg)) return 'Nenhuma versão publicada ainda.'
  return 'Não foi possível verificar atualizações.'
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updater || status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status
  try {
    await updater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: friendly(err) }) // already logged by the 'error' event
  }
  return status
}

export function initUpdater(): void {
  handle(IPC.updatesCheck, () => checkForUpdates())
  on(IPC.updatesInstall, () => {
    if (!updater || status.state !== 'ready') return
    log.info('installing update', status.version)
    setQuitting()
    updater.quitAndInstall(true, true) // silent installer, relaunch after
  })
  if (!app.isPackaged) return

  try {
    updater = (require('electron-updater') as typeof import('electron-updater')).autoUpdater
  } catch (err) {
    log.error('electron-updater failed to load', err)
    set({ state: 'disabled', reason: 'Atualizador indisponível.' })
    return
  }
  updater.logger = {
    info: (m: unknown) => log.info('[updater]', m),
    warn: (m: unknown) => log.warn('[updater]', m),
    error: () => {}, // reported once, trimmed, by the 'error' handler below
    debug: () => {},
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowDowngrade = false
  updater.disableWebInstaller = true // we ship the full NSIS installer, never the web installer
  updater.on('checking-for-update', () => set({ state: 'checking' }))
  updater.on('update-available', (i) => set({ state: 'available', version: i.version }))
  updater.on('update-not-available', () => set({ state: 'none' }))
  updater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  updater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  updater.on('error', (err) => {
    log.warn('updater error:', firstLine(err))
    set({ state: 'error', message: friendly(err) })
  })

  void checkForUpdates()
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref()
}
