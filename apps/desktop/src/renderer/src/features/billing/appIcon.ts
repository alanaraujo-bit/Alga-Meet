/*
 * The equipped app icon (Me.cosmetics.appIcon, HA-26…28) on the real window, taskbar and tray. Applying it is the main
 * process's job (BrowserWindow.setIcon + the tray image, from hand-fitted ICOs), through an IPC that does not exist
 * yet. The renderer side is ready: it calls `window.alga.app.setIcon(id | null)` whenever the equipped icon changes
 * (and on start), if the bridge has it; until then the choice is saved on the account and shown in the store only.
 *
 * IPC needed (src/shared/bridge.ts → AlgaBridge.app, src/preload, src/main):
 *   setIcon(id: 'icon_ha_noite' | 'icon_ha_porcelana' | 'icon_ha_crepusculo' | null): Promise<void>
 *   main: reject anything off that list; null = the default icon. Load build/runtime/icon-<id>.ico (16–256 px, the
 *   16–32 px frames from mark-16…32.svg), win.setIcon(img) on every window, tray.setImage with the same art at tray
 *   DPI, keep the choice for the next launch (settings.json) so the first frame already shows it.
 */
export const APP_ICONS = ['icon_ha_noite', 'icon_ha_porcelana', 'icon_ha_crepusculo'] as const

type IconBridge = { setIcon?: (id: string | null) => Promise<void> }
const bridge = () => (window.alga?.app as IconBridge | undefined)?.setIcon

/** True once the main process exposes the IPC (the store says "next version" until then). */
export const canSetAppIcon = () => typeof bridge() === 'function'

let applied: string | null | undefined
export function applyAppIcon(id: string | null | undefined): void {
  const next = id && (APP_ICONS as readonly string[]).includes(id) ? id : null
  if (next === applied) return
  applied = next
  void bridge()?.(next)?.catch(() => undefined)
}
