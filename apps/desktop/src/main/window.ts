import { join } from 'node:path'
import { BrowserWindow, app, nativeImage, screen } from 'electron'
import { IPC } from '../shared/ipc'
import { assetPath } from './assets'
import { badgeBitmap, badgeText } from './badge'
import { fitBounds } from './bounds'
import { emit, handle, int, on } from './ipc'
import { log } from './log'
import { rendererUrl } from './security'
import { getSettings, updateSettings } from './settings'
import { clampZoom } from './ui-logic'

const DEFAULT_SIZE = { width: 1320, height: 840 }
const MIN_SIZE = { width: 960, height: 600 }

let win: BrowserWindow | null = null
let quitting = false
let pendingMaximize = false

export const mainWindow = (): BrowserWindow | null => win

/** Lets the next close really close (quit, update install, Windows shutdown) instead of hiding to tray. */
export function setQuitting(): void {
  quitting = true
}

/**
 * Launched by Playwright (`--remote-debugging-port=0`) or with ALGA_AUTOMATION=1: test, screenshot and perf runs
 * must never cover the owner's screen. Windows open off-screen, inactive, out of the taskbar; CDP screenshots of the
 * renderer still work.
 */
// Playwright's loader strips its flags from process.argv, so read Chromium's own command line.
export const automation = app.commandLine.getSwitchValue('remote-debugging-port') === '0' || process.env.ALGA_AUTOMATION === '1'

export function showMainWindow(): void {
  if (!win) return
  if (automation) return win.showInactive()
  if (win.isMinimized()) win.restore()
  if (pendingMaximize) {
    pendingMaximize = false
    win.maximize() // maximize() also shows; deferred so a --hidden start stays hidden
  }
  win.show()
  win.focus()
}

function saveBounds(): void {
  if (automation || !win || win.isDestroyed()) return
  updateSettings({ window: { ...win.getNormalBounds(), maximized: pendingMaximize || win.isMaximized() } })
}

function setBadge(count: number): void {
  if (!win) return
  const text = badgeText(count)
  if (!text) return win.setOverlayIcon(null, '')
  const img = nativeImage.createEmpty()
  for (const [scaleFactor, size] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]] as const)
    img.addRepresentation({ scaleFactor, width: size, height: size, buffer: badgeBitmap(count, size)! })
  win.setOverlayIcon(img, count === 1 ? '1 menção não lida' : `${count} menções não lidas`)
}

export function createMainWindow(title: string, startHidden: boolean): BrowserWindow {
  const saved = getSettings().window
  const bounds = fitBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
    DEFAULT_SIZE,
    MIN_SIZE,
  )
  win = new BrowserWindow({
    ...bounds,
    ...(automation && { x: -32000, y: -32000, skipTaskbar: true }),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title,
    // Packaged builds take the exe icon; dev would show Electron's.
    ...(app.isPackaged ? {} : { icon: assetPath('icon.png') }),
    backgroundColor: '#0c0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#a8adb7', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      zoomFactor: getSettings().zoomFactor,
    },
  })
  pendingMaximize = !automation && saved?.maximized === true

  win.once('ready-to-show', () => {
    if (!startHidden) showMainWindow()
  })

  let saveTimer: NodeJS.Timeout | undefined
  const scheduleSave = () => {
    if (automation) return // never persist the off-screen position
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveBounds, 500)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', () => emit(IPC.winMaximizedChanged, true))
  win.on('unmaximize', () => emit(IPC.winMaximizedChanged, false))
  win.on('focus', () => {
    win?.flashFrame(false)
    emit(IPC.winFocusChanged, true)
  })
  win.on('blur', () => emit(IPC.winFocusChanged, false))
  // Windows logoff/shutdown must never be blocked by close-to-tray.
  win.on('query-session-end', setQuitting)
  win.on('session-end', setQuitting)
  win.on('close', (e) => {
    clearTimeout(saveTimer)
    saveBounds()
    if (!quitting && getSettings().closeToTray) {
      e.preventDefault()
      win?.hide()
      log.info('window hidden to tray')
    }
  })
  win.on('closed', () => {
    win = null
  })
  // Reloads (dev HMR, renderer recovery) keep the saved zoom.
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(getSettings().zoomFactor))

  void win.loadURL(rendererUrl).catch((err) => log.error('renderer failed to load', rendererUrl, err))
  return win
}

export function registerWindowIpc(): void {
  on(IPC.winMinimize, () => win?.minimize())
  on(IPC.winToggleMaximize, () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  on(IPC.winClose, () => win?.close())
  handle(IPC.winIsMaximized, () => win?.isMaximized() ?? false)
  on(IPC.winSetBadge, (count) => setBadge(int(count, 0, 1_000_000)))
  on(IPC.winFlashFrame, () => {
    if (win && !win.isFocused()) win.flashFrame(true)
  })
  handle(IPC.winGetZoom, () => getSettings().zoomFactor)
  handle(IPC.winSetZoom, (f) => {
    const zoomFactor = clampZoom(f)
    updateSettings({ zoomFactor })
    win?.webContents.setZoomFactor(zoomFactor)
  })
}
