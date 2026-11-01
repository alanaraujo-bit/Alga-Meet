/**
 * Contract between the renderer and the Electron main process.
 * Implemented in src/preload (exposed as `window.alga`), consumed by src/renderer.
 * Everything crossing this boundary must be structured-cloneable.
 */
import type { E2eeClientFrame } from '@alga/shared'

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
  /** Coarse CPU vendor class for opt-in call-quality telemetry (never the model string). */
  cpuVendor: 'intel' | 'amd' | 'apple' | 'qualcomm' | 'other' | 'unknown'
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

/**
 * A validated algameet:// link (e-mail verification, password reset, invite).
 * token/code are bearer secrets: post them to the API, never log or display them.
 */
export type DeepLink =
  | { kind: 'verify-email'; token: string }
  | { kind: 'password-reset'; token: string }
  | { kind: 'invite'; code: string }

// ---- E2EE of calls (docs/decisions/0004-e2ee.md; main side in src/main/mls) -------------------------------------

/**
 * Per-sender media key of one epoch, for LiveKit's key provider (BaseKeyProvider, sharedKey: false):
 * `onSetEncryptionKey(await createKeyMaterialFromBuffer(key.buffer), userId, keyIndex)`. Remote senders' keys come as
 * soon as the epoch is installed; ours (`self`) only when the DS says everyone has the epoch, which is the moment to
 * start sending with it. 32 bytes; never log or persist it.
 */
export interface E2eeFrameKey {
  channelId: string
  /** LiveKit participant identity. */
  userId: string
  epoch: number
  /** epoch % 16 (LiveKit keyring slot). */
  keyIndex: number
  key: Uint8Array
  self: boolean
}

export interface E2eeMember {
  userId: string
  deviceId: string
  self: boolean
}

export type E2eeCallState = 'joining' | 'active' | 'removed' | 'failed'

/**
 * `active`: we send with `keyIndex` from now on; `members` is the MLS group (0004 §3.8: compare with the LiveKit room,
 * never trust a server-provided list). `removed`: the DS took us out (kick, ban, move). `failed`: E2EE could not be
 * set up for this call (`reason`: forbidden | unavailable | resync_limit); do not publish as if encrypted.
 */
export interface E2eeEpochInfo {
  channelId: string
  state: Exclude<E2eeCallState, 'joining'>
  epoch: number
  keyIndex: number
  members: E2eeMember[]
  reason?: string
}

export interface E2eeStatus {
  /** off: disabled in this build (packaged without ALGA_E2EE=1) or signed out. */
  state: 'off' | 'starting' | 'ready' | 'error'
  deviceId: string | null
  /** false: no DPAPI, the device identity lives for this run only (verification codes change on restart). */
  persistent: boolean
  call: { channelId: string; state: E2eeCallState; epoch: number } | null
}

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

  deepLinks: {
    /** Links opened while the app is running. Subscribe first, then call takePending(). */
    onLink(cb: (l: DeepLink) => void): Unsubscribe
    /**
     * The link the app was started with (or that arrived before the page was ready), once; null if none.
     * Calling it tells main the page is listening: later links are pushed to onLink instead.
     */
    takePending(): Promise<DeepLink | null>
  }

  /**
   * MLS for calls. The renderer relays gateway frames and installs frame keys; it never sees MLS state or the device's
   * identity key (they stay in the "alga-e2ee" utilityProcess). One call at a time.
   */
  e2ee: {
    status(): Promise<E2eeStatus>
    /**
     * Joins the call's MLS group (right after POST /voice/join, in parallel with LiveKit). Call it again with the same
     * channel after every gateway READY: it re-announces our epoch so the DS resends what we missed.
     */
    joinCall(channelId: string): Promise<void>
    leaveCall(channelId: string): Promise<void>
    /** Every E2EE_* gateway dispatch, unchanged. */
    handleDispatch(t: string, d: unknown): void
    /** e2ee_* frames to send on the gateway socket, as they are. */
    onGatewaySend(cb: (frame: E2eeClientFrame) => void): Unsubscribe
    onFrameKey(cb: (k: E2eeFrameKey) => void): Unsubscribe
    onEpoch(cb: (e: E2eeEpochInfo) => void): Unsubscribe
    /** Call code (30 digits, the same for everyone in the call) or, with `userId`, the pairwise code (45 digits). */
    verificationCode(channelId: string, userId?: string): Promise<string | null>
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
