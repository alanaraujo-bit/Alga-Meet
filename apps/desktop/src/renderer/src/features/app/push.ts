import type { PushSubscribeBody } from '@alga/shared'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'

// ── "I'm using Alga here" (gateway `active`): while any device says so, the phone stays quiet (server push.ts) ──
const EVERY_MS = 30_000
let lastActive = 0

export function startActiveSignal(): () => void {
  const ping = () => {
    const s = useSession.getState()
    if (!s.push || !document.hasFocus() || Date.now() - lastActive < EVERY_MS) return
    if (s.send({ op: 'active' })) lastActive = Date.now()
  }
  const events = ['pointerdown', 'keydown', 'wheel'] as const
  for (const e of events) window.addEventListener(e, ping, { passive: true, capture: true })
  return () => {
    for (const e of events) window.removeEventListener(e, ping, { capture: true })
  }
}

// ── Web Push in the PWA ──
/**
 * unsupported: not the PWA, or the browser has no push (iOS Safari outside the installed app); install: iOS, open it
 * from the home screen first; unavailable: the server has push off; off / on / denied: the person's choice.
 */
export type PushState = 'unsupported' | 'install' | 'unavailable' | 'off' | 'on' | 'denied'

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const web = window.alga?.config?.shell === 'web'

export const usePush = create<{ state: PushState; busy: boolean }>()(() => ({ state: 'unsupported', busy: false }))

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
const bodyOf = (sub: PushSubscription): PushSubscribeBody => {
  const j = sub.toJSON()
  return { endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' } }
}

async function refresh(): Promise<void> {
  if (!web) return usePush.setState({ state: 'unsupported' })
  if (!('PushManager' in window) || !navigator.serviceWorker) return usePush.setState({ state: ios && !standalone ? 'install' : 'unsupported' })
  const key = useSession.getState().push?.key
  if (!key) return usePush.setState({ state: 'unavailable' })
  if (Notification.permission === 'denied') return usePush.setState({ state: 'denied' })
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub && Notification.permission === 'granted') {
    // The same browser may now be another account's: the server keeps the endpoint for whoever posted it last.
    await api('POST', '/push/subscriptions', bodyOf(sub)).catch(() => {})
    usePush.setState({ state: 'on' })
  } else usePush.setState({ state: 'off' })
}

/** From a tap (iOS asks only from a user gesture). */
export async function enablePush(): Promise<void> {
  const key = useSession.getState().push?.key
  if (!key) return
  usePush.setState({ busy: true })
  try {
    if ((await Notification.requestPermission()) !== 'granted') return usePush.setState({ state: Notification.permission === 'denied' ? 'denied' : 'off' })
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }))
    await api('POST', '/push/subscriptions', bodyOf(sub))
    usePush.setState({ state: 'on' })
  } finally {
    usePush.setState({ busy: false })
  }
}

export async function disablePush(): Promise<void> {
  usePush.setState({ busy: true })
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
    if (sub) {
      await api('DELETE', '/push/subscriptions', { endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe()
    }
    usePush.setState({ state: 'off' })
  } finally {
    usePush.setState({ busy: false })
  }
}

/**
 * Follows READY (the server's key) and re-registers this browser for the signed-in account. Signing out drops the
 * browser's subscription itself (the token is gone by then): the push service answers 410 and the server forgets it.
 */
export function startPush(): () => void {
  void refresh().catch(() => {})
  return useSession.subscribe((st, prev) => {
    if (st.push !== prev.push) void refresh().catch(() => {})
    if (st.phase === 'signed_out' && prev.phase !== 'signed_out' && web && navigator.serviceWorker)
      void navigator.serviceWorker.ready.then((r) => r.pushManager?.getSubscription()).then((s) => s?.unsubscribe()).catch(() => {})
  })
}
