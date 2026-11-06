// Reactions in the room (spec §7.3.5): CINEMA_REACTION from the gateway → an emoji rising from that person's seat for
// ~1.6 s (at most 6 in the air, the rest wait briefly), and the heat map kept live between states (R37). Pure parts
// are exported for tests; startReactions wires them while the room is mounted.
import { CINEMA_REACTION_RATE, type CinemaReaction, type CinemaSessionView } from '@alga/shared'
import { create } from 'zustand'
import { onDispatch } from '@/store/session'
import { useCinema } from '../store'

export const REACTION_MS = 1_600
export const MAX_FLYING = 6
const MAX_WAITING = 12
/** Heat buckets are 10 s of film (CinemaSessionView.heat). */
export const HEAT_BUCKET_S = 10

export interface Flying { id: number; userId: string; emoji: CinemaReaction; born: number }
export interface Queue { flying: Flying[]; waiting: Flying[] }
export const emptyQueue = (): Queue => ({ flying: [], waiting: [] })

/** A reaction arrives: it flies now when fewer than MAX_FLYING are in the air, else it waits (the oldest waiting is dropped). */
export function push(q: Queue, r: Omit<Flying, 'born'>, now: number): Queue {
  const f = { ...r, born: now }
  if (q.flying.length < MAX_FLYING) return { flying: [...q.flying, f], waiting: q.waiting }
  return { flying: q.flying, waiting: [...q.waiting, f].slice(-MAX_WAITING) }
}

/** Time passes: landed ones go, waiting ones take the free places (a reaction that waited a whole flight is stale). */
export function tick(q: Queue, now: number): Queue {
  const flying = q.flying.filter((f) => now - f.born < REACTION_MS)
  const waiting = q.waiting.filter((f) => now - f.born < REACTION_MS)
  while (flying.length < MAX_FLYING && waiting.length) flying.push({ ...waiting.shift()!, born: now })
  return flying.length === q.flying.length && waiting.length === q.waiting.length && flying.every((f, i) => f === q.flying[i]) ? q : { flying, waiting }
}

/** The server's heat plus the reactions seen since that state. */
export function mergedHeat(server: number[], adds: Record<number, number>): number[] {
  const out = [...server]
  for (const [k, n] of Object.entries(adds)) {
    const i = Number(k)
    if (i >= 0 && i < out.length) out[i] = (out[i] ?? 0) + n
  }
  return out
}

/** The server takes 1 reaction per second with a burst of 5; the button follows the same bucket, so none is lost. */
export function takeToken(b: { tokens: number; at: number }, now: number): { ok: boolean; bucket: { tokens: number; at: number } } {
  const tokens = Math.min(CINEMA_REACTION_RATE.burst, b.tokens + ((now - b.at) / 1000) * CINEMA_REACTION_RATE.perSecond)
  return tokens >= 1 ? { ok: true, bucket: { tokens: tokens - 1, at: now } } : { ok: false, bucket: { tokens, at: now } }
}

// ---- wiring ---------------------------------------------------------------------------------------------------------

interface ReactionState { q: Queue; adds: Record<number, number>; heatOf: number[] | null }
export const useReactions = create<ReactionState>(() => ({ q: emptyQueue(), adds: {}, heatOf: null }))
let seq = 0
let bucket: { tokens: number; at: number } = { tokens: CINEMA_REACTION_RATE.burst, at: 0 }

/** The live heat of a session: server buckets + what arrived since (reset when a new state brings its own heat). */
export function useHeat(session: CinemaSessionView): number[] {
  const adds = useReactions((s) => (s.heatOf === session.heat ? s.adds : null))
  return adds ? mergedHeat(session.heat, adds) : session.heat
}

/** Send a reaction unless the rate would refuse it. */
export function canSend(now = Date.now()): boolean {
  const r = takeToken(bucket, now)
  bucket = r.bucket
  return r.ok
}

/** While the room is mounted: reactions of my session fly and heat up the timeline. Returns the cleanup. */
export function startReactions(): () => void {
  let timer: ReturnType<typeof setInterval> | undefined
  const run = () => {
    const q = tick(useReactions.getState().q, Date.now())
    if (q !== useReactions.getState().q) useReactions.setState({ q })
    if (!q.flying.length && !q.waiting.length) {
      clearInterval(timer)
      timer = undefined
    }
  }
  const off = onDispatch((d) => {
    if (d.t !== 'CINEMA_REACTION') return
    const s = useCinema.getState().session
    if (!s || d.d.sessionId !== s.sessionId) return
    const slot = Math.floor(d.d.position / HEAT_BUCKET_S)
    useReactions.setState((st) => {
      const fresh = st.heatOf !== s.heat
      return {
        q: push(st.q, { id: ++seq, userId: d.d.userId, emoji: d.d.emoji }, Date.now()),
        heatOf: s.heat,
        adds: { ...(fresh ? {} : st.adds), [slot]: (fresh ? 0 : (st.adds[slot] ?? 0)) + 1 },
      }
    })
    timer ??= setInterval(run, 100)
  })
  return () => {
    off()
    clearInterval(timer)
    useReactions.setState({ q: emptyQueue(), adds: {}, heatOf: null })
  }
}
