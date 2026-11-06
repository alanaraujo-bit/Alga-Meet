import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'

/** Seconds ahead of the playhead that are fetched first, in time order, from the fastest source (spec §6.4). */
export const CRITICAL_S = 30
/** Pieces in flight per source at once. */
export const MAX_PEER_INFLIGHT = 3
/** A critical download is judged late only after it has run this long (its rate means little before). */
export const LATE_MIN_AGE_S = 2
/**
 * Within this many seconds of the playhead the host serves anyone (a copy through a friend might come too late);
 * further ahead, even critical pieces come from a friend that holds them, so the host's uplink carries each piece about
 * once (super-seed). Measured (Task 16): with the whole 30 s window from the host, it sent 1.8x the pieces and saturated.
 */
export const HOST_NEAR_S = 10

export interface SwarmView {
  now: number; playheadS: number; tracks: CinemaTrackId[]
  index: Map<CinemaTrackId, CinemaPieceMeta[]>
  mine: Map<CinemaTrackId, Set<number>>
  /** mbps < 0 marks a peer in back-off: used only when nobody else holds the piece. */
  peers: { id: string; isHost: boolean; has: Map<CinemaTrackId, Set<number>>; inflight: number; mbps: number; bannedFor: Set<string> }[]
  /** `${track}:${n}` → peer it is being downloaded from */
  inflight: Map<string, string>
  /** Cache capacity left, in pieces (limits prefetch only: the critical window is always fetched). */
  budgetPieces: number
  /** Seconds ahead fetched as critical (default CRITICAL_S; more while a seat needs a longer pre-roll). */
  criticalS?: number
}

/** `urgent` = in our critical window (the uploader serves it first); `preempt` = in-flight prefetch to cancel for it. */
export interface PieceRequest { peer: string; track: CinemaTrackId; n: number; urgent: boolean; preempt?: string }

export const pieceKey = (track: CinemaTrackId, n: number): string => `${track}:${n}`

/** Init segments and single-file pieces (durS 0) are always critical; media pieces when they overlap the window. */
export function isCritical(m: CinemaPieceMeta, playheadS: number, criticalS = CRITICAL_S): boolean {
  return m[1] === 0 || (m[0] + m[1] > playheadS && m[0] < playheadS + criticalS)
}

/** At its own average rate so far, the download ends after the playhead reaches the piece (playing at 1×). */
export function isLate(m: CinemaPieceMeta, gotBytes: number, ageS: number, playheadS: number): boolean {
  if (ageS < LATE_MIN_AGE_S) return false
  const rate = gotBytes / ageS
  return rate === 0 || (m[2] - gotBytes) / rate > Math.max(0, m[0] - playheadS)
}

/**
 * Pure piece picker. n is generation order (R4): everything is ordered by startS from the index, never by n.
 * 1. Critical pieces (init/single-file first, then the window in time order), each from the fastest holder with a free
 *    slot; if every holder is full, the farthest prefetch in flight on the fastest holder is preempted for it.
 * 2. Then pieces ahead of the playhead, rarest first (fewest holders), nearest on a tie, while budgetPieces (minus the
 *    critical media pieces just asked) lasts. Here a friend that holds the piece is always used instead of the host
 *    (super-seed): the host only serves what no friend (out of back-off) has. The same goes for critical pieces that
    start HOST_NEAR_S or more ahead of the playhead.
 * Never asks for what is held or in flight, nor from a peer banned for that piece, nor beyond MAX_PEER_INFLIGHT a peer;
 * maxNew bounds the flights added (a preempting request replaces one).
 */
export function nextRequests(v: SwarmView, maxNew: number): PieceRequest[] {
  const crit: [CinemaTrackId, number, number][] = []
  const rest: [CinemaTrackId, number, number, number][] = []
  for (const track of v.tracks) {
    const list = v.index.get(track) ?? []
    const mine = v.mine.get(track)
    for (let n = 0; n < list.length; n++) {
      const m = list[n]
      if (!m || mine?.has(n) || v.inflight.has(pieceKey(track, n))) continue
      if (isCritical(m, v.playheadS, v.criticalS)) crit.push([track, n, m[1] === 0 ? -Infinity : m[0]])
      else if (m[0] + m[1] > v.playheadS) rest.push([track, n, m[0], v.peers.filter((p) => p.has.get(track)?.has(n)).length])
    }
  }
  crit.sort((a, b) => a[2] - b[2])
  rest.sort((a, b) => a[3] - b[3] || a[2] - b[2])

  const load = new Map(v.peers.map((p) => [p.id, p.inflight]))
  const loadOf = (id: string) => load.get(id) ?? 0
  const out: PieceRequest[] = []
  let fresh = 0
  const holders = (track: CinemaTrackId, n: number, critical: boolean, startS = Infinity) => {
    const k = pieceKey(track, n)
    let hs = v.peers.filter((p) => p.has.get(track)?.has(n) && !p.bannedFor.has(k))
    if (hs.some((p) => p.mbps >= 0)) hs = hs.filter((p) => p.mbps >= 0) // back-off peers only as the last holder, never as overflow
    const far = !critical || startS >= v.playheadS + HOST_NEAR_S
    if (far && hs.some((p) => !p.isHost)) hs = hs.filter((p) => !p.isHost)
    return hs.sort((a, b) => b.mbps - a.mbps || loadOf(a.id) - loadOf(b.id))
  }
  const preempted = new Set<string>()
  const victimOn = (peer: string): string | undefined => {
    let victim: string | undefined
    let farthest = -Infinity
    for (const [k, id] of v.inflight) {
      if (id !== peer || preempted.has(k)) continue
      const i = k.lastIndexOf(':')
      const m = v.index.get(k.slice(0, i) as CinemaTrackId)?.[Number(k.slice(i + 1))]
      if (m && !isCritical(m, v.playheadS, v.criticalS) && m[0] > farthest) [victim, farthest] = [k, m[0]]
    }
    return victim
  }
  // critical media pieces are never held back by the budget, but they use it up before any prefetch
  let budget = v.budgetPieces
  for (const [track, n, at] of crit) {
    const hs = holders(track, n, true, at)
    const free = fresh < maxNew ? hs.find((p) => loadOf(p.id) < MAX_PEER_INFLIGHT) : undefined
    let req: PieceRequest | undefined
    if (free) {
      load.set(free.id, loadOf(free.id) + 1)
      fresh++
      req = { peer: free.id, track, n, urgent: true }
    } else {
      for (const p of hs) {
        const k = victimOn(p.id)
        if (!k) continue
        preempted.add(k)
        req = { peer: p.id, track, n, urgent: true, preempt: k }
        break
      }
    }
    if (!req) continue
    out.push(req)
    if (at !== -Infinity) budget--
  }
  for (const [track, n] of rest) {
    if (fresh >= maxNew || budget <= 0) break
    const p = holders(track, n, false).find((h) => loadOf(h.id) < MAX_PEER_INFLIGHT)
    if (!p) continue
    load.set(p.id, loadOf(p.id) + 1)
    fresh++
    budget--
    out.push({ peer: p.id, track, n, urgent: false })
  }
  return out
}

/**
 * Super-seed (host side), for prefetch and critical requests alike: send a piece only if no other friend has it (or is
 * being sent it), or it is an init/single-file piece, or it starts less than HOST_NEAR_S ahead of the room's playhead.
 */
export function hostShouldSend(hostView: SwarmView, peerId: string, track: CinemaTrackId, n: number): boolean {
  const m = hostView.index.get(track)?.[n]
  if (!m) return false
  return m[1] === 0 || m[0] < hostView.playheadS + HOST_NEAR_S || !hostView.peers.some((p) => p.id !== peerId && p.has.get(track)?.has(n))
}
