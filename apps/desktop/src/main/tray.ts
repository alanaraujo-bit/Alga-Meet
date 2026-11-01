import { Menu, Tray, app, nativeImage } from 'electron'
import type { TrayAction } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { assetPath } from './assets'
import { bool, emit, obj, on, str } from './ipc'
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
const icon = (state: 'idle' | 'connected' | 'muted') => {
  if (!icons.has(state)) icons.set(state, nativeImage.createFromPath(assetPath(`tray-${state}.png`)))
  return icons.get(state)!
}

const action = (a: TrayAction) => () => emit(IPC.trayAction, a)

function render(): void {
  if (!tray) return
  const state = voice.muted || voice.deafened ? 'muted' : voice.connected ? 'connected' : 'idle'
  tray.setImage(icon(state))
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
}

/** Read-only view for diagnostics/tests. */
export const trayState = () => ({ exists: !!tray && !tray.isDestroyed(), voice: { ...voice } })

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
