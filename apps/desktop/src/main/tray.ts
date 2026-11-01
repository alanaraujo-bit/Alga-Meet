import { Menu, Tray, app, nativeImage, systemPreferences } from 'electron'
import type { TrayAction } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { assetPath } from './assets'
import { bool, emit, obj, on, str } from './ipc'
import { getSettings, updateSettings } from './settings'
import { TRAY_BREATH, TRAY_FRAME_MS, trayAnimates } from './ui-logic'
import { showMainWindow } from './window'

interface VoiceState {
  connected: boolean
  muted: boolean
  deafened: boolean
  channelName?: string
}

let tray: Tray | null = null
let voice: VoiceState = { connected: false, muted: false, deafened: false }
// createFromPath picks tray-x@1.25x/@1.5x/@2x/@2.5x.png for the current DPI automatically.
const icons = new Map<string, Electron.NativeImage>()
const icon = (state: 'idle' | 'muted' | (typeof TRAY_BREATH)[number]) => {
  if (!icons.has(state)) icons.set(state, nativeImage.createFromPath(assetPath(`tray-${state}.png`)))
  return icons.get(state)!
}

const action = (a: TrayAction) => () => emit(IPC.trayAction, a)

// Breathing: a 250 ms interval that exists only while trayAnimates(); idle, muted or out of voice there is no timer.
let breath: NodeJS.Timeout | null = null
let ticks = 0
function animate(): void {
  const want = !!tray && trayAnimates(voice, getSettings().trayAnimation, systemPreferences.getAnimationSettings().prefersReducedMotion)
  if (want === !!breath) return
  if (breath) clearInterval(breath)
  breath = null
  if (!want) return
  let frame = 0
  breath = setInterval(() => {
    frame = (frame + 1) % TRAY_BREATH.length
    ticks++
    tray?.setImage(icon(TRAY_BREATH[frame]!))
  }, TRAY_FRAME_MS)
}

function render(): void {
  if (!tray) return
  const state = voice.muted || voice.deafened ? 'muted' : voice.connected ? 'connected' : 'idle'
  tray.setImage(icon(state))
  animate()
  const where = voice.connected ? ` — ${voice.channelName || 'em voz'}` : ''
  const flags = voice.deafened ? ' (áudio desativado)' : voice.muted ? ' (microfone silenciado)' : ''
  tray.setToolTip(`Alga Meet${where}${flags}`.slice(0, 127)) // Windows tooltip limit
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Alga Meet', click: showMainWindow },
      { type: 'separator' },
      { label: voice.muted ? 'Ativar microfone' : 'Silenciar microfone', click: action('toggleMute') },
      { label: voice.deafened ? 'Ativar áudio' : 'Desativar áudio', click: action('toggleDeafen') },
      { label: 'Desconectar da voz', enabled: voice.connected, click: action('disconnect') },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ]),
  )
}

export function createTray(): Tray {
  tray = new Tray(icon('idle'))
  tray.on('click', showMainWindow)
  render()
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  animate()
}

export function setTrayAnimation(enabled: boolean): void {
  updateSettings({ trayAnimation: enabled })
  render()
}

/** Read-only view for diagnostics/tests. */
export const trayState = () => ({ exists: !!tray && !tray.isDestroyed(), voice: { ...voice }, animating: !!breath, ticks })

export function registerTrayIpc(): void {
  on(IPC.traySetVoiceState, (raw) => {
    const s = obj(raw)
    voice = {
      connected: bool(s.connected),
      muted: bool(s.muted),
      deafened: bool(s.deafened),
      ...(s.channelName === undefined ? {} : { channelName: str(s.channelName, 100) }),
    }
    render()
  })
}
