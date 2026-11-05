import type { CinemaFilm, CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import type { Swarm } from './swarm/swarm'

/** The SourceBuffers hold this much ahead of the playhead and drop what is further behind (spec §6.5). */
const AHEAD_S = 60
const BEHIND_S = 30
/** Data further ahead than this (left over from before a backward seek) is dropped: memory budget. */
const KEEP_AHEAD_S = 90
/**
 * A buffered range this close to a piece's edges covers it (fMP4 keyframes shift up to ~0.13 s; B-frame offsets), and a
 * hole this small between ranges is played across (HEVC open-GOP run joins, Task 8).
 */
export const EDGE_S = 0.25
const PROBE_TIMEOUT_MS = 5_000
/** A feeding round whose playhead is this far off where playback would have taken it (a seek) is abandoned: its plan is stale. */
const STALE_PLAN_S = 1
/** Fastest rate the sync loop plays at (1 + 5 %, spec §6.6), with margin. */
const MAX_RATE = 1.1

export interface TimeRange { startS: number; endS: number }
export type PieceSource = Pick<Swarm, 'get' | 'pieces'>

/** Edge tolerance is EDGE_S, or half the piece for short ones (else a short piece next to a range counts as covered). */
const covers = (ranges: TimeRange[], s: number, e: number): boolean => {
  const tol = Math.min(EDGE_S, (e - s) / 2)
  return ranges.some((r) => r.startS <= s + tol && r.endS >= e - tol)
}

export const rangesOf = (b: TimeRanges): TimeRange[] => Array.from({ length: b.length }, (_, i) => ({ startS: b.start(i), endS: b.end(i) }))

/**
 * Seconds buffered contiguously from `t` (ranges sorted, as TimeRanges are), walking across holes up to EDGE_S. The
 * range holding `t` is the first with start ≤ t + EDGE_S and end > t, so both sides of a range end give the same answer.
 */
export function aheadOf(ranges: TimeRange[], t: number): number {
  let end: number | null = null
  for (const r of ranges) {
    if (end === null) {
      if (r.startS <= t + EDGE_S && r.endS > t) end = r.endS
    } else if (r.startS <= end + EDGE_S) end = Math.max(end, r.endS)
    else break
  }
  return end === null ? 0 : end - t
}

/** Where to jump when playback waits at a hole ≤ EDGE_S: the next range's start, or null (no such hole at `t`). */
export function gapJumpTarget(ranges: TimeRange[], t: number): number | null {
  const next = ranges.find((r) => r.startS > t)
  if (!next || next.startS - t > EDGE_S) return null
  return ranges.some((r) => r.startS <= t && r.endS >= next.startS) ? null : next.startS
}

/**
 * What to append to a SourceBuffer (piece numbers, in startS order: n is generation order, R4) so it covers
 * [playhead, playhead + 60 s), and where to cut: what is more than 30 s behind, and what is more than 90 s ahead (after
 * a backward seek). `pieces` is the track's index (position = n); init and zero-length pieces are never planned.
 */
export function bufferPlan(
  buffered: TimeRange[], playheadS: number, pieces: readonly CinemaPieceMeta[],
): { append: number[]; removeBeforeS: number | null; removeAfterS: number | null } {
  const append: [number, number][] = []
  pieces.forEach(([s, d], n) => {
    if (d > 0 && s + d > playheadS && s < playheadS + AHEAD_S && !covers(buffered, s, s + d)) append.push([s, n])
  })
  const cut = playheadS - BEHIND_S
  const keep = playheadS + KEEP_AHEAD_S
  return {
    append: append.sort((a, b) => a[0] - b[0]).map(([, n]) => n),
    removeBeforeS: cut > 0 && buffered.some((r) => r.startS < cut) ? cut : null,
    removeAfterS: buffered.some((r) => r.endS > keep) ? keep : null,
  }
}

type CanPlay = { ok: true } | { ok: false; reason: 'video_codec' | 'audio_codec' }

/**
 * Seat check (spec §6.5): `isTypeSupported` for the video and the chosen audio, then a real decode of the init segment
 * plus the first held media piece of each in a hidden MediaSource (HEVC on Windows is hardware-only: this is where a
 * seat finds out). Both probes run at once (≤ 5 s in all). A track with no held media piece yet is judged by type only:
 * call this once the swarm has the playhead's first pieces (e.g. when `aheadS > 0`).
 */
export async function canPlay(film: CinemaFilm, audioId: number, swarm: PieceSource): Promise<CanPlay> {
  const audio = film.audio.find((a) => a.id === audioId)
  if (film.audio.length && !audio) throw new Error(`cinema: unknown audio track ${audioId}`)
  if (!MediaSource.isTypeSupported(film.videoMime)) return { ok: false, reason: 'video_codec' }
  if (audio && !MediaSource.isTypeSupported(audio.mime)) return { ok: false, reason: 'audio_codec' }
  const [videoOk, audioOk] = await Promise.all([
    probe(film.videoMime, 'v', swarm, film.durationS),
    audio ? probe(audio.mime, `a${audio.id}`, swarm, film.durationS) : true,
  ])
  if (!videoOk) return { ok: false, reason: 'video_codec' }
  if (!audioOk) return { ok: false, reason: 'audio_codec' }
  return { ok: true }
}

/** True when the first frame decodes (loadeddata); false on error or after PROBE_TIMEOUT_MS. */
async function probe(mime: string, track: CinemaTrackId, swarm: PieceSource, durationS: number): Promise<boolean> {
  const init = await swarm.get(track, 0)
  let media: ArrayBuffer | null = null
  const byTime = swarm.pieces(track).flatMap((m, n) => (m[1] > 0 ? [[m[0], n] as const] : [])).sort((a, b) => a[0] - b[0])
  for (const [, n] of byTime) if ((media = await swarm.get(track, n))) break
  if (!init || !media) return true // nothing to decode yet: the type check stands
  const piece = media
  const el = document.createElement('video')
  el.muted = true
  el.preload = 'auto'
  const ms = new MediaSource()
  const url = URL.createObjectURL(ms)
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)
      const done = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      const step = (f: () => void) => () => {
        try {
          f()
        } catch {
          done(false)
        }
      }
      el.onloadeddata = () => done(true)
      el.onerror = () => done(false)
      ms.onsourceopen = step(() => {
        ms.duration = durationS
        const sb = ms.addSourceBuffer(mime)
        sb.onerror = () => done(false)
        sb.onupdateend = step(() => {
          // the piece may sit anywhere in the film: show its first frame (throws if nothing got buffered)
          sb.onupdateend = step(() => (el.currentTime = sb.buffered.start(0)))
          sb.appendBuffer(piece)
        })
        sb.appendBuffer(init)
      })
      el.src = url
    })
  } finally {
    el.removeAttribute('src')
    el.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * One SourceBuffer and the track it plays; updates run one at a time through `chain`. `broken`: an update failed
 * (SourceBuffer error, or the element errored): the lane is not fed again.
 */
export interface Lane {
  sb: SourceBuffer; track: CinemaTrackId; mime: string; init: string | null
  chain: Promise<unknown>; swapping: boolean; broken: boolean
}

export const laneOf = (sb: SourceBuffer, track: CinemaTrackId, mime: string): Lane => {
  sb.mode = 'segments' // pieces carry absolute film timestamps
  return { sb, track, mime, init: null, chain: Promise.resolve(), swapping: false, broken: false }
}

/** Queues one SourceBuffer update on the lane; resolves on its 'updateend', rejects on 'error' or if the call throws. */
export function laneOp(l: Lane, f: (sb: SourceBuffer) => void): Promise<void> {
  const run = () => new Promise<void>((resolve, reject) => {
    const sb = l.sb
    let failed = false
    const onError = () => {
      failed = true // 'updateend' follows
    }
    const off = () => {
      sb.removeEventListener('updateend', onEnd)
      sb.removeEventListener('error', onError)
    }
    const onEnd = () => {
      off()
      if (failed) reject(new Error(`cinema: SourceBuffer error on ${l.track}`))
      else resolve()
    }
    sb.addEventListener('updateend', onEnd)
    sb.addEventListener('error', onError)
    try {
      f(sb)
    } catch (e) {
      off()
      reject(e)
    }
  })
  const p = l.chain.then(run)
  l.chain = p.catch(() => {})
  return p
}

/**
 * One feeding round: the init (again if its version changed), then the plan around `playheadS()`: cut far behind and
 * far ahead, append what the swarm holds in time order. Stops when `alive()` fails, the lane swaps track or the playhead
 * jumps (a seek: the next round plans again). Only a failed SourceBuffer update marks the lane broken (and rejects); a
 * swarm read that throws just ends the round (the next one retries).
 */
export async function feedLane(l: Lane, swarm: PieceSource, playheadS: () => number, alive: () => boolean): Promise<void> {
  const track = l.track
  const live = () => alive() && !l.swapping && !l.broken && l.track === track
  const pieces = swarm.pieces(track)
  const init = pieces[0]
  if (!live() || !init) return
  const op = async (f: (sb: SourceBuffer) => void): Promise<boolean> => {
    try {
      await laneOp(l, f)
      return true
    } catch (e) {
      if ((e as Error).name === 'QuotaExceededError') return false // full: Chromium evicts behind the playhead, retry next tick
      l.broken = true
      throw e
    }
  }
  const read = (n: number): Promise<ArrayBuffer | null> => swarm.get(track, n).catch(() => null)
  if (l.init !== init[3]) {
    const buf = await read(0)
    if (!buf || !live() || !(await op((sb) => sb.appendBuffer(buf))) || !live()) return
    l.init = init[3]
  }
  const at = playheadS()
  const t0 = performance.now()
  // Stale = a seek: the playhead left the span normal playback (paused, or up to MAX_RATE) could have reached.
  const stale = () => {
    const p = playheadS()
    return p < at - STALE_PLAN_S || p > at + ((performance.now() - t0) / 1000) * MAX_RATE + STALE_PLAN_S
  }
  const plan = bufferPlan(rangesOf(l.sb.buffered), at, pieces)
  const cut = plan.removeBeforeS
  const keep = plan.removeAfterS
  if (cut !== null && !(await op((sb) => sb.remove(0, cut)))) return
  if (keep !== null && !(await op((sb) => sb.remove(keep, Infinity)))) return
  for (const n of plan.append) {
    const buf = await read(n)
    const m = pieces[n]
    if (!live() || stale()) return
    // not held yet, or an overlapping (regenerated, R4) piece already filled the range
    if (!buf || !m || covers(rangesOf(l.sb.buffered), m[0], m[0] + m[1])) continue
    if (!(await op((sb) => sb.appendBuffer(buf)))) return
  }
}

/**
 * Switches an audio lane to another track: empty it, change its type if needed, append the new init; only then is the
 * lane on the new track. Fails without touching anything if the new init is not held yet; any later failure puts the
 * old type back and clears `init`, so the next feeding round restores the old track at the playhead.
 */
export async function swapLane(l: Lane, swarm: PieceSource, track: CinemaTrackId, mime: string): Promise<void> {
  const meta = swarm.pieces(track)[0]
  const init = meta ? await swarm.get(track, 0) : null
  if (!meta || !init) throw new Error(`cinema: no init segment for ${track} yet`)
  const old = l.mime
  l.swapping = true // stops feedLane for this lane
  try {
    try {
      if (l.sb.updating) l.sb.abort() // cut the old track's append short
    } catch {
      // a remove is running (abort is not allowed then): the chain waits for it
    }
    await laneOp(l, (sb) => sb.remove(0, Infinity))
    if (mime !== old) l.sb.changeType(mime)
    l.mime = mime
    await laneOp(l, (sb) => sb.appendBuffer(init))
    l.track = track
    l.init = meta[3]
  } catch (e) {
    if (l.mime !== old) {
      try {
        l.sb.changeType(old)
        l.mime = old
      } catch {
        l.broken = true
      }
    }
    l.init = null
    throw e
  } finally {
    l.swapping = false
  }
}
