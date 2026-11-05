import type { CinemaFilm, CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import type { Swarm } from './swarm/swarm'

/** The SourceBuffers hold this much ahead of the playhead and drop what is further behind (spec §6.5). */
const AHEAD_S = 60
const BEHIND_S = 30
/** A buffered range this close to a piece's edges covers it (fMP4 keyframes shift up to ~0.13 s; B-frame offsets). */
export const EDGE_S = 0.25
const PROBE_TIMEOUT_MS = 5_000

export interface TimeRange { startS: number; endS: number }
export type PieceSource = Pick<Swarm, 'get' | 'pieces'>

const covers = (ranges: TimeRange[], s: number, e: number): boolean =>
  ranges.some((r) => r.startS <= s + EDGE_S && r.endS >= e - EDGE_S)

export const rangesOf = (b: TimeRanges): TimeRange[] => Array.from({ length: b.length }, (_, i) => ({ startS: b.start(i), endS: b.end(i) }))

/**
 * What to append to a SourceBuffer (piece numbers, in startS order: n is generation order, R4) so it covers
 * [playhead, playhead + 60 s), and where to cut what is more than 30 s behind. `pieces` is the track's index (position
 * = n); the init segment and zero-length pieces are never part of the plan.
 */
export function bufferPlan(
  buffered: TimeRange[], playheadS: number, pieces: readonly CinemaPieceMeta[],
): { append: number[]; removeBeforeS: number | null } {
  const append: [number, number][] = []
  pieces.forEach(([s, d], n) => {
    if (d > 0 && s + d > playheadS && s < playheadS + AHEAD_S && !covers(buffered, s, s + d)) append.push([s, n])
  })
  const cut = playheadS - BEHIND_S
  return {
    append: append.sort((a, b) => a[0] - b[0]).map(([, n]) => n),
    removeBeforeS: cut > 0 && buffered.some((r) => r.startS < cut) ? cut : null,
  }
}

type CanPlay = { ok: true } | { ok: false; reason: 'video_codec' | 'audio_codec' }

/**
 * Seat check (spec §6.5): `isTypeSupported` for the video and the chosen audio, then a real decode of the init segment
 * plus the first held media piece of each in a hidden MediaSource (HEVC on Windows is hardware-only: this is where a
 * seat finds out). A track with no held media piece yet is judged by type only: call this once the swarm has the
 * playhead's first pieces (e.g. when `aheadS > 0`).
 */
export async function canPlay(film: CinemaFilm, audioId: number, swarm: PieceSource): Promise<CanPlay> {
  const audio = film.audio.find((a) => a.id === audioId)
  if (film.audio.length && !audio) throw new Error(`cinema: unknown audio track ${audioId}`)
  if (!MediaSource.isTypeSupported(film.videoMime)) return { ok: false, reason: 'video_codec' }
  if (audio && !MediaSource.isTypeSupported(audio.mime)) return { ok: false, reason: 'audio_codec' }
  if (!(await probe(film.videoMime, 'v', swarm, film.durationS))) return { ok: false, reason: 'video_codec' }
  if (audio && !(await probe(audio.mime, `a${audio.id}`, swarm, film.durationS))) return { ok: false, reason: 'audio_codec' }
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

/** One SourceBuffer and the track it plays; updates run one at a time through `chain`. */
export interface Lane { sb: SourceBuffer; track: CinemaTrackId; mime: string; init: string | null; chain: Promise<unknown>; swapping: boolean }

export const laneOf = (sb: SourceBuffer, track: CinemaTrackId, mime: string): Lane => {
  sb.mode = 'segments' // pieces carry absolute film timestamps
  return { sb, track, mime, init: null, chain: Promise.resolve(), swapping: false }
}

/** Queues one SourceBuffer update on the lane; resolves on its 'updateend', rejects if the call throws. */
export function laneOp(l: Lane, f: (sb: SourceBuffer) => void): Promise<void> {
  const run = () => new Promise<void>((resolve, reject) => {
    const done = () => resolve()
    l.sb.addEventListener('updateend', done, { once: true })
    try {
      f(l.sb)
    } catch (e) {
      l.sb.removeEventListener('updateend', done)
      reject(e)
    }
  })
  const p = l.chain.then(run)
  l.chain = p.catch(() => {})
  return p
}

/**
 * One feeding round: the init (again if its version changed), then the plan around `playheadS()`: cut far behind,
 * append what the swarm holds in time order. Stops as soon as `alive()` fails or the lane swaps track.
 */
export async function feedLane(l: Lane, swarm: PieceSource, playheadS: () => number, alive: () => boolean): Promise<void> {
  const track = l.track
  const live = () => alive() && !l.swapping && l.track === track
  const pieces = swarm.pieces(track)
  const init = pieces[0]
  if (!live() || !init) return
  if (l.init !== init[3]) {
    const buf = await swarm.get(track, 0)
    if (!buf || !live()) return
    await laneOp(l, (sb) => sb.appendBuffer(buf))
    if (!live()) return
    l.init = init[3]
  }
  const plan = bufferPlan(rangesOf(l.sb.buffered), playheadS(), pieces)
  const cut = plan.removeBeforeS
  if (cut !== null) await laneOp(l, (sb) => sb.remove(0, cut))
  for (const n of plan.append) {
    const buf = await swarm.get(track, n)
    const m = pieces[n]
    if (!live()) return
    // not held yet, or an overlapping (regenerated, R4) piece already filled the range
    if (!buf || !m || covers(rangesOf(l.sb.buffered), m[0], m[0] + m[1])) continue
    try {
      await laneOp(l, (sb) => sb.appendBuffer(buf))
    } catch (e) {
      if ((e as Error).name === 'QuotaExceededError') return // full: Chromium evicts behind the playhead, retry next tick
      throw e
    }
  }
}
