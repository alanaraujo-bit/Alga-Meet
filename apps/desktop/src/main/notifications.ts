import { Notification } from 'electron'
import { IPC } from '../shared/ipc'
import { assetPath } from './assets'
import { bool, emit, obj, on, str } from './ipc'
import { showMainWindow } from './window'

// Live notifications are referenced until closed so their click handler isn't garbage-collected.
// Same tag replaces the previous toast (e.g. several messages in one DM).
const live = new Map<string | symbol, Notification>()

function notify(raw: unknown): void {
  const o = obj(raw)
  const title = str(o.title, 256)
  const body = str(o.body, 1024)
  const tag = o.tag === undefined ? undefined : str(o.tag, 256)
  const silent = o.silent === undefined ? false : bool(o.silent)
  if (!Notification.isSupported()) return

  const key = tag ?? Symbol()
  live.get(key)?.close()
  const n = new Notification({ title, body, silent, icon: assetPath('icon.png') })
  const forget = () => {
    if (live.get(key) === n) live.delete(key)
  }
  n.on('click', () => {
    forget()
    showMainWindow()
    emit(IPC.notificationClick, tag)
  })
  n.on('close', forget)
  live.set(key, n)
  if (live.size > 50) live.delete(live.keys().next().value!) // bound memory if close events never come
  n.show()
}

export function registerNotificationIpc(): void {
  on(IPC.notify, notify)
}
