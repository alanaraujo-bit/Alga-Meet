import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { CINEMA_ITEMS_PER_FRAME, type CinemaAudioTrack, type CinemaFilm, type CinemaPieceMeta, type CinemaSubtitleTrack, type CinemaTrackId } from '@alga/shared'
import { runTool, type FfmpegBins } from './ffmpeg'
import { MAX_SUBTITLE_BYTES, decodeSubtitle, extractFonts, extractSubtitle, makePoster, makeThumbs, srtToVtt } from './extras'
import { initDelay, initTimescale, segmentStart } from './mp4'
import { capText, stripControls } from './names'
import { HLS_TIME_S, hashFile, head, parsePlaylist, runArgs } from './runs'

/*
 * The host's piece factory (spec §6.3 step 3, Rulings R4/R5/R27). Per video/audio track ONE ffmpeg run at a time writes
 * hashed fMP4 pieces (HLS muxer, 4 s, cut at keyframes): piece 0 is the init segment, media pieces start at n = 1 and n is
 * the GENERATION order, dense per track (consumers order and look up by startS). Timestamps are absolute media time:
 * `-copyts -start_at_zero` plus `movflags=+frag_discont` make every segment's tfdt the source time (the mov muxer otherwise
 * rebases each run to 0), and init segments come out byte-identical across runs.
 *
 * Runs: `ensure(track, t)` beyond the frontier kills the run and starts one at the keyframe <= t (`-ss`). A run that starts
 * before already generated pieces (a gap run) gets `-to` = the next piece's start in DTS (startS - B-frame delay), so it
 * stops exactly on that keyframe: pieces of different runs never overlap. When a run ends the factory continues from the
 * end of the coverage of the track's target (`want`; the playhead drags it forward), to EOF or until the disk budget stops it.
 *
 * Disk budget (`budgetBytes` caps video/audio media pieces; init segments, subtitles, fonts, poster and thumbs are small,
 * never evicted and not counted). Anchors are the playhead and each track's `want`; the contiguous coverage from an anchor
 * is protected, each piece valued by its distance ahead of the anchor. Over budget, evicted first: unprotected pieces behind
 * the playhead (more than 10 min behind first, oldest first), then unprotected pieces elsewhere (farthest first), then
 * protected pieces farther from their anchor than the piece being generated (farthest first). Pieces of an active run are
 * never evicted. Generation goes on while that frees room; otherwise the run stops and the track waits for setPlayhead /
 * ensure / addAudio. A missing piece AT an anchor is always generated (the budget may overshoot by that piece), so the
 * playhead and every target get their first piece. An evicted piece is reported by `onEvicted`; if it is needed again it is
 * regenerated under NEW n values (next free), so a given n always names the same bytes and hash.
 */

export interface PieceEvent { track: CinemaTrackId; from: number; items: CinemaPieceMeta[] }
export interface PieceFactoryOpts {
  path: string; film: CinemaFilm; dir: string; budgetBytes: number; bins: FfmpegBins
  /** Absolute ffprobe index of the film's video stream (probe's videoStreamIndex). */
  videoStreamIndex: number
  /** Tests only: ffmpeg `-readrate`, to slow runs down. */
  readRate?: number
}
type Unsubscribe = () => void

const POLL_MS = 250
/** Slack for timestamps: a run's last EXTINF ignores B-frame reordering, AAC priming shifts ~21 ms, tfdt rounds to 1 ms. */
const EPS = 0.25
/** A target this close past the frontier continues the frontier instead of jumping (no tiny holes between runs). */
const JUMP_S = HLS_TIME_S
const BEHIND_FAR_S = 600
/** A run that ends without data this far before the film's end is truncated. */
const END_SLACK_S = 1
const STALE_MS = 3_600_000
/** Same cap as PieceMetaSchema in packages/shared/src/cinema.ts: the server rejects bigger pieces. */
const MAX_PIECE_BYTES = 64 * 1024 * 1024

export const cinemaRoot = (): string => join(app.getPath('temp'), 'alga-cinema')
export const sessionDir = (root: string = cinemaRoot()): string => join(root, randomBytes(8).toString('hex'))

/** Deletes session dirs whose newest entry is more than 1 h old (crash leftovers); called at app start. */
export async function cleanupStale(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
    const dir = join(root, e.name)
    const kids = await readdir(dir).catch(() => [])
    const times = await Promise.all([dir, ...kids.map((k) => join(dir, k))].map((p) => stat(p).then((s) => s.mtimeMs, () => 0)))
    if (Date.now() - Math.max(...times) > STALE_MS) await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }))
}

interface Piece { n: number; startS: number; durS: number; bytes: number; hash: string; file: string }
interface Run {
  k: number; firstN: number; from: number; stopAt: number | null; playlist: string; initFile: string; abort: AbortController
  seen: number; frontier: number; added: number; dead: boolean; exited: Promise<void>
}
interface Track {
  id: CinemaTrackId; audio: CinemaAudioTrack | null; dir: string
  /** n -> piece, init (n = 0) included. */
  pieces: Map<number, Piece>
  /** Media pieces sorted by startS. */
  order: Piece[]
  nextN: number; want: number; limit: number; run: Run | null; runs: number; failures: number; stopped: boolean
  queue: Promise<void>; ingesting: Promise<void>; timescale: number; delayS: number
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const end = (p: Piece) => p.startS + p.durS
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class PieceFactory {
  private readonly tracks = new Map<CinemaTrackId, Track>()
  /** s<id>, poster, thumbs: piece 0 (+ fonts for ASS); never evicted. */
  private readonly singles = new Map<CinemaTrackId, Piece[]>()
  private readonly pieceCbs = new Set<(e: PieceEvent) => void>()
  private readonly errorCbs = new Set<(e: { track: CinemaTrackId; reason: string }) => void>()
  private readonly evictCbs = new Set<(e: { track: CinemaTrackId; n: number[] }) => void>()
  private readonly extrasAbort = new AbortController()
  /** In-flight addSubtitle calls: close() waits for them, so nothing is written after the dir is gone. */
  private readonly pending = new Set<Promise<unknown>>()
  private extras: Promise<void> = Promise.resolve()
  private ready: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private firstVideo: () => void = () => {}
  private readonly firstVideoP = new Promise<void>((r) => (this.firstVideo = r))
  private nextSubId: number
  /** Bytes of media pieces (what the budget caps). */
  private total = 0
  private playhead = 0

  constructor(private readonly opts: PieceFactoryOpts) {
    this.nextSubId = Math.max(-1, ...opts.film.subtitles.map((s) => s.id)) + 1
  }

  start(startS: number, audioIds: number[]): void {
    if (this.closing || this.ready) return
    const at = Math.min(Math.max(Number.isFinite(startS) ? startS : 0, 0), this.opts.film.durationS)
    this.ready = mkdir(join(this.opts.dir, 'extras'), { recursive: true }).then(() => {})
    this.playhead = at
    this.addTrack('v', null, at)
    for (const id of audioIds) this.addAudio(id)
    this.extras = this.makeExtras().catch(() => {})
  }

  /** Generate `track` from `atS` on; also the retry after a track stopped on errors. */
  ensure(track: CinemaTrackId, atS: number): void {
    const t = this.tracks.get(track)
    if (!t || this.closing || !Number.isFinite(atS)) return
    t.want = Math.min(Math.max(atS, 0), this.opts.film.durationS)
    t.stopped = false
    t.failures = 0
    this.schedule(t)
  }

  addAudio(audioId: number): void {
    const a = this.opts.film.audio.find((x) => x.id === audioId)
    if (a && this.ready && !this.closing) this.addTrack(`a${a.id}`, a, this.playhead)
  }

  /**
   * The room's position: pieces behind it lose the playhead's protection and every track's target moves up to it. It never
   * moves a target back; on a seek backwards call ensure(track, pos) for each track, then setPlayhead(pos).
   */
  setPlayhead(s: number): void {
    if (this.closing || !Number.isFinite(s)) return
    this.playhead = s
    for (const t of this.tracks.values()) t.want = Math.max(t.want, s)
    this.shrink(this.opts.budgetBytes, Infinity)
    for (const t of this.tracks.values()) this.schedule(t)
  }

  /** A .srt/.vtt/.ass/.ssa the host picked (absolute path) becomes a new subtitle track for everyone; null if unusable. */
  addSubtitle(file: string): Promise<CinemaSubtitleTrack | null> {
    const p = this.addSubtitleNow(file)
    this.pending.add(p)
    void p.finally(() => this.pending.delete(p))
    return p
  }

  init(track: CinemaTrackId): Promise<Uint8Array | null> {
    return this.piece(track, 0)
  }

  async piece(track: CinemaTrackId, n: number): Promise<Uint8Array | null> {
    const p = this.tracks.get(track)?.pieces.get(n) ?? this.singles.get(track)?.[n]
    if (!p || this.closing) return null
    return readFile(p.file).catch(() => null)
  }

  onPieces(cb: (e: PieceEvent) => void): Unsubscribe {
    this.pieceCbs.add(cb)
    return () => this.pieceCbs.delete(cb)
  }

  onError(cb: (e: { track: CinemaTrackId; reason: string }) => void): Unsubscribe {
    this.errorCbs.add(cb)
    return () => this.errorCbs.delete(cb)
  }

  /** Pieces deleted for the disk budget: the host no longer has these n (peers may). */
  onEvicted(cb: (e: { track: CinemaTrackId; n: number[] }) => void): Unsubscribe {
    this.evictCbs.add(cb)
    return () => this.evictCbs.delete(cb)
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.extrasAbort.abort()
      this.firstVideo()
      const pending = [...this.tracks.values()].flatMap((t) => {
        t.run?.abort.abort()
        return [t.queue, t.run?.exited]
      })
      await Promise.allSettled([...pending, this.extras, ...this.pending])
      await rm(this.opts.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    })()
    return this.closing
  }

  // ---- events -------------------------------------------------------------------------------------------------------------

  private emitPieces(track: CinemaTrackId, from: number, items: CinemaPieceMeta[]): void {
    for (let i = 0; i < items.length; i += CINEMA_ITEMS_PER_FRAME) {
      const e = { track, from: from + i, items: items.slice(i, i + CINEMA_ITEMS_PER_FRAME) }
      for (const cb of this.pieceCbs) cb(e)
    }
  }

  private emitError(track: CinemaTrackId, reason: string): void {
    if (this.closing) return
    for (const cb of this.errorCbs) cb({ track, reason })
  }

  // ---- runs ---------------------------------------------------------------------------------------------------------------

  private addTrack(id: CinemaTrackId, audio: CinemaAudioTrack | null, want: number): void {
    if (this.tracks.has(id)) return
    const t: Track = {
      id, audio, dir: join(this.opts.dir, id), pieces: new Map(), order: [], nextN: 1, want, limit: this.opts.film.durationS,
      run: null, runs: 0, failures: 0, stopped: false, queue: Promise.resolve(), ingesting: Promise.resolve(), timescale: NaN, delayS: 0,
    }
    this.tracks.set(id, t)
    this.schedule(t)
  }

  private schedule(t: Track): void {
    t.queue = t.queue.then(() => this.step(t)).catch((e: unknown) => this.emitError(t.id, message(e)))
  }

  /** First time >= `from` not covered by contiguous pieces; null when the coverage reaches the end of the data. */
  private gap(t: Track, from: number): number | null {
    let g = from
    for (const p of t.order) {
      if (p.startS - EPS > g) break
      if (end(p) + EPS >= g) g = Math.max(g, end(p))
    }
    return g >= t.limit - EPS ? null : g
  }

  private async step(t: Track): Promise<void> {
    await this.ready
    if (this.closing || t.stopped) return
    let g = this.gap(t, t.want)
    const run = t.run
    if (run) {
      // Keep a run that is producing the target or will reach it within JUMP_S.
      if (g === null || (g >= run.from - EPS && g <= run.frontier + JUMP_S)) return
      run.abort.abort()
      await run.exited
      if (this.closing) return
      g = this.gap(t, t.want)
    }
    if (g !== null && this.room(t, g)) await this.startRun(t, g)
  }

  private async startRun(t: Track, g: number): Promise<void> {
    const { film, bins } = this.opts
    const prev = t.order.filter((p) => end(p) <= g + EPS).pop()
    // Continue right after the coverage when the target is close; the 10 ms keeps -ss off the previous keyframe. The ffmpeg
    // CLI seeks to 3/23 s before -ss when a stream has a decode delay (B-frames): add it back so video lands on the keyframe <= from.
    const cont = prev !== undefined && g - end(prev) < JUMP_S
    const from = cont ? end(prev) : g
    const seek = t.audio ? from : from + (cont ? 0.01 : 0) + (t.delayS > 0 ? 3 / 23 : 0)
    const stopAt = t.order.find((p) => p.startS > from + EPS)?.startS ?? null
    // The stop check is on DTS: a keyframe's DTS is its startS minus the B-frame delay; 1 ms keeps it out.
    const to = stopAt === null ? null : stopAt - (t.audio ? 0 : t.delayS) - 0.001
    await mkdir(t.dir, { recursive: true })
    if (this.closing) return
    const k = ++t.runs
    const playlist = join(t.dir, `run${k}.m3u8`)
    const run: Run = {
      k, firstN: t.nextN, from, stopAt, playlist, initFile: join(t.dir, `run${k}-init.mp4`), abort: new AbortController(),
      seen: 0, frontier: from, added: 0, dead: false, exited: Promise.resolve(),
    }
    const args = runArgs({ ...this.opts, audio: t.audio, k, n: t.nextN, seek, to, dir: t.dir, playlist, initFile: run.initFile })
    t.run = run
    const timer = setInterval(() => void this.ingest(t, run), POLL_MS)
    // Slower than real time is useless anyway: the timeout only catches a hung process.
    run.exited = runTool(bins.ffmpeg, args, { timeoutMs: (120 + film.durationS) * 1000, signal: run.abort.signal })
      .catch((e: unknown) => ({ code: -1, stdout: '', stderr: message(e) }))
      .then(async (r) => {
        clearInterval(timer)
        await this.ingest(t, run)
        if (t.run === run) t.run = null
        this.finish(t, run, r.code, r.stderr)
      })
  }

  private finish(t: Track, run: Run, code: number, stderr: string): void {
    if (this.closing) return
    const ours = run.abort.signal.aborted && !run.dead
    const last = stderr.trim().split(/\r?\n/).pop() ?? ''
    if (!ours && !run.dead) {
      if (code !== 0) {
        // Not the end of the data: retry once, then report and wait for an explicit ensure().
        if (++t.failures > 1) {
          t.stopped = true
          this.emitError(t.id, `ffmpeg ${code}: ${last}`)
        }
        if (!t.stopped) this.schedule(t)
        return
      }
      if (run.stopAt === null) {
        // Reached the end of the data: nothing to generate past it, ever.
        t.limit = Math.min(t.limit, run.frontier)
        if (last && run.frontier < this.opts.film.durationS - END_SLACK_S) this.emitError(t.id, `ended at ${run.frontier.toFixed(1)} s: ${last}`)
      }
    }
    // A run that produced nothing on its own must not be restarted in a loop.
    if (ours || run.added > 0) this.schedule(t)
  }

  private ingest(t: Track, run: Run): Promise<void> {
    t.ingesting = t.ingesting.then(() => this.ingestNow(t, run)).catch((e: unknown) => this.kill(t, run, message(e)))
    return t.ingesting
  }

  /** Stops a run whose output is unusable; reported only when it made no progress (else generation simply resumes). */
  private kill(t: Track, run: Run, reason: string): void {
    if (run.added === 0) this.emitError(t.id, `${reason} at ${run.from.toFixed(1)} s`)
    run.dead = true
    run.abort.abort()
  }

  /** Piece 0 from the first run; a later run whose init differs is stopped before peers get pieces they cannot decode. */
  private async checkInit(t: Track, run: Run): Promise<boolean> {
    const init = await readFile(run.initFile)
    const hash = sha256(init)
    const p0 = t.pieces.get(0)
    if (!p0) {
      t.timescale = initTimescale(init)
      t.delayS = initDelay(init)
      t.pieces.set(0, { n: 0, startS: -1, durS: 0, bytes: init.length, hash, file: run.initFile })
      this.emitPieces(t.id, 0, [[-1, 0, init.length, hash]])
      return true
    }
    if (hash === p0.hash) return true
    this.kill(t, run, 'init segment changed between runs')
    return false
  }

  /** Reads the segments the run completed since the last poll: absolute start, size cap, hash, budget. */
  private async ingestNow(t: Track, run: Run): Promise<void> {
    if (run.dead || this.closing) return
    const entries = parsePlaylist(await readFile(run.playlist, 'utf8').catch(() => ''), run.k)
    const items: CinemaPieceMeta[] = []
    const from = t.nextN
    for (const { durS, name, n } of entries.slice(run.seen)) {
      if (run.seen === 0 && !(await this.checkInit(t, run))) return
      const file = join(t.dir, name)
      const { size } = await stat(file)
      const startS = segmentStart(await head(file), t.timescale)
      if (size > MAX_PIECE_BYTES) {
        // A piece the swarm cannot carry: stop this track until an explicit ensure().
        this.emitError(t.id, `piece too large (${size} bytes) at ${startS.toFixed(1)} s`)
        t.stopped = true
        run.dead = true
        run.abort.abort()
        break
      }
      const overlaps = t.order.some((p) => startS < end(p) - EPS && startS + durS > p.startS + EPS)
      if (!Number.isFinite(startS) || !Number.isFinite(durS) || overlaps || n !== t.nextN) {
        this.kill(t, run, overlaps ? 'overlapping piece' : 'unreadable piece')
        await unlink(file).catch(() => {})
        break
      }
      const piece: Piece = { n, startS, durS, bytes: size, hash: await hashFile(file), file }
      if (run.dead || this.closing) return
      run.seen++
      run.added++
      run.frontier = Math.max(run.frontier, end(piece))
      t.pieces.set(n, piece)
      let i = t.order.length
      while (i > 0 && t.order[i - 1]!.startS > startS) i--
      t.order.splice(i, 0, piece)
      t.nextN = n + 1
      t.failures = 0
      this.total += size
      items.push([startS, durS, size, piece.hash])
    }
    if (items.length === 0) return
    this.emitPieces(t.id, from, items)
    if (t.id === 'v') this.firstVideo()
    this.enforce(t)
  }

  // ---- disk budget --------------------------------------------------------------------------------------------------------

  /** Seconds ahead of the nearest anchor whose contiguous coverage ends at `g` (the next piece's distance). */
  private needDistance(t: Track, g: number): number {
    let d = Infinity
    for (const a of [this.playhead, t.want]) {
      const reach = this.gap(t, a)
      if (a <= g + EPS && reach !== null && Math.abs(reach - g) <= EPS) d = Math.min(d, Math.max(0, g - a))
    }
    return d
  }

  /** Room to generate track `t` at `g`: free, freed from pieces worth less, or `g` sits at an anchor (always generated). */
  private room(t: Track, g: number): boolean {
    if (this.total < this.opts.budgetBytes) return true
    const d = this.needDistance(t, g)
    if (d === 0) return true
    this.shrink(this.opts.budgetBytes - 1, d)
    return this.total < this.opts.budgetBytes
  }

  /** After an ingest: make room for what `t` generates next, or stop its run and let the other tracks claim the space. */
  private enforce(t: Track): void {
    const g = this.gap(t, t.want)
    this.shrink(this.opts.budgetBytes, g === null ? Infinity : this.needDistance(t, g))
    if (this.total <= this.opts.budgetBytes || !t.run) return
    t.run.abort.abort()
    for (const o of this.tracks.values()) if (o !== t) this.schedule(o)
  }

  /** Evicts while over `max` bytes: unprotected pieces, then protected ones more than `d` s ahead of their anchor. */
  private shrink(max: number, d: number): void {
    const gone = new Map<CinemaTrackId, number[]>()
    while (this.total > max) {
      const v = this.victim(d)
      if (!v) break
      v.t.pieces.delete(v.p.n)
      v.t.order.splice(v.t.order.indexOf(v.p), 1)
      this.total -= v.p.bytes
      void unlink(v.p.file).catch(() => {})
      gone.set(v.t.id, [...(gone.get(v.t.id) ?? []), v.p.n])
    }
    for (const [track, n] of gone) for (const cb of this.evictCbs) cb({ track, n })
  }

  private victim(d: number): { t: Track; p: Piece } | null {
    const ph = this.playhead
    let best: { t: Track; p: Piece; rank: number; key: number } | null = null
    for (const t of this.tracks.values()) {
      const regions = [ph, t.want].map((a) => [a, this.gap(t, a) ?? Infinity] as const)
      for (const p of t.order) {
        if (t.run && p.n >= t.run.firstN) continue
        const dist = Math.min(...regions.map(([a, reach]) => (end(p) > a && p.startS < reach ? Math.max(0, p.startS - a) : Infinity)))
        const [rank, key] = dist < Infinity
          ? (dist > d ? [3, -dist] : [9, 0])
          : end(p) < ph - BEHIND_FAR_S ? [0, p.startS] : end(p) <= ph ? [1, p.startS] : [2, -p.startS]
        if (rank < 9 && (!best || rank < best.rank || (rank === best.rank && key < best.key))) best = { t, p, rank, key }
      }
    }
    return best
  }

  // ---- single-file tracks -------------------------------------------------------------------------------------------------

  private async addSubtitleNow(file: string): Promise<CinemaSubtitleTrack | null> {
    const ext = extname(file).toLowerCase()
    if (!this.ready || this.closing || !isAbsolute(file) || !['.srt', '.vtt', '.ass', '.ssa'].includes(ext) || this.nextSubId > 999) return null
    const id = this.nextSubId++
    try {
      if ((await stat(file)).size > MAX_SUBTITLE_BYTES) return null
      const text = decodeSubtitle(await readFile(file))
      const format = ext === '.ass' || ext === '.ssa' ? 'ass' : 'vtt'
      await this.ready
      if (this.closing) return null
      await this.addSubtitlePieces(id, format, ext === '.srt' ? srtToVtt(text) : text, [])
      const title = capText(stripControls(basename(file, extname(file))).trim(), 120)
      return { id, lang: null, title: title || null, format, external: true }
    } catch {
      return null
    }
  }

  private async addSingle(track: CinemaTrackId, files: string[]): Promise<void> {
    const pieces: Piece[] = []
    for (const [n, file] of files.entries()) pieces.push({ n, startS: 0, durS: 0, bytes: (await stat(file)).size, hash: await hashFile(file), file })
    if (this.closing) return
    this.singles.set(track, pieces)
    this.emitPieces(track, 0, pieces.map((p) => [0, 0, p.bytes, p.hash]))
  }

  /** Piece 0 = UTF-8 JSON { format, text, fonts: [{ name, piece }] }; pieces 1..k = the font files (Ruling R27). */
  private async addSubtitlePieces(id: number, format: 'vtt' | 'ass', text: string, fonts: { name: string; file: string }[]): Promise<void> {
    const file = join(this.opts.dir, 'extras', `s${id}.json`)
    await writeFile(file, JSON.stringify({ format, text, fonts: fonts.map((f, i) => ({ name: f.name, piece: i + 1 })) }))
    await this.addSingle(`s${id}`, [file, ...fonts.map((f) => f.file)])
  }

  /** Subtitles, then the poster, then (after the first video pieces) the thumbnail sprite; one at a time, in the background. */
  private async makeExtras(): Promise<void> {
    const { bins, path, film, videoStreamIndex } = this.opts
    const signal = this.extrasAbort.signal
    const dir = join(this.opts.dir, 'extras')
    const job = (track: CinemaTrackId, work: () => Promise<void>) => work().catch((e: unknown) => this.emitError(track, message(e)))
    await this.ready
    let fonts: Promise<{ name: string; file: string }[]> | null = null
    for (const s of film.subtitles) {
      await job(`s${s.id}`, async () => {
        const text = await extractSubtitle(bins, path, s, dir, signal)
        fonts ??= s.format === 'ass' ? extractFonts(bins, path, dir, signal).catch(() => []) : null
        await this.addSubtitlePieces(s.id, s.format, text, s.format === 'ass' && fonts ? await fonts : [])
      })
    }
    const poster = join(dir, 'poster.webp')
    await job('poster', async () => {
      await makePoster(bins, path, videoStreamIndex, film.durationS, poster, signal)
      await this.addSingle('poster', [poster])
    })
    await this.firstVideoP
    const thumbs = join(dir, 'thumbs.webp')
    await job('thumbs', async () => {
      await makeThumbs(bins, path, videoStreamIndex, film, thumbs, signal)
      await this.addSingle('thumbs', [thumbs])
    })
  }
}
