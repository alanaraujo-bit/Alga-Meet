// End-to-end check of the native shell (main + preload + bridge) against the BUILT app.
//   npx electron-vite build && node scripts/verify-native.mjs [screenshot.png]
// Uses an isolated profile (userData/profiles/e2e-native), deleted at the end.
// Note: the hotkey checks inject real F13/Esc key presses through SendInput (harmless in normal apps).
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const shotPath = process.argv[2] ?? join(appDir, '..', '..', 'docs', 'screenshots', '2026-11-01-native-shell.png')
const PROFILE = 'e2e-native'
// API pointed at a closed port: the renderer must not reach a real server (it would reject the
// fake token and sign out, clearing it, which is correct app behaviour but not what we test here).
const env = { ...process.env, ALGA_E2E: '1', ALGA_API_URL: 'http://127.0.0.1:9' }
delete env.ELECTRON_RENDERER_URL

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

async function launch(extraArgs = []) {
  const app = await electron.launch({ args: ['.', `--profile=${PROFILE}`, ...extraArgs], cwd: appDir, env })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.alga?.config)
  return { app, page }
}
const hook = (app, fn, arg) => app.evaluate(fn, arg)
// Synthesize real input via uiohook (SendInput). Deferred to the event loop: N-API calls made directly
// from Playwright's evaluate (inspector) context fail with "Error in native callback".
const press = (app, key, phase) =>
  app.evaluate(
    (_e, [k, p]) => {
      setImmediate(() => {
        const { uIOhook } = globalThis.__alga.require('uiohook-napi')
        if (p) uIOhook.keyToggle(k, p)
        else uIOhook.keyTap(k)
      })
    },
    [key, phase],
  )

/** Real OS screenshot of the window rect (Playwright's capture would miss the native caption buttons). */
async function osScreenshot(app, file) {
  const r = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(true, 'screen-saver') // above other topmost windows (e.g. test patterns)
    w.show()
    w.focus()
    return screen.dipToScreenRect(w, w.getBounds())
  })
  await sleep(700)
  mkdirSync(dirname(file), { recursive: true })
  const ps = `Add-Type -AssemblyName System.Drawing
Add-Type 'using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[D]::SetProcessDPIAware() | Out-Null
$b = New-Object System.Drawing.Bitmap ${r.width}, ${r.height}
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(${r.x}, ${r.y}, 0, 0, $b.Size)
$b.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  // Occlusion check: the OS capture must match the renderer's own frame in the page area (below the caption bar).
  const occluded = await app.evaluate(async ({ BrowserWindow, nativeImage }, path) => {
    const w = BrowserWindow.getAllWindows()[0]
    const page = (await w.webContents.capturePage()).resize({ width: 64 })
    const os = nativeImage.createFromPath(path).resize({ width: 64 })
    const a = page.toBitmap()
    const b = os.toBitmap()
    const rowStart = 16 * 64 * 4 // skip the top rows (caption buttons exist only in the OS capture)
    let diff = 0
    for (let i = rowStart; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i] - b[i])
    w.setAlwaysOnTop(false)
    return diff / (Math.min(a.length, b.length) - rowStart) > 12
  }, file)
  return { ...r, occluded }
}

// ---------- run 1 ----------
let { app, page } = await launch()
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
if (!userData.endsWith(join('profiles', PROFILE))) throw new Error(`refusing to run outside the e2e profile: ${userData}`)
const appUrl = page.url()

const cfg = await page.evaluate(() => window.alga.config)
check('bridge config', cfg.profile === PROFILE && cfg.platform === 'win32' && cfg.isPackaged === false && cfg.apiUrl === env.ALGA_API_URL, cfg)
check('config.osVersion is a friendly Windows name (X-Alga-Client)', /^Windows (10|11)$/.test(cfg.osVersion), cfg.osVersion)
const ua = await page.evaluate(() => navigator.userAgent)
check('user agent carries "AlgaMeet/<version>" (server fallback label)', ua.includes(`AlgaMeet/${cfg.version}`), ua)

const tray = await hook(app, () => globalThis.__alga.trayState())
check('tray exists (idle)', tray.exists && !tray.voice.connected, tray)
await page.evaluate(() => window.alga.tray.setVoiceState({ connected: true, muted: true, deafened: false, channelName: 'Geral' }))
await sleep(150)
const tray2 = await hook(app, () => globalThis.__alga.trayState())
check('tray reflects voice state', tray2.voice.connected && tray2.voice.muted && tray2.voice.channelName === 'Geral', tray2.voice)
await page.evaluate(() => window.alga.tray.setVoiceState({ connected: false, muted: false, deafened: false }))

// Tray breathing: a 250 ms frame timer only while in voice with mic and audio on; none otherwise.
// (Each frame is one tray.setImage, ~0.2 ms on the main thread: under 1 ms per second while it runs.)
const reducedMotion = await hook(app, ({ systemPreferences }) => systemPreferences.getAnimationSettings().prefersReducedMotion)
const voiceState = (s) => page.evaluate((v) => window.alga.tray.setVoiceState(v), s)
const framesOver = async (ms) => {
  const t0 = (await hook(app, () => globalThis.__alga.trayState())).ticks
  await sleep(ms)
  return (await hook(app, () => globalThis.__alga.trayState())).ticks - t0
}
await voiceState({ connected: true, muted: false, deafened: false, channelName: 'Geral' })
const breathing = await framesOver(2000)
await voiceState({ connected: true, muted: true, deafened: false, channelName: 'Geral' })
const mutedTray = await hook(app, () => globalThis.__alga.trayState())
const still = await framesOver(1000)
check(
  'tray breathes in voice (~4 frames/s), stops when muted',
  reducedMotion ? breathing === 0 : breathing >= 6 && breathing <= 10 && !mutedTray.animating && still === 0,
  { reducedMotion, framesIn2s: breathing, framesMuted1s: still },
)
await voiceState({ connected: true, muted: false, deafened: false })
await page.evaluate(() => window.alga.app.setTrayAnimation(false))
const off = await hook(app, () => globalThis.__alga.trayState())
check('trayAnimation setting off: no timer even in voice', !off.animating && (await page.evaluate(() => window.alga.app.getTrayAnimation())) === false, off)
await page.evaluate(() => window.alga.app.setTrayAnimation(true))
await voiceState({ connected: false, muted: false, deafened: false })
check('out of voice: no timer', !(await hook(app, () => globalThis.__alga.trayState())).animating)

const zoomOf = () => hook(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
const zoom0 = await page.evaluate(() => window.alga.window.zoom.get())
await page.evaluate(() => window.alga.window.zoom.set(9))
const zoomHigh = [await page.evaluate(() => window.alga.window.zoom.get()), await zoomOf()]
await page.evaluate(() => window.alga.window.zoom.set(0.1))
const zoomLow = await zoomOf()
const zoomBad = await page.evaluate(() => window.alga.window.zoom.set('big').then(() => 'resolved', () => 'rejected'))
check('window.zoom: default 1, clamped to 0.8..1.5, applied at once, junk rejected', zoom0 === 1 && zoomHigh[0] === 1.5 && zoomHigh[1] === 1.5 && zoomLow === 0.8 && zoomBad === 'rejected', {
  zoom0, zoomHigh, zoomLow, zoomBad,
})
await page.evaluate(() => window.alga.window.zoom.set(1.25))
await page.reload()
await page.waitForFunction(() => !!window.alga?.config)
check('zoom survives a renderer reload', (await zoomOf()) === 1.25, await zoomOf())
await page.evaluate(() => window.alga.window.zoom.set(1)) // the OS screenshot below is at 100 %

const enc = await hook(app, async ({ safeStorage }) => ({
  available: await safeStorage.isAsyncEncryptionAvailable(),
  roundTrip: (await safeStorage.decryptStringAsync(await safeStorage.encryptStringAsync('alga-e2e'))).result === 'alga-e2e',
}))
check('safeStorage async (DPAPI) available + round-trip in main', enc.available && enc.roundTrip, enc)
// A session.bin written by the old sync encryptString (before the async migration) must still load.
const legacy = `legacy-${randomUUID()}`
await hook(
  app,
  ({ safeStorage }, [file, t]) => globalThis.__alga.require('node:fs').writeFileSync(file, safeStorage.encryptString(t)),
  [join(userData, 'session.bin'), legacy],
)
check('token stored by the legacy sync API still decrypts', (await page.evaluate(() => window.alga.auth.getToken())) === legacy)
const token = `e2e-${randomUUID()}`
await page.evaluate((t) => window.alga.auth.setToken(t), token)
const tokenBack = await page.evaluate(() => window.alga.auth.getToken())
const onDisk = readFileSync(join(userData, 'session.bin'))
check('token round-trips via bridge, ciphertext on disk', tokenBack === token && !onDisk.includes(Buffer.from(token)), {
  bytesOnDisk: onDisk.length,
  plaintextOnDisk: onDisk.includes(Buffer.from(token)),
})

await page.evaluate(() => window.alga.app.setCloseToTray(false))
await hook(app, ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.unmaximize()
  w.setBounds({ x: 120, y: 90, width: 1180, height: 760 })
})
await sleep(900) // bounds save is debounced

const sources = await page.evaluate(() => window.alga.screen.getSources(['window', 'screen']))
check(
  'screen.getSources: screens first, PNG thumbnails, window icons',
  sources.length > 0 && sources[0].kind === 'screen' && sources[0].thumbnail.startsWith('data:image/png'),
  { count: sources.length, first: sources.slice(0, 4).map((s) => `${s.kind}:${s.name}${s.appIcon ? ' [icon]' : ''}`) },
)
const thumb = await page.evaluate(async (url) => {
  const i = new Image()
  i.src = url
  await i.decode()
  return [i.naturalWidth, i.naturalHeight]
}, sources[0].thumbnail)
check('thumbnail ~640 px wide (capture.ts)', thumb[0] > 320 && thumb[0] <= 640, thumb)

const gdm = (constraints) =>
  page.evaluate(
    (c) =>
      navigator.mediaDevices.getDisplayMedia(c).then(
        (s) => {
          const r = { video: s.getVideoTracks().length, audio: s.getAudioTracks().map((t) => t.getSettings().deviceId) }
          s.getTracks().forEach((t) => t.stop())
          return r
        },
        (e) => e.name,
      ),
    constraints,
  )
check('getDisplayMedia denied without a user selection', typeof (await gdm({ video: true })) === 'string')
await page.evaluate((id) => window.alga.screen.select(id, { audio: true }), sources[0].id)
const granted = await gdm({ video: true, audio: { restrictOwnAudio: true } })
check('selected source served, loopback excludes our own audio', granted.video === 1 && granted.audio[0] === 'loopbackWithoutChrome', granted)
check('selection is one-shot', typeof (await gdm({ video: true })) === 'string')

const perms = await page.evaluate(async () =>
  Object.fromEntries(
    await Promise.all(['notifications', 'geolocation', 'midi', 'camera'].map(async (n) => [n, (await navigator.permissions.query({ name: n })).state])),
  ),
)
check('permissions: notifications granted, geolocation/midi denied', perms.notifications === 'granted' && perms.geolocation === 'denied' && perms.midi === 'denied', perms)

await page.evaluate(() => {
  location.href = 'file:///C:/Windows/win.ini'
})
await sleep(600)
check('navigation away from the app is blocked', page.url() === appUrl, page.url())

const label = await page.evaluate(() => window.alga.hotkeys.label({ keys: [29, 50], mouseButtons: [] }))
check('hotkeys.label', label === 'Ctrl + M', label)
const F13 = 91
const recording = page.evaluate(() => window.alga.hotkeys.record())
await sleep(400)
await press(app, F13)
const rec = await recording
check('hotkeys.record captures a real key press through the global hook', rec?.label === 'F13' && rec.keys[0] === F13, rec)
const cancel = page.evaluate(() => window.alga.hotkeys.record())
await sleep(400)
await press(app, 1) // Esc
check('hotkeys.record: Esc cancels', (await cancel) === null)

await page.evaluate((k) => {
  window.__hk = []
  window.alga.hotkeys.onEvent((e) => window.__hk.push(e))
  return window.alga.hotkeys.set([{ action: 'pushToTalk', keys: [k], mouseButtons: [] }])
}, F13)
await sleep(300)
await press(app, F13, 'down')
await sleep(200)
await press(app, F13, 'up')
await sleep(200)
const events = await page.evaluate(() => window.__hk)
check(
  'push-to-talk: down then up from the global hook',
  JSON.stringify(events) === JSON.stringify([{ action: 'pushToTalk', phase: 'down' }, { action: 'pushToTalk', phase: 'up' }]),
  events,
)
await page.evaluate(() => window.alga.hotkeys.set([]))

const upd = await page.evaluate(() => window.alga.updates.check())
check('updates disabled when not packaged', upd.state === 'disabled', upd)

await page.evaluate(() => window.alga.window.setBadge(3))
let rect
for (let i = 0; i < 5 && (!rect || rect.occluded); i++) rect = await osScreenshot(app, shotPath)
check('OS screenshot of the window (native caption buttons), not occluded', existsSync(shotPath) && !rect.occluded, { file: shotPath, rect })
await page.evaluate(() => window.alga.window.setBadge(0))
await page.evaluate(() => window.alga.window.zoom.set(1.1))
await app.close()

// ---------- run 2: persistence ----------
;({ app, page } = await launch())
const closeToTray = await page.evaluate(() => window.alga.app.getCloseToTray())
const bounds = await hook(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
check('settings persist across restart (closeToTray, bounds)', closeToTray === false && bounds.x === 120 && bounds.width === 1180, { closeToTray, bounds })
const zoomBack = [await page.evaluate(() => window.alga.window.zoom.get()), await hook(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())]
check('zoom persists per profile and is applied when the window opens', zoomBack[0] === 1.1 && zoomBack[1] === 1.1, zoomBack)
check('token survives restart', (await page.evaluate(() => window.alga.auth.getToken())) === token)
await page.evaluate(() => window.alga.auth.setToken(null))
check('setToken(null) deletes the file', !existsSync(join(userData, 'session.bin')))
const log = readFileSync(join(userData, 'logs', 'main.log'), 'utf8')
check('main log written, no IPC rejections', log.includes(' INFO start v') && !/rejected|untrusted/.test(log), log.split('\n').length - 1 + ' lines')
await app.close()

// ---------- run 3: algameet:// deep links ----------
const T = randomBytes(32).toString('base64url') // same shape as the server's e-mail tokens
;({ app, page } = await launch(['--hidden', `algameet://auth/verify-email?token=${T}`]))
const win = () =>
  hook(app, ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { visible: w.isVisible(), minimized: w.isMinimized(), focused: w.isFocused() }
  })
for (let i = 0; i < 20 && !(await win()).visible; i++) await sleep(100)
await page.evaluate(() => {
  window.__links = []
  window.alga.deepLinks.onLink((l) => window.__links.push(l))
})
const cold = await page.evaluate(() => window.alga.deepLinks.takePending())
const coldWin = await win()
check('cold start: argv link is pending and overrides --hidden', cold?.kind === 'verify-email' && cold.token === T && coldWin.visible, {
  kind: cold?.kind,
  tokenMatches: cold?.token === T,
  ...coldWin,
})
check('takePending is one-shot', (await page.evaluate(() => window.alga.deepLinks.takePending())) === null)

/** A real second process with the link as its last argument, exactly like Windows' "%1" launch. */
const secondInstance = (link) =>
  new Promise((resolve) => {
    const p = spawn(electronPath, ['.', `--profile=${PROFILE}`, link], { cwd: appDir, env, stdio: 'ignore' })
    const t = setTimeout(() => p.kill(), 15000)
    p.on("exit", (code) => {
      clearTimeout(t)
      resolve(code)
    })
  })
await hook(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
await sleep(300)
const exit = await secondInstance('algameet://invite/Ab3dE6gH')
await page.waitForFunction(() => window.__links.length > 0, null, { timeout: 5000 }).catch(() => {})
const live = await page.evaluate(() => window.__links)
const liveWin = await win()
check(
  'second instance: link pushed to onLink, window restored and focused',
  exit === 0 && JSON.stringify(live) === JSON.stringify([{ kind: 'invite', code: 'Ab3dE6gH' }]) && liveWin.visible && !liveWin.minimized && liveWin.focused,
  { exit, live, ...liveWin },
)
await secondInstance(`algameet://auth/verify-email?token=${T}&next=https://evil.example`)
await secondInstance('algameet://invite/../auth/x')
await sleep(500)
const dlLog = readFileSync(join(userData, 'logs', 'main.log'), 'utf8')
check(
  'malformed links are dropped and logged without their secret',
  (await page.evaluate(() => window.__links.length)) === 1 &&
    (dlLog.match(/deep link rejected/g) ?? []).length === 2 &&
    !dlLog.includes(T) &&
    !dlLog.includes('Ab3dE6gH'),
  dlLog.split('\n').filter((l) => l.includes('deep link')),
)
await app.close()

rmSync(userData, { recursive: true, force: true })
console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
process.exit(failures ? 1 : 0)
