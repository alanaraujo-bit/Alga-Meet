import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { log } from './log'
import { isAppUrl } from './security'

/** Only the top frame of our own renderer page may talk to main. */
export function isTrustedSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  const ok = !!frame && frame.parent === null && isAppUrl(frame.url)
  // An empty URL is the window's initial blank document running the preload: expected, not worth a warning.
  if (!ok && frame?.url) log.warn('ipc from untrusted sender rejected', frame.url)
  return ok
}

/** invoke handler: untrusted senders and invalid payloads reject the renderer's promise. */
export function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error('forbidden')
    return fn(...args)
  })
}

/** send handler: fire-and-forget, so invalid input is logged and dropped. */
export function on(channel: string, fn: (...args: unknown[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!isTrustedSender(e)) return
    try {
      fn(...args)
    } catch (err) {
      log.warn(`ipc ${channel} rejected`, err)
    }
  })
}

/** Push an event to the renderer. */
export function emit(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}

// Payload validators: throw on anything that is not the exact plain shape expected.
export function str(v: unknown, max = 2048): string {
  if (typeof v !== 'string' || v.length > max) throw new TypeError('expected string')
  return v
}
export function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new TypeError('expected boolean')
  return v
}
export function int(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new TypeError(`expected integer ${min}..${max}`)
  return v
}
export function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('expected object')
  return v as Record<string, unknown>
}
export function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new TypeError(`expected array (max ${max})`)
  return v
}
