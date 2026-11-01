// Pure helpers for UI zoom, the tray breathing animation and the OS label (tested in native-logic.test.ts).

export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.5

/** Renderer zoom factor clamped to ZOOM_MIN..ZOOM_MAX (2 decimals); throws on anything but a finite number. */
export function clampZoom(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('expected a finite number')
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) * 100) / 100
}

/** Tray frames while in voice, one per TRAY_FRAME_MS (build/runtime/tray-<frame>.png, scripts/brand.mjs). */
export const TRAY_BREATH = ['connected', 'breathe-1', 'breathe-2', 'breathe-1'] as const
export const TRAY_FRAME_MS = 250

/** Breathe only while someone can hear you: in voice, mic and audio on, and neither the setting nor the OS says no. */
export const trayAnimates = (v: { connected: boolean; muted: boolean; deafened: boolean }, enabled: boolean, reducedMotion: boolean) =>
  v.connected && !v.muted && !v.deafened && enabled && !reducedMotion

/** Friendly OS name for AppConfig.osVersion / X-Alga-Client, from process.platform and os.release(). */
export function osVersionLabel(platform: string, release: string): string {
  const [major = 0, , build = 0] = release.split('.').map((n) => parseInt(n, 10) || 0)
  if (platform === 'win32') return major === 10 ? (build >= 22000 ? 'Windows 11' : 'Windows 10') : 'Windows'
  if (platform === 'darwin') return major >= 20 ? `macOS ${major - 9}` : 'macOS' // Darwin 20 = macOS 11
  return platform === 'linux' ? 'Linux' : platform
}
