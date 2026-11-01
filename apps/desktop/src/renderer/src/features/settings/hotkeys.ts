import type { HotkeyAction, HotkeyBinding } from '../../../../shared/bridge'

/** Global hotkeys live in main (low-level hook) but main does not persist them: the renderer owns the list. */
export interface SavedBinding extends HotkeyBinding {
  label: string
}

const KEY = 'alga.hotkeys.v1'
export const HOTKEY_ACTIONS: HotkeyAction[] = ['pushToTalk', 'toggleMute', 'toggleDeafen', 'pushToMute']

export function loadBindings(): SavedBinding[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (b): b is SavedBinding =>
        !!b && HOTKEY_ACTIONS.includes(b.action) && Array.isArray(b.keys) && Array.isArray(b.mouseButtons) && typeof b.label === 'string' && b.keys.length + b.mouseButtons.length > 0,
    )
  } catch {
    return []
  }
}

/** Persist and hand the list to main. Rejects if main refuses it (invalid chord): nothing is saved then. */
export async function saveBindings(list: SavedBinding[]): Promise<void> {
  await window.alga.hotkeys.set(list.map(({ action, keys, mouseButtons }) => ({ action, keys, mouseButtons })))
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable: bindings still work for this run */
  }
}

/** Boot: re-arm what the user configured last time. */
export function applySavedHotkeys(): void {
  const list = loadBindings()
  if (!list.length || !window.alga?.hotkeys) return
  window.alga.hotkeys.set(list.map(({ action, keys, mouseButtons }) => ({ action, keys, mouseButtons }))).catch((e: unknown) => console.warn('[hotkeys] could not apply saved bindings', e))
}
