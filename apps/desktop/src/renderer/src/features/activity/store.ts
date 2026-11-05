import { ActivitySchema, type Activity } from '@alga/shared'
import { useMemo, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { readableTint, vividAverage } from './logic'

type LocalActivity = NonNullable<Awaited<ReturnType<Window['alga']['activity']['current']>>>

interface MyActivity {
  /** What this PC detects and would share (null = nothing, sharing off, or the app is hidden). */
  detected: LocalActivity | null
  /** "Pausar por 1 h": nothing is sent until this epoch ms (memory only; a restart ends the pause). */
  pausedUntil: number
}

export const useMyActivity = create<MyActivity>()(() => ({ detected: null, pausedUntil: 0 }))

/** What actually goes out: detection minus the pause. */
export function sharedActivity(st: MyActivity = useMyActivity.getState(), now = Date.now()): Activity | null {
  if (!st.detected || st.pausedUntil > now) return null
  const { key: _key, ...wire } = st.detected
  return wire
}

let lastSent: string | null = null
function send(force = false): void {
  // Invisible: nothing leaves this PC (the server would hide it anyway; this way it never even knows).
  const raw = useData.getState().me?.statusPreference === 'invisible' ? null : sharedActivity()
  // An invalid frame would close the socket, and the next READY would resend it: check before sending.
  const a = raw && ActivitySchema.safeParse(raw).success ? raw : null
  const json = JSON.stringify(a)
  if (!force && json === lastSent) return
  if (useSession.getState().send({ op: 'activity', activity: a })) lastSent = json
}

let pauseTimer: ReturnType<typeof setTimeout> | undefined
/** Stop sharing for `ms` (null = resume now). Friends see the activity vanish at once. */
export function pauseSharing(ms: number | null): void {
  clearTimeout(pauseTimer)
  useMyActivity.setState({ pausedUntil: ms ? Date.now() + ms : 0 })
  if (ms) pauseTimer = setTimeout(() => pauseSharing(null), ms)
  send()
}

/** Wires detection (main process) to the gateway: on change, and again after every READY (the server forgets). */
export function startActivitySync(): () => void {
  const bridge = window.alga?.activity
  if (!bridge) return () => undefined
  const take = (a: LocalActivity | null) => {
    useMyActivity.setState({ detected: a })
    send()
  }
  void bridge.current().then(take, () => undefined)
  const offChange = bridge.onChange(take)
  const offPref = useData.subscribe((st, prev) => {
    if (st.me?.statusPreference !== prev.me?.statusPreference) send()
  })
  const offReady = onDispatch((d) => {
    if (d.t === 'READY') {
      lastSent = null
      send(true)
    }
  })
  return () => {
    offChange()
    offReady()
    offPref()
  }
}

/** Someone's current activity; for yourself, what you are sharing right now. */
export function useActivity(userId: string | undefined): Activity | undefined {
  const isMe = useData((st) => !!userId && st.me?.id === userId)
  const theirs = useData((st) => (userId ? st.activities[userId] : undefined))
  // Select stable references only (a fresh object per render would loop): the pause timer clears pausedUntil.
  const detected = useMyActivity((st) => (isMe ? st.detected : null))
  const paused = useMyActivity((st) => st.pausedUntil > 0)
  const mine = useMemo(() => (detected && !paused ? sharedActivity({ detected, pausedUntil: 0 }) : null), [detected, paused])
  return isMe ? (mine ?? undefined) : theirs
}

// ── One clock for every live timer (they tick together, once a second, only while someone shows one) ──
let now = Date.now()
const ticks = new Set<() => void>()
let clock: ReturnType<typeof setInterval> | undefined
function subscribeClock(cb: () => void): () => void {
  ticks.add(cb)
  if (!clock) {
    now = Date.now()
    clock = setInterval(() => {
      now = Date.now()
      ticks.forEach((t) => t())
    }, 1000)
  }
  return () => {
    ticks.delete(cb)
    if (!ticks.size) clock = void clearInterval(clock)
  }
}
export const useNow = (): number => useSyncExternalStore(subscribeClock, () => now)

let slow = Date.now()
const slowTicks = new Set<() => void>()
let slowClock: ReturnType<typeof setInterval> | undefined
function subscribeSlow(cb: () => void): () => void {
  slowTicks.add(cb)
  slowClock ??= setInterval(() => {
    slow = Date.now()
    slowTicks.forEach((t) => t())
  }, 30_000)
  return () => {
    slowTicks.delete(cb)
    if (!slowTicks.size) slowClock = void clearInterval(slowClock)
  }
}
const noSubscribe = () => () => undefined
/** A coarse clock (30 s) for expiries; `on` = false subscribes to nothing and returns 0. */
export const useSlowNow = (on: boolean): number =>
  useSyncExternalStore(on ? subscribeSlow : noSubscribe, () => {
    if (!on) return 0
    // Stable between calls (a snapshot must be), refreshed when it is older than one period.
    if (Date.now() - slow > 30_000) slow = Date.now()
    return slow
  })

// ── The icon's color (decoded once per icon) ──
const tints = new Map<string, string | null>()
const waiting = new Map<string, Promise<string | null>>()

export function tintOf(icon: string | undefined): string | null | undefined {
  return icon ? tints.get(icon) : null
}

export function loadTint(icon: string): Promise<string | null> {
  if (tints.has(icon)) return Promise.resolve(tints.get(icon)!)
  let p = waiting.get(icon)
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      const img = new Image()
      // Remote art (Steam CDN) is read through CORS; a server without it just leaves the default tint.
      if (/^https?:/.test(icon)) img.crossOrigin = 'anonymous'
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = 16
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        try {
          ctx.drawImage(img, 0, 0, 16, 16)
          const rgb = vividAverage(ctx.getImageData(0, 0, 16, 16).data)
          resolve(rgb ? readableTint(rgb) : null)
        } catch {
          resolve(null) // tainted canvas
        }
      }
      img.onerror = () => resolve(null)
      img.src = icon
    }).then((t) => {
      tints.set(icon, t)
      if (tints.size > 200) tints.delete(tints.keys().next().value!)
      waiting.delete(icon)
      return t
    })
    waiting.set(icon, p)
  }
  return p
}
