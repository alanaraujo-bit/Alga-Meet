import { releaseLocale, type ReleaseLocale, type ReleaseNote } from '@alga/shared'
import { create } from 'zustand'
import { useMedia } from '@/media'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import { onDispatch } from '@/store/session'
import { useUi } from '@/store/ui'
import { toast } from '@/ui'
import { useMyActivity } from '../activity/store'
import { closeWelcome, initialSeen, markViewed, pendingNotes, shouldWelcome, SNOOZE_MS, readSeen, type Moment, type SeenState } from './logic'
import { t } from './strings'

interface WhatsNew {
  /** Published notes up to the installed version, newest first (null = never loaded, not even from the cache). */
  notes: ReleaseNote[] | null
  seen: SeenState | null
  /** The open welcome and the notes it presents; `preview` = opened from the studio (marks nothing as seen). */
  welcome: { notes: ReleaseNote[]; preview: boolean } | null
  /** The Novidades center; `version` = the one on the right. */
  center: { version: string | null } | null
  /** Notes of versions the updater downloaded but are not installed yet (null = none published for it). */
  upcoming: Record<string, ReleaseNote | null>
  locale: ReleaseLocale
}

export const useWhatsNew = create<WhatsNew>()(() => ({
  notes: null,
  seen: null,
  welcome: null,
  center: null,
  upcoming: {},
  locale: releaseLocale(typeof navigator === 'undefined' ? undefined : navigator.language),
}))

const installed = () => window.alga?.config.version ?? '0.0.0'
const storageKey = (userId: string) => `alga.whatsnew.v1.${userId}`
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000

function persist(): void {
  const me = useData.getState().me
  const { seen, notes } = useWhatsNew.getState()
  if (!me || !seen) return
  try {
    localStorage.setItem(storageKey(me.id), JSON.stringify({ seen, notes, version: installed() }))
  } catch {
    // Storage full or disabled: Novidades still works for this run.
  }
}

function setSeen(seen: SeenState): void {
  useWhatsNew.setState({ seen })
  persist()
}

/** Settles `seen` once there are notes: from storage, or the first-run baseline. */
function adopt(notes: ReleaseNote[], stored: SeenState | null): void {
  const me = useData.getState().me
  const seen = useWhatsNew.getState().seen ?? stored ?? initialSeen(notes, installed(), !!me && Date.now() - Date.parse(me.createdAt) < NEW_ACCOUNT_MS)
  useWhatsNew.setState({ notes, seen })
  persist()
}

/** The moment, read now (every source is a store or the DOM; nothing here subscribes). */
export function currentMoment(): Moment {
  const conn = useMedia.getState().connection.state
  return {
    inCall: conn === 'connecting' || conn === 'connected' || conn === 'reconnecting',
    gaming: useMyActivity.getState().detected?.kind === 'game',
    // Any dialog (settings, checkout, a confirmation, the staff panel), an open menu, the switcher, or the
    // feedback card (not modal, but someone is writing in it).
    overlay: !!document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [data-feedback]') || useUi.getState().switcherOpen || useUi.getState().modal !== null,
    attentive: document.visibilityState === 'visible' && document.hasFocus(),
  }
}

/**
 * Loads the notes (cached copy first, so a restart offline still has them), retries quietly when the server is not
 * reachable, and opens the welcome only in a quiet moment: checked every few seconds, it must be quiet twice in a
 * row. Returns the stop function (sign-out).
 */
export function startWhatsNew(): () => void {
  const me = useData.getState().me
  if (!me) return () => {}
  let stopped = false
  let stored: SeenState | null = null
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(me.id)) ?? 'null') as { seen?: unknown; notes?: unknown; version?: unknown } | null
    stored = readSeen(JSON.stringify(raw?.seen ?? null))
    // The cache is only good for the version it was fetched for (an update changes what may be shown).
    if (raw?.version === installed() && Array.isArray(raw.notes)) adopt(raw.notes as ReleaseNote[], stored)
  } catch {}

  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = 30_000
  const load = async () => {
    clearTimeout(retry)
    try {
      const notes = await api<ReleaseNote[]>('GET', `/releases?upTo=${installed()}`)
      if (stopped) return
      adopt(notes, stored)
      delay = 30_000
    } catch {
      if (stopped) return
      retry = setTimeout(() => void load(), delay)
      delay = Math.min(delay * 3, 30 * 60_000)
    }
  }
  void load()
  // Back online (gateway READY after a reconnect): try again at once if the first load failed.
  const offReady = onDispatch((d) => {
    if (d.t === 'READY' && retry) void load()
  })

  let calm = 0
  const tick = setInterval(() => {
    const st = useWhatsNew.getState()
    if (st.welcome || !st.notes || !st.seen) return
    const pending = pendingNotes(st.notes, installed(), st.seen)
    if (!pending.length) return
    calm = shouldWelcome(pending, st.seen, currentMoment(), Date.now()) ? calm + 1 : 0
    if (calm >= 2) {
      calm = 0
      useWhatsNew.setState({ welcome: { notes: pending, preview: false } })
    }
  }, 2500)

  return () => {
    stopped = true
    clearTimeout(retry)
    clearInterval(tick)
    offReady()
    useWhatsNew.setState({ notes: null, seen: null, welcome: null, center: null, upcoming: {} })
  }
}

/** "Entendi", ×, Esc: seen. `later`: "Lembrar depois" — back in a day, the rail keeps its dot meanwhile. */
export function dismissWelcome(later = false): void {
  const { welcome, seen } = useWhatsNew.getState()
  useWhatsNew.setState({ welcome: null })
  if (!welcome || welcome.preview || !seen) return
  setSeen(later ? { ...seen, snoozeUntil: Date.now() + SNOOZE_MS } : closeWelcome(seen, welcome.notes))
}

export function openCenter(version: string | null = null): void {
  const { welcome, notes } = useWhatsNew.getState()
  if (welcome) dismissWelcome()
  const v = version ?? notes?.[0]?.version ?? null
  useWhatsNew.setState({ center: { version: v } })
  if (v) viewVersion(v)
}
export const closeCenter = () => useWhatsNew.setState({ center: null })

export function viewVersion(version: string): void {
  useWhatsNew.setState((st) => ({ center: st.center ? { version } : st.center }))
  const seen = useWhatsNew.getState().seen
  if (seen) setSeen(markViewed(seen, version))
}

/** The studio's "pré-visualizar": the real welcome with a draft, marking nothing. */
export const previewWelcome = (notes: ReleaseNote[]) => useWhatsNew.setState({ welcome: { notes, preview: true } })

/** 👍/👎: optimistic, the same button again takes it back; reverted with a toast if the server refuses. */
export async function react(version: string, itemId: string, value: 1 | -1): Promise<void> {
  const before = useWhatsNew.getState()
  const note = before.notes?.find((n) => n.version === version) ?? before.upcoming[version]
  if (!note) return
  const next = note.mine[itemId] === value ? 0 : value
  const patch = (mine: Record<string, 1 | -1>) => {
    const swap = (n: ReleaseNote) => (n.version === version ? { ...n, mine } : n)
    useWhatsNew.setState((st) => ({
      notes: st.notes?.map(swap) ?? null,
      upcoming: st.upcoming[version] ? { ...st.upcoming, [version]: swap(st.upcoming[version]!) } : st.upcoming,
    }))
  }
  const { [itemId]: _drop, ...rest } = note.mine
  patch(next === 0 ? rest : { ...rest, [itemId]: next })
  try {
    await api('PUT', `/releases/${version}/reactions/${encodeURIComponent(itemId)}`, { value: next })
    persist()
  } catch {
    patch(note.mine)
    toast.error(t.reactError)
  }
}

/** Notes for a downloaded update (asked once per version; a failure is retried on the next ask). */
export async function loadUpcoming(version: string): Promise<void> {
  if (version in useWhatsNew.getState().upcoming) return
  try {
    const n = await api<ReleaseNote>('GET', `/releases/${version}`)
    useWhatsNew.setState((st) => ({ upcoming: { ...st.upcoming, [version]: n } }))
  } catch (e) {
    if ((e as { status?: number }).status === 404) useWhatsNew.setState((st) => ({ upcoming: { ...st.upcoming, [version]: null } }))
  }
}
