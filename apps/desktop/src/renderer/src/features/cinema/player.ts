import {
  CINEMA_RESUME_AHEAD_S, CINEMA_STALL_MS, positionAt,
  type CinemaFilm, type CinemaPlayback,
} from '@alga/shared'
import { aheadOf, feedLane, gapJumpTarget, laneOf, rangesOf, swapLane, type Lane } from './mse'
import type { Swarm } from './swarm/swarm'
import { SyncController } from './sync'

export { bufferPlan, canPlay, type TimeRange } from './mse'

const TICK_MS = 500
/** Paused this close to a scheduled play position: no seek needed first (about a frame). */
const FRAME_S = 0.01
/** A command that is already in effect seeks first only if the video is this far off; less is left to the sync loop. */
const LATE_SEEK_S = 0.5
/** Back from a hidden window: seek when this far off (the sync dead band); closer is not worth a visible hiccup. */
const VISIBLE_SEEK_S = 0.02
/** The last second of the film never counts as a stall (no endOfStream: the buffer just runs out there). */
const END_S = 1
/** |sync error| samples kept for stats (≈ 10 s at 60 fps). */
const ERR_SAMPLES = 600

/** Client delay until the server instant `atServerMs` (offset = server − client); never negative. */
export function scheduleDelayMs(atServerMs: number, offsetMs: number, clientNowMs: number): number {
  return Math.max(0, atServerMs - offsetMs - clientNowMs)
}

/**
 * The film on a <video> through MSE (spec §6.5/§6.6): two SourceBuffers (video 'v' and the chosen audio `a<id>`) fed
 * from the swarm around the playhead, commands applied at their server instant, and every displayed frame
 * (requestVideoFrameCallback) compared with the room's position to nudge playbackRate or seek.
 *
 * Feeding starts once the first `setAudio` adds the audio SourceBuffer (Chromium takes no new SourceBuffer after the
 * first init segment); a film without audio feeds right away. The caller keeps `swarm.setTracks` (the player moves the
 * swarm's playhead). `outputLatencyMs`: pass it only when the film's audio goes through an AudioContext (Task 13), e.g.
 * `() => (ctx.baseLatency + ctx.outputLatency) * 1000`: the element's own A/V sync does not see that delay, so the
 * player runs that much ahead of the room and the sound, not the picture, lands on the room's instant (Bluetooth).
 */
export class CinemaPlayer {
  private readonly ms = new MediaSource()
  private readonly url = URL.createObjectURL(this.ms)
  private readonly opened: Promise<void>
  private readonly sync = new SyncController()
  private readonly stallCbs = new Set<(stalled: boolean) => void>()
  private readonly errorCbs = new Set<(e: Error) => void>()
  private readonly errs: number[] = []
  private readonly offPiece: () => void
  private readonly tick: ReturnType<typeof setInterval>
  private videoLane: Lane | null = null
  private audioLane: Lane | null = null
  private swaps: Promise<unknown> = Promise.resolve()
  private p: CinemaPlayback | null = null
  private serverNow: () => number = () => Date.now()
  private timer: ReturnType<typeof setTimeout> | undefined
  private frameId: number
  private seekId = 0
  private feeding = false
  private again = false
  private starveSince: number | null = null
  private stalled = false
  private dead = false

  constructor(
    private readonly video: HTMLVideoElement, private readonly swarm: Swarm, private readonly film: CinemaFilm,
    private readonly opts: { outputLatencyMs?: () => number } = {},
  ) {
    this.opened = new Promise((resolve, reject) => {
      this.ms.addEventListener('sourceopen', () => {
        try {
          this.ms.duration = film.durationS
          this.videoLane = laneOf(this.ms.addSourceBuffer(film.videoMime), 'v', film.videoMime)
          resolve()
          this.feed()
        } catch (e) {
          reject(e)
        }
      }, { once: true })
    })
    this.opened.catch((e) => console.warn('[cinema] MediaSource', e)) // setAudio still sees the rejection
    video.preservesPitch = true
    video.src = this.url
    this.offPiece = swarm.onPiece((track) => {
      if (track === this.videoLane?.track || track === this.audioLane?.track) this.feed()
    })
    this.tick = setInterval(() => this.onTick(), TICK_MS)
    document.addEventListener('visibilitychange', this.onVisibility)
    video.addEventListener('waiting', this.jumpGap)
    video.addEventListener('error', this.onVideoError)
    this.frameId = video.requestVideoFrameCallback(this.onFrame)
  }

  /** Plays audio track `audioId`; a swap empties and refills only the audio SourceBuffer (the video frame stays). */
  setAudio(audioId: number): Promise<void> {
    const run = this.swaps.then(() => this.swapAudio(audioId))
    this.swaps = run.catch(() => {})
    return run
  }

  /** Takes the room's playback: play/pause/seek happen at `p.at` (server clock); a pause lands exactly on `position`. */
  apply(p: CinemaPlayback, serverNow: () => number): void {
    if (this.dead) return
    const prev = this.p
    this.p = p
    this.serverNow = serverNow
    // a re-broadcast of the same timeline (seats, waitingFor) must not restart the sync window or the 5 s budget
    if (prev && prev.playing === p.playing && prev.position === p.position && prev.at === p.at) return
    clearTimeout(this.timer)
    this.sync.reset()
    this.setRate(1)
    const v = this.video
    const clientNow = Date.now()
    const now = serverNow()
    const delay = scheduleDelayMs(p.at, now - clientNow, clientNow)
    if (!p.playing) {
      const stop = () => {
        v.pause()
        if (v.currentTime !== p.position) this.seek(p.position)
      }
      if (delay > 0) this.timer = setTimeout(stop, delay)
      else stop()
      return
    }
    const lead = this.leadMs()
    if (delay > lead) {
      // be exactly on `position` when `at` comes, then start (earlier by the audio output latency)
      const willBe = v.paused ? v.currentTime : v.currentTime + delay / 1000
      if (Math.abs(willBe - p.position) > FRAME_S) {
        v.pause()
        this.seek(p.position)
      }
      this.timer = setTimeout(() => this.play(), delay - lead)
    } else {
      // already in effect (late join, late message): catch up now, the sync loop does the rest
      const target = positionAt(p, now + lead, this.film.durationS)
      if (Math.abs(v.currentTime - target) > LATE_SEEK_S) this.seek(Math.min(target + this.sync.seekLatencyMs / 1000, this.film.durationS))
      this.play()
    }
  }

  /**
   * Seconds buffered contiguously ahead of currentTime in both SourceBuffers (the element's buffered = intersection),
   * across holes small enough for the gap jump.
   */
  aheadS(): number {
    return aheadOf(rangesOf(this.video.buffered), this.video.currentTime)
  }

  /**
   * true once the room is playing and the video has had no data past its current frame for CINEMA_STALL_MS; false
   * again when it holds CINEMA_RESUME_AHEAD_S ahead (or up to the end), the point where the room may resume (§6.6).
   */
  onStall(cb: (stalled: boolean) => void): () => void {
    this.stallCbs.add(cb)
    return () => this.stallCbs.delete(cb)
  }

  /** A SourceBuffer update failed (that lane stops being fed) or the element errored (decode, unsupported). */
  onError(cb: (e: Error) => void): () => void {
    this.errorCbs.add(cb)
    return () => this.errorCbs.delete(cb)
  }

  stats(): { droppedFrames: number; syncErrP95Ms: number; bufferedAheadS: number } {
    const s = [...this.errs].sort((a, b) => a - b)
    return {
      droppedFrames: this.video.getVideoPlaybackQuality().droppedVideoFrames,
      syncErrP95Ms: s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]! : 0,
      bufferedAheadS: this.aheadS(),
    }
  }

  destroy(): void {
    if (this.dead) return
    this.dead = true
    clearInterval(this.tick)
    clearTimeout(this.timer)
    this.video.cancelVideoFrameCallback(this.frameId)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.video.removeEventListener('waiting', this.jumpGap)
    this.video.removeEventListener('error', this.onVideoError)
    this.offPiece()
    this.stallCbs.clear()
    this.errorCbs.clear()
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    URL.revokeObjectURL(this.url)
  }

  // ---- sync ---------------------------------------------------------------------------------------------------------

  private readonly onFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    if (this.dead) return
    this.frameId = this.video.requestVideoFrameCallback(this.onFrame)
    const p = this.p
    if (!p?.playing || this.video.seeking || this.video.paused) return
    // the room's clock when this frame reaches the screen (expectedDisplayTime is on the performance.now timeline)
    const at = this.serverNow() + (meta.expectedDisplayTime - performance.now()) + this.leadMs()
    if (at < p.at) return // the command has not taken effect yet
    const expected = positionAt(p, at, this.film.durationS)
    if (expected >= this.film.durationS) return
    const errMs = (meta.mediaTime - expected) * 1000
    this.errs.push(Math.abs(errMs))
    if (this.errs.length > ERR_SAMPLES) this.errs.shift()
    const a = this.sync.frame(errMs, performance.now(), expected)
    this.setRate(a.kind === 'rate' ? a.rate : 1)
    if (a.kind === 'seek') this.seek(Math.min(a.toS, this.film.durationS))
  }

  /** rVFC stops while the window is hidden, so nothing corrected the drift: back on screen, go to the room's frame. */
  private readonly onVisibility = (): void => {
    const p = this.p
    if (this.dead) return
    this.sync.reset()
    if (document.visibilityState !== 'visible') return this.setRate(1) // no frames, no correction: don't keep a nudge
    if (!p?.playing) return
    const now = this.serverNow() + this.leadMs()
    if (now < p.at) return
    const target = positionAt(p, now, this.film.durationS)
    if (Math.abs(this.video.currentTime - target) >= VISIBLE_SEEK_S) this.seek(Math.min(target + this.sync.seekLatencyMs / 1000, this.film.durationS))
  }

  private leadMs(): number {
    return this.opts.outputLatencyMs?.() ?? 0
  }

  private setRate(rate: number): void {
    if (Math.abs(this.video.playbackRate - rate) > 1e-4) this.video.playbackRate = rate
  }

  private play(): void {
    this.video.play().catch((e: unknown) => {
      if ((e as Error).name !== 'AbortError') console.warn('[cinema] play', e) // AbortError: a pause came first
    })
  }

  /** currentTime + 'seeked'; a seek inside the buffer teaches the sync controller this PC's seek latency. */
  private seek(toS: number): void {
    const v = this.video
    this.swarm.setPlayhead(toS)
    if (v.readyState === 0) {
      v.currentTime = toS // no media yet: this becomes the start position and no 'seeked' fires
      return this.feed()
    }
    const id = ++this.seekId
    const buffered = rangesOf(v.buffered).some((r) => r.startS <= toS && toS < r.endS)
    const t0 = performance.now()
    v.addEventListener('seeked', () => {
      if (id !== this.seekId || this.dead) return // superseded by a newer seek
      this.sync.reset()
      if (buffered) this.sync.learnSeekLatency(performance.now() - t0)
    }, { once: true })
    v.currentTime = toS
    this.feed()
  }

  // ---- stall --------------------------------------------------------------------------------------------------------

  private onTick(): void {
    this.swarm.setPlayhead(this.video.currentTime)
    this.jumpGap()
    this.feed()
    this.checkStall()
  }

  /** Room playing, video waiting at a hole ≤ EDGE_S (fMP4 run join, keyframe shift after a seek): skip over it. */
  private readonly jumpGap = (): void => {
    const v = this.video
    if (this.dead || !this.due(this.serverNow()) || v.seeking || v.readyState >= 3) return
    const to = gapJumpTarget(rangesOf(v.buffered), v.currentTime)
    if (to !== null) this.seek(to)
  }

  /** The room is playing now and not in the film's last second. */
  private due(serverNow: number): boolean {
    const p = this.p
    return !!p?.playing && serverNow >= p.at && positionAt(p, serverNow, this.film.durationS) < this.film.durationS - END_S
  }

  private checkStall(): void {
    const v = this.video
    const now = performance.now()
    if (this.stalled) {
      if (this.aheadS() >= Math.min(CINEMA_RESUME_AHEAD_S, this.film.durationS - v.currentTime - END_S)) this.setStalled(false)
      return
    }
    // readyState below HAVE_FUTURE_DATA ('waiting'): nothing buffered past the current frame
    if (!this.due(this.serverNow()) || v.readyState >= 3) this.starveSince = null
    else if (this.starveSince === null) this.starveSince = now
    else if (now - this.starveSince >= CINEMA_STALL_MS) this.setStalled(true)
  }

  private setStalled(stalled: boolean): void {
    this.stalled = stalled
    this.starveSince = null
    for (const cb of this.stallCbs) cb(stalled)
  }

  private readonly onVideoError = (): void => {
    const e = this.video.error
    this.fail(new Error(`cinema: video error ${e?.code ?? '?'}: ${e?.message ?? ''}`))
  }

  private fail(e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e))
    console.warn('[cinema] player', err)
    for (const cb of this.errorCbs) cb(err)
  }

  // ---- MSE feeding --------------------------------------------------------------------------------------------------

  private async swapAudio(audioId: number): Promise<void> {
    const a = this.film.audio.find((x) => x.id === audioId)
    if (!a) throw new Error(`cinema: unknown audio track ${audioId}`)
    await this.opened
    const track = `a${a.id}` as const
    const l = this.audioLane
    if (this.dead || l?.track === track) return
    if (!l) {
      this.audioLane = laneOf(this.ms.addSourceBuffer(a.mime), track, a.mime)
      return this.feed()
    }
    try {
      await swapLane(l, this.swarm, track, a.mime) // on failure the old track keeps playing, the caller gets the error
    } finally {
      this.feed()
    }
  }

  private feed(): void {
    if (this.dead || !this.videoLane || (this.film.audio.length && !this.audioLane)) return
    if (this.feeding) {
      this.again = true
      return
    }
    this.feeding = true
    const lanes = [this.videoLane, this.audioLane].filter((l): l is Lane => l !== null)
    const playhead = () => this.video.currentTime
    const alive = () => !this.dead
    void Promise.allSettled(lanes.map((l) => feedLane(l, this.swarm, playhead, alive))).then((results) => {
      for (const r of results) if (r.status === 'rejected') this.fail(r.reason)
      this.feeding = false
      if (this.again) {
        this.again = false
        this.feed()
      }
    })
  }
}
