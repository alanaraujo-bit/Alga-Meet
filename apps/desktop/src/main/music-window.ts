// The music's floating player: a small frameless window, always on top, outside Alga (renderer route #music-mini).
// The main window owns the call; this one only plays YouTube's player and shows the controls. Main relays snapshots one
// way and commands the other, and checks who sends what: only the main window pushes, only the floating one commands.
import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { fitBounds } from './bounds'
import { isTrustedSender } from './ipc'
import { rendererUrl } from './security'
import { getSettings, updateSettings } from './settings'
import { automation, mainWindow } from './window'

/** One slim line (sound only), with room around it for its shadow. */
const SIZE = { width: 412, height: 76 }
const MAX_JSON = 1 << 20

let pop: BrowserWindow | null = null
/** Closed because the app asked (not its × or Windows): the main window already knows, so no 'closed' event. */
const asked = new WeakSet<BrowserWindow>()

const fromMain = (e: IpcMainEvent | IpcMainInvokeEvent) => isTrustedSender(e) && BrowserWindow.fromWebContents(e.sender) === mainWindow()
const fromPop = (e: IpcMainEvent | IpcMainInvokeEvent) => isTrustedSender(e) && !!pop && BrowserWindow.fromWebContents(e.sender) === pop

function open(): void {
  if (pop && !pop.isDestroyed()) {
    if (!automation) pop.show()
    return
  }
  const primary = screen.getPrimaryDisplay().workArea
  const saved = getSettings().miniPlayer
  // First time: lower right of the primary screen.
  const fallback = { ...SIZE, x: primary.x + primary.width - SIZE.width - 24, y: primary.y + primary.height - SIZE.height - 24 }
  const b = fitBounds(saved ? { x: saved.x, y: saved.y, ...SIZE } : fallback, screen.getAllDisplays().map((d) => d.workArea), primary, SIZE, SIZE)
  pop = new BrowserWindow({
    ...(automation ? { x: -10000, y: -10000 } : { x: b.x, y: b.y }),
    width: SIZE.width,
    height: SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Música · Alga Meet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  })
  // Over full-screen games and videos too.
  pop.setAlwaysOnTop(true, 'floating')
  pop.once('ready-to-show', () => (automation ? pop?.showInactive() : pop?.show()))
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  pop.on('moved', () => {
    if (automation) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (pop && !pop.isDestroyed()) updateSettings({ miniPlayer: { ...pop.getBounds(), maximized: false } })
    }, 300)
  })
  const self = pop
  self.on('closed', () => {
    clearTimeout(saveTimer)
    if (pop === self) pop = null
    if (asked.has(self)) return
    const w = mainWindow()
    if (w && !w.webContents.isDestroyed()) w.webContents.send(IPC.musicPopClosed)
  })
  void pop.loadURL(`${rendererUrl}#music-mini`)
}

export function closeMusicPop(): void {
  const w = pop
  pop = null
  if (!w || w.isDestroyed()) return
  asked.add(w)
  w.destroy()
}

export function registerMusicPopIpc(): void {
  ipcMain.handle(IPC.musicPopOpen, (e) => {
    if (!fromMain(e)) throw new Error('forbidden')
    open()
  })
  ipcMain.handle(IPC.musicPopClose, (e) => {
    if (!fromMain(e) && !fromPop(e)) throw new Error('forbidden')
    closeMusicPop()
  })
  ipcMain.on(IPC.musicPopPush, (e, snapshot: unknown) => {
    if (!fromMain(e) || typeof snapshot !== 'string' || snapshot.length > MAX_JSON) return
    if (pop && !pop.webContents.isDestroyed()) pop.webContents.send(IPC.musicPopState, snapshot)
  })
  ipcMain.on(IPC.musicPopCommand, (e, cmd: unknown) => {
    if (!fromPop(e) || typeof cmd !== 'string' || cmd.length > 4096) return
    const w = mainWindow()
    if (w && !w.webContents.isDestroyed()) w.webContents.send(IPC.musicPopCommandEvent, cmd)
  })
}
