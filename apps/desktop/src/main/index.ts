import './chromium-flags'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import type { AppConfig } from '../shared/bridge'

// Dev multi-instance: `--profile=bob` isolates userData (and the single-instance lock) per profile.
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1] ?? 'default'
if (profile !== 'default') app.setPath('userData', join(app.getPath('appData'), 'Alga Meet', 'profiles', profile))

const apiUrl = process.env.ALGA_API_URL ?? import.meta.env.MAIN_VITE_API_URL ?? 'http://localhost:4000'

const config: AppConfig = {
  apiUrl,
  gatewayUrl: apiUrl.replace(/^http/, 'ws') + '/gateway',
  version: app.getVersion(),
  profile,
  platform: process.platform,
  isPackaged: app.isPackaged,
}

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: profile === 'default' ? 'Alga Meet' : `Alga Meet (${profile})`,
    backgroundColor: '#0c0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#a8adb7', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  ipcMain.on('alga:config', (e) => (e.returnValue = config))
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
