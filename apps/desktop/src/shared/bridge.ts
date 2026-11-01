/**
 * Contract between the renderer and the Electron main process.
 * Implemented in src/preload (exposed as `window.alga`), consumed by src/renderer.
 * Everything crossing this boundary must be structured-cloneable.
 */

export type Unsubscribe = () => void

export interface AppConfig {
  /** REST base, e.g. http://localhost:4000 (renderer appends /api/v1). */
  apiUrl: string
  /** Gateway WebSocket URL, e.g. ws://localhost:4000/gateway. */
  gatewayUrl: string
  version: string
  /** Dev multi-instance profile name ("default" in normal use). */
  profile: string
  platform: NodeJS.Platform
  isPackaged: boolean
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL of a thumbnail. */
  thumbnail: string
  /** PNG data URL of the app icon (windows only). */
  appIcon: string | null
  /** Electron display id for screens. */
  displayId: string | null
}

/** A global hotkey: uiohook keycodes and/or mouse buttons pressed together. */
export interface HotkeyBinding {
  action: HotkeyAction
  keys: number[]
  /** uiohook mouse button numbers (4/5 = side buttons). */
  mouseButtons: number[]
}
export type HotkeyAction = 'pushToTalk' | 'toggleMute' | 'toggleDeafen' | 'pushToMute'
export interface HotkeyEvent {
  action: HotkeyAction
  phase: 'down' | 'up'
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'none' }
  | { state: 'error'; message: string }
  | { state: 'disabled'; reason: string }

export type TrayAction = 'toggleMute' | 'toggleDeafen' | 'disconnect'

export interface AlgaBridge {
  config: AppConfig

  auth: {
    /** Session token, encrypted at rest with Windows DPAPI (safeStorage). */
    getToken(): Promise<string | null>
    setToken(token: string | null): Promise<void>
  }

  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe
    onFocusChange(cb: (focused: boolean) => void): Unsubscribe
    /** Taskbar overlay badge with unread mention count (0 clears). */
    setBadge(count: number): void
    flashFrame(): void
  }

  screen: {
    getSources(types: Array<'screen' | 'window'>): Promise<CaptureSource[]>
    /**
     * Pre-select what the next getDisplayMedia() call returns. Must be followed by
     * getDisplayMedia() within 10 s; the selection is consumed by that one call (no selection = denied).
     * audio=true captures system audio (loopback). Always request it as
     * `getDisplayMedia({ video, audio: { restrictOwnAudio: true } })`: that excludes Alga Meet's own
     * output (the voice call) from the loopback, otherwise viewers hear the call echoed back.
     * See docs/decisions/0002-screen-audio-capture.md.
     */
    select(sourceId: string, opts: { audio: boolean }): Promise<void>
  }

  hotkeys: {
    set(bindings: HotkeyBinding[]): Promise<void>
    /** Resolves with the next key/mouse combo the user presses (Esc cancels -> null). */
    record(): Promise<{ keys: number[]; mouseButtons: number[]; label: string } | null>
    onEvent(cb: (e: HotkeyEvent) => void): Unsubscribe
    /** Human label for a binding, e.g. "Ctrl + M" or "Mouse 4". */
    label(binding: Pick<HotkeyBinding, 'keys' | 'mouseButtons'>): Promise<string>
  }

  notify(opts: { title: string; body: string; tag?: string; silent?: boolean }): void
  onNotificationClick(cb: (tag: string | undefined) => void): Unsubscribe

  tray: {
    setVoiceState(s: { connected: boolean; muted: boolean; deafened: boolean; channelName?: string }): void
    onAction(cb: (a: TrayAction) => void): Unsubscribe
  }

  power: {
    onSuspend(cb: () => void): Unsubscribe
    onResume(cb: () => void): Unsubscribe
  }

  updates: {
    check(): Promise<UpdateStatus>
    onStatus(cb: (s: UpdateStatus) => void): Unsubscribe
    /** Quit and install a downloaded update. */
    install(): void
  }

  app: {
    getStartAtLogin(): Promise<boolean>
    setStartAtLogin(enabled: boolean): Promise<void>
    getCloseToTray(): Promise<boolean>
    setCloseToTray(enabled: boolean): Promise<void>
    openExternal(url: string): Promise<void>
    /** Opens the logs folder in Explorer. */
    openLogs(): Promise<void>
    quit(): void
  }
}

declare global {
  interface Window {
    alga: AlgaBridge
  }
}
