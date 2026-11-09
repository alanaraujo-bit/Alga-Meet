import './chromium-flags'
import { cpus, release } from 'node:os'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { AppConfig } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { registerActivityIpc, startActivity, stopActivity } from './activity'
import { initCapture } from './capture'
import { receiveDeepLink, registerDeepLinkIpc, trackDeepLinkPage } from './deep-links'
import { registerFeedbackIpc } from './feedback'
import { registerHotkeyIpc, stopHotkeys } from './hotkeys'
import { bool, handle, isTrustedSender, on, str } from './ipc'
import { initLog, log, logDir } from './log'
import { cinemaRoot, cleanupStale } from './cinema/pieces'
import { closeAllCinema, registerCinemaIpc } from './cinema/ipc'
import { registerE2eeIpc, startE2ee, stopE2ee } from './mls/e2ee'
import { registerNotificationIpc } from './notifications'
import { initPower } from './power'
import { getToken, setToken } from './secure-store'
import { applySecurity, isExternalWebUrl } from './security'
import { getSettings, updateSettings } from './settings'
import { createTray, destroyTray, registerTrayIpc, setTrayAnimation, trayState } from './tray'
import { osVersionLabel } from './ui-logic'
import { initUpdater } from './updater'
import { createMainWindow, registerWindowIpc, setQuitting, showMainWindow } from './window'

// Dev multi-instance: `--profile=bob` isolates userData (and the single-instance lock) per profile.
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1] ?? 'default'
// Unpackaged (dev) builds get their own data root so they never share a session token — or the single-instance
// lock — with an installed Alga Meet on the same machine.
const dataRoot = join(app.getPath('appData'), app.isPackaged ? 'Alga Meet' : 'Alga Meet Dev')
if (!app.isPackaged || profile !== 'default') {
  app.setPath('userData', profile === 'default' ? dataRoot : join(dataRoot, 'profiles', profile))
}

initLog()
app.setAppUserModelId('com.alga.meet') // must match electron-builder appId (toasts, taskbar grouping)

const apiUrl = process.env.ALGA_API_URL ?? import.meta.env.MAIN_VITE_API_URL ?? 'http://localhost:4000'

function cpuVendorOf(model: string): AppConfig['cpuVendor'] {
  if (!model) return 'unknown'
  if (/intel/i.test(model)) return 'intel'
  if (/amd|ryzen|epyc/i.test(model)) return 'amd'
  if (/apple/i.test(model)) return 'apple'
  if (/qualcomm|snapdragon/i.test(model)) return 'qualcomm'
  return 'other'
}

const config: AppConfig = {
  apiUrl,
  gatewayUrl: apiUrl.replace(/^http/, 'ws') + '/gateway',
  version: app.getVersion(),
  profile,
  platform: process.platform,
  isPackaged: app.isPackaged,
  cpuVendor: cpuVendorOf(cpus()[0]?.model ?? ''),
  osVersion: osVersionLabel(process.platform, release()),
}

// Dev only, opt-in: route algameet:// to this checkout (and profile). Packaged builds are registered by the
// NSIS installer (build/installer.nsh). ALGA_REGISTER_PROTOCOL=0 removes the dev registration again.
if (!app.isPackaged && (process.env.ALGA_REGISTER_PROTOCOL === '1' || process.env.ALGA_REGISTER_PROTOCOL === '0')) {
  const args = [app.getAppPath(), ...(profile === 'default' ? [] : [`--profile=${profile}`])]
  const register = process.env.ALGA_REGISTER_PROTOCOL === '1'
  const ok = register
    ? app.setAsDefaultProtocolClient('algameet', process.execPath, args)
    : app.removeAsDefaultProtocolClient('algameet', process.execPath, args)
  log.info(`dev protocol ${register ? 'registration' : 'removal'}`, ok)
}

// Started by the login item: come up in the tray only.
const startHidden = process.argv.includes('--hidden')
const loginArgs = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']

function registerAppIpc(): void {
  ipcMain.on(IPC.config, (e) => {
    e.returnValue = isTrustedSender(e) ? config : null
  })
  handle(IPC.authGetToken, () => getToken())
  handle(IPC.authSetToken, async (t) => {
    const token = t === null ? null : str(t, 8192)
    await setToken(token)
    if (token) startE2ee(apiUrl, token)
    else stopE2ee()
  })
  handle(IPC.appGetStartAtLogin, () => app.getLoginItemSettings({ args: loginArgs }).openAtLogin)
  handle(IPC.appSetStartAtLogin, (v) => app.setLoginItemSettings({ openAtLogin: bool(v), args: loginArgs }))
  handle(IPC.appGetCloseToTray, () => getSettings().closeToTray)
  handle(IPC.appSetCloseToTray, (v) => updateSettings({ closeToTray: bool(v) }))
  handle(IPC.appGetTrayAnimation, () => getSettings().trayAnimation)
  handle(IPC.appSetTrayAnimation, (v) => setTrayAnimation(bool(v)))
  handle(IPC.appOpenExternal, async (u) => {
    const url = str(u, 4096)
    if (!isExternalWebUrl(url)) throw new TypeError('only http(s) URLs')
    await shell.openExternal(url)
  })
  handle(IPC.appOpenLogs, async () => {
    const err = await shell.openPath(logDir())
    if (err) log.warn('openLogs failed', err)
  })
  handle(IPC.appTakeSetupEco, () => takeSetupEco())
  on(IPC.appQuit, () => app.quit())
  registerWindowIpc()
  registerTrayIpc()
  registerHotkeyIpc()
  registerNotificationIpc()
  registerDeepLinkIpc()
  registerE2eeIpc()
  registerCinemaIpc()
  registerActivityIpc()
  registerFeedbackIpc()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    receiveDeepLink(argv)
    showMainWindow()
  })
  registerAppIpc()
  const launchedWithLink = receiveDeepLink(process.argv) // a link click always shows the window
  app.whenReady().then(() => {
    applySecurity()
    initCapture()
    trackDeepLinkPage(createMainWindow(profile === 'default' ? 'Alga Meet' : `Alga Meet (${profile})`, startHidden && !launchedWithLink))
    createTray()
    initPower()
    initUpdater()
    startActivity()
    void cleanupStale(cinemaRoot())
    // Signed in from a previous run: pre-warm E2EE now (the worker and key packages must be ready before a join).
    void getToken().then((t) => t && startE2ee(apiUrl, t))
  })
  app.on('before-quit', setQuitting)
  app.on('will-quit', () => {
    stopHotkeys() // the hook thread would otherwise keep the process alive
    stopE2ee()
    void closeAllCinema() // removes the temp pieces; leftovers of a hard kill are swept at next start
    stopActivity() // kills the helper process
    destroyTray()
    log.info('quit')
  })
  app.on('window-all-closed', () => app.quit())
  // E2E hook for scripts/verify-native.mjs (Playwright electronApp.evaluate); absent in normal runs.
  if (process.env.ALGA_E2E === '1') Object.assign(globalThis, { __alga: { trayState, require } })
}

/** The Eco dressed in the setup window while the app installed (native/setup-ui writes it next to our data). */
function takeSetupEco(): unknown {
  const file = join(app.getPath('userData'), 'setup-eco.json')
  try {
    const eco = (JSON.parse(readFileSync(file, 'utf8')) as { eco?: unknown }).eco ?? null
    rmSync(file, { force: true })
    return eco
  } catch {
    return null
  }
}
