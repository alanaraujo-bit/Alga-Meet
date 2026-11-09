/**
 * What the feedback card ("Conta pro Eco", renderer features/feedback) needs from main: the end of the app log, a
 * picture of the window, and the note a session leaves when it ends badly so the next one can ask what happened.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { FeedbackCrashKind } from '@alga/shared'
import { IPC } from '../shared/ipc'
import { clearMarker, countsAsCrash, previousSession, tailLog, takeMarker, writeMarker } from './feedback-logic'
import { bool, handle, isTrustedSender } from './ipc'
import { log, logDir } from './log'

const markerFile = () => join(app.getPath('userData'), 'crash-marker.json')

function markCrash(kind: FeedbackCrashKind): void {
  writeMarker(markerFile(), { kind, at: Date.now(), version: app.getVersion(), pid: process.pid })
}

/** shortcut: reads main.log only; a session that rotated the file mid-run loses its older lines, read main.log.1 too if reports arrive truncated. */
function recentLog(previous: boolean): string {
  let text: string
  try {
    text = readFileSync(join(logDir(), 'main.log'), 'utf8')
  } catch {
    return ''
  }
  return tailLog(previous ? previousSession(text) : text)
}

export function registerFeedbackIpc(): void {
  handle(IPC.appRecentLog, (previous) => recentLog(bool(previous)))
  handle(IPC.appTakeCrash, () => takeMarker(markerFile(), process.pid, Date.now()))
  // Not through handle(): the capture needs the sender's webContents. Same sender check.
  ipcMain.handle(IPC.appCaptureWindow, async (ev) => {
    if (!isTrustedSender(ev)) throw new Error('forbidden')
    try {
      const image = await ev.sender.capturePage()
      return image.isEmpty() ? null : image.toPNG()
    } catch (err) {
      log.warn('captureWindow failed', err)
      return null
    }
  })

  // The two ways a session ends badly that the person sees: the interface process dies, or the window freezes and
  // is closed by force. (An uncaught error in main is logged and the app keeps running: not a crash to ask about.)
  app.on('render-process-gone', (_e, _wc, d) => {
    if (countsAsCrash(d.reason)) markCrash('renderer')
  })
  app.on('browser-window-created', (_e, win) => {
    win.on('unresponsive', () => markCrash('unresponsive'))
    win.on('responsive', () => clearMarker(markerFile(), process.pid, 'unresponsive'))
  })
}
