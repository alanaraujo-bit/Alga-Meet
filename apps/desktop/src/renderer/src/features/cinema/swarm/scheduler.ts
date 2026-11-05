import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'

/** Seconds ahead of the playhead that are fetched first, in time order, from the fastest source (spec §6.4). */
export const CRITICAL_S = 30
/** Pieces in flight per source at once. */
export const MAX_PEER_INFLIGHT = 3

export interface SwarmView {
  now: number; playheadS: number; tracks: CinemaTrackId[]
  index: Map<CinemaTrackId, CinemaPieceMeta[]>
  mine: Map<CinemaTrackId, Set<number>>
  peers: { id: string; isHost: boolean; has: Map<CinemaTrackId, Set<number>>; inflight: number; mbps: number; bannedFor: Set<string> }[]
  /** `${track}:${n}` */
  inflight: Set<string>
  /** Cache capacity left, in pieces (limits prefetch only: the critical window is always fetched). */
  budgetPieces: number
}

export const pieceKey = (track: CinemaTrackId, n: number): string => `${track}:${n}`

/** Init segments and single-file pieces (durS 0) are always critical; media pieces when they overlap the window. */
export function isCritical(m: CinemaPieceMeta, playheadS: number): boolean {
  return m[1] === 0 || (m[0] + m[1] > playheadS && m[0] < playheadS + CRITICAL_S)
}

/**
 * Pure piece picker. n is generation order (R4): everything is ordered by startS from the index, never by n.
 * 1. Critical pieces (init/single-file first, then the window in time order), each from the fastest holder.
 * 2. Then pieces ahead of the playhead, rarest first (fewest holders), nearest on a tie, while budgetPieces (minus the
 *    critical media pieces just asked) lasts. Here a friend that holds the piece is always used instead of the host
 *    (super-seed): the host only serves what no friend has.
 * Never asks for what is held or in flight, nor from a peer banned for that piece, nor beyond MAX_PEER_INFLIGHT a peer.
 */
export function nextRequests(v: SwarmView, maxNew: number): { peer: string; track: CinemaTrackId; n: number }[] {
  const crit: [CinemaTrackId, number, number][] = []
  const rest: [CinemaTrackId, number, number, number][] = []
  for (const track of v.tracks) {
    const list = v.index.get(track) ?? []
    const mine = v.mine.get(track)
    for (let n = 0; n < list.length; n++) {
      const m = list[n]
      if (!m || mine?.has(n) || v.inflight.has(pieceKey(track, n))) continue
      if (isCritical(m, v.playheadS)) crit.push([track, n, m[1] === 0 ? -Infinity : m[0]])
      else if (m[0] + m[1] > v.playheadS) rest.push([track, n, m[0], v.peers.filter((p) => p.has.get(track)?.has(n)).length])
    }
  }
  crit.sort((a, b) => a[2] - b[2])
  rest.sort((a, b) => a[3] - b[3] || a[2] - b[2])

  const load = new Map(v.peers.map((p) => [p.id, p.inflight]))
  const out: { peer: string; track: CinemaTrackId; n: number }[] = []
  const take = (track: CinemaTrackId, n: number, critical: boolean): boolean => {
    const k = pieceKey(track, n)
    let holders = v.peers.filter((p) => p.has.get(track)?.has(n) && !p.bannedFor.has(k))
    if (!critical && holders.some((p) => !p.isHost)) holders = holders.filter((p) => !p.isHost)
    let best: SwarmView['peers'][number] | null = null
    for (const p of holders) {
      const l = load.get(p.id) ?? 0
      if (l >= MAX_PEER_INFLIGHT) continue
      if (!best || p.mbps > best.mbps || (p.mbps === best.mbps && l < (load.get(best.id) ?? 0))) best = p
    }
    if (!best) return false
    load.set(best.id, (load.get(best.id) ?? 0) + 1)
    out.push({ peer: best.id, track, n })
    return true
  }
  // critical media pieces are never held back by the budget, but they use it up before any prefetch
  let budget = v.budgetPieces
  for (const [track, n, at] of crit) if (out.length < maxNew && take(track, n, true) && at !== -Infinity) budget--
  for (const [track, n] of rest) if (out.length < maxNew && budget > 0 && take(track, n, false)) budget--
  return out
}

/** Super-seed (host side): send a piece only if no other friend has it, or it is in the room's critical window. */
export function hostShouldSend(hostView: SwarmView, peerId: string, track: CinemaTrackId, n: number): boolean {
  const m = hostView.index.get(track)?.[n]
  if (!m) return false
  return isCritical(m, hostView.playheadS) || !hostView.peers.some((p) => p.id !== peerId && p.has.get(track)?.has(n))
}
