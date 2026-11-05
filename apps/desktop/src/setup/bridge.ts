/**
 * The page side of the setup window (native/setup-ui). The Rust host injects `window.__SETUP__` before the page
 * loads, pushes progress with `window.__setupEmit(...)` and receives our messages through `window.ipc.postMessage`.
 * Opened in a plain browser (no host), the page runs a demo of the chosen mode (`?mode=install|update|uninstall`),
 * which is how its screens are reviewed.
 */
import type { EcoSpec } from '@alga/shared'

export type Mode = 'install' | 'update' | 'uninstall'
/** preparing: closing a running app / removing the old version; files: writing the new ones; finishing: shortcuts. */
export type Phase = 'preparing' | 'files' | 'finishing'

export type HostEvent =
  | { type: 'progress'; p: number; phase: Phase }
  | { type: 'done'; ok: boolean }

export type PageMessage =
  | { type: 'ready' }
  | { type: 'drag' }
  | { type: 'minimize' }
  | { type: 'close' }
  | { type: 'eco'; eco: EcoSpec | null }
  | { type: 'open' }
  | { type: 'retry' }
  | { type: 'uninstall'; deleteData: boolean }

interface Boot {
  mode: Mode
  version: string
}

declare global {
  interface Window {
    __SETUP__?: Boot
    ipc?: { postMessage(message: string): void }
    __setupEmit?: (e: HostEvent) => void
  }
}

const query = new URLSearchParams(location.search)
export const live = !!window.ipc
/** Browser demo only: `?hold=1` freezes the opening (no timers), to review it frame by frame. */
export const hold = !live && query.has('hold')
export const boot: Boot = window.__SETUP__ ?? { mode: (query.get('mode') as Mode | null) ?? 'install', version: '0.1.7' }

export function send(message: PageMessage): void {
  if (window.ipc) window.ipc.postMessage(JSON.stringify(message))
  else console.info('[setup]', message)
}

const listeners = new Set<(e: HostEvent) => void>()
window.__setupEmit = (e) => listeners.forEach((l) => l(e))

export function onHost(listener: (e: HostEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Browser demo: a believable run of the current mode (?fail=1 ends in an error). */
export function startDemo(mode: Mode): void {
  if (live || hold) return
  const steps: [number, HostEvent][] =
    mode === 'uninstall'
      ? [[300, { type: 'progress', p: 0.15, phase: 'preparing' }], [900, { type: 'progress', p: 0.6, phase: 'files' }], [1500, { type: 'progress', p: 0.95, phase: 'finishing' }]]
      : [
          [1600, { type: 'progress', p: 0.04, phase: 'files' }],
          [3200, { type: 'progress', p: 0.38, phase: 'files' }],
          [5200, { type: 'progress', p: 0.71, phase: 'files' }],
          [6800, { type: 'progress', p: 0.92, phase: 'finishing' }],
        ]
  const end = mode === 'uninstall' ? 2200 : 8000
  for (const [at, e] of steps) setTimeout(() => window.__setupEmit?.(e), at)
  setTimeout(() => window.__setupEmit?.({ type: 'done', ok: query.get('fail') !== '1' }), end)
}
