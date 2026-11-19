import type { NotifyPrefs } from '@alga/shared'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import { onDispatch } from '@/store/session'
import { defaultLevel, FOREVER, isMutedIn, levelIn, type NotifyLevel, type Prefs } from './notifyRules'

export { FOREVER, HOUR, isMutedIn, shouldNotify, type NotifyLevel } from './notifyRules'

/**
 * How much each space, channel and DM may interrupt you. Calm by default and adaptive: a small space (friends)
 * tells you about every message, a big one only about @mentions (docs/research/discord: F5, OP-05, VOC-11).
 * "Silenciado" also hides the unread dot; an @mention still shows inside the app, it just never interrupts.
 * shortcut: kept on this PC per account (like the custom status), not synced across devices; move to the server
 * when there is a second client (mobile).
 */
export const useNotify = create<Prefs>()(() => ({ levels: {}, muted: {}, tick: 0 }))

const memberCount = (spaceId: string) => Object.keys(useData.getState().members[spaceId] ?? {}).length

export const levelOf = (spaceId: string): NotifyLevel => levelIn(useNotify.getState(), spaceId, memberCount(spaceId))
export const defaultLevelOf = (spaceId: string): NotifyLevel => defaultLevel(memberCount(spaceId))
export const isMuted = (id: string): boolean => isMutedIn(useNotify.getState(), id)
/** A space shows no unread dot when it is silenced (level "none" or a timed silence). */
export const isSilenced = (spaceId: string): boolean => levelOf(spaceId) === 'none'

/** Re-renders when that id's silence starts or ends (prune() bumps `tick`, so the selector reads the clock again). */
export const useMuted = (id: string | null | undefined): boolean => useNotify((st) => !!id && isMutedIn(st, id))
export const useSilenced = (spaceId: string): boolean => useNotify((st) => levelIn(st, spaceId, memberCount(spaceId)) === 'none')

const keyFor = (userId: string) => `alga.notify.${userId}`
let timer: ReturnType<typeof setTimeout> | undefined

/** The account whose choices are in the store; nothing is written for anyone else (no empty state over saved prefs). */
let loadedFor: string | null = null

function save(): void {
  const me = useData.getState().me?.id
  if (!me || me !== loadedFor) return
  const { levels, muted } = useNotify.getState()
  localStorage.setItem(keyFor(me), JSON.stringify({ levels, muted }))
}

/** Drops ended silences and wakes up when the next one ends. */
function prune(): void {
  clearTimeout(timer)
  const now = Date.now()
  const muted = Object.fromEntries(Object.entries(useNotify.getState().muted).filter(([, until]) => until > now))
  useNotify.setState((st) => ({ muted, tick: st.tick + 1 }))
  const next = Math.min(...Object.values(muted))
  // setTimeout caps at ~24.8 days; "forever" and longer silences are simply checked again later.
  if (Number.isFinite(next) && next < FOREVER) timer = setTimeout(prune, Math.min(2 ** 31 - 1, next - now + 50))
}

export function setLevel(spaceId: string, level: NotifyLevel): void {
  useNotify.setState((st) => {
    const muted = { ...st.muted }
    delete muted[spaceId] // choosing a level ends a timed silence
    return { levels: { ...st.levels, [spaceId]: level }, muted }
  })
  prune()
  save()
}

export function mute(id: string, forMs: number | 'forever'): void {
  useNotify.setState((st) => ({ muted: { ...st.muted, [id]: forMs === 'forever' ? FOREVER : Date.now() + forMs } }))
  prune()
  save()
}

export function unmute(id: string): void {
  useNotify.setState((st) => {
    const muted = { ...st.muted }
    delete muted[id]
    return { muted }
  })
  prune()
  save()
}

const isLevel = (v: unknown): v is NotifyLevel => v === 'all' || v === 'mentions' || v === 'none'

/** This account's saved choices (a malformed entry is dropped, never trusted). */
function load(userId: string): void {
  synced = false
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(keyFor(userId)) ?? 'null')
  } catch {
    raw = null
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as { levels?: unknown; muted?: unknown }
  const levels = Object.fromEntries(Object.entries((r.levels as Record<string, unknown>) ?? {}).filter(([, v]) => isLevel(v))) as Record<string, NotifyLevel>
  const muted = Object.fromEntries(Object.entries((r.muted as Record<string, unknown>) ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>
  loadedFor = userId
  useNotify.setState({ levels, muted })
  prune()
}

// ── Shared by every device (GET/PUT /users/@me/notify-prefs; packages/shared/src/push.ts) ──
// The server's copy wins; the very first sync uploads what this device had (choices made before they synced).
// It also decides the phone's pushes, so a silence made here stops them there.
let pushTimer: ReturnType<typeof setTimeout> | undefined
let synced = false

function upload(): void {
  clearTimeout(pushTimer)
  if (!synced) return
  pushTimer = setTimeout(() => {
    const { levels, muted } = useNotify.getState()
    void api<NotifyPrefs>('PUT', '/users/@me/notify-prefs', { levels, muted }).catch(() => {})
  }, 600)
}

function apply(p: NotifyPrefs): void {
  useNotify.setState({ levels: { ...p.levels }, muted: { ...p.muted } })
  prune()
  save()
}

async function sync(userId: string): Promise<void> {
  synced = false
  const server = await api<NotifyPrefs>('GET', '/users/@me/notify-prefs').catch(() => null)
  if (!server || loadedFor !== userId) return // older server: this device keeps its own choices
  const empty = !Object.keys(server.levels).length && !Object.keys(server.muted).length
  if (!empty) apply(server)
  synced = true
  if (empty) upload()
}

/**
 * Loads now for the signed-in account (the shell mounts after the first READY, so that one has already passed) and
 * again on every READY (another account signed in on this PC); then syncs with the server.
 */
export function startNotifyPrefs(): () => void {
  const me = useData.getState().me?.id
  if (me) {
    load(me)
    void sync(me)
  }
  const unsub = useNotify.subscribe((st, prev) => {
    if (st.levels !== prev.levels || st.muted !== prev.muted) upload()
  })
  const off = onDispatch((d) => {
    if (d.t === 'READY' && d.d.user.id !== loadedFor) {
      load(d.d.user.id)
      void sync(d.d.user.id)
    } else if (d.t === 'NOTIFY_PREFS_UPDATE') {
      synced = false // an echo of another device's choice is not sent back
      apply(d.d)
      synced = true
    }
  })
  return () => {
    unsub()
    off()
    clearTimeout(pushTimer)
  }
}
