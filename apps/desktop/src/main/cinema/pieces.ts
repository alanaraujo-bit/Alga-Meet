import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import { CINEMA_ITEMS_PER_FRAME, type CinemaAudioTrack, type CinemaFilm, type CinemaPieceMeta, type CinemaSubtitleTrack, type CinemaTrackId } from '@alga/shared'
import { runTool, type FfmpegBins } from './ffmpeg'
import { MAX_SUBTITLE_BYTES, decodeSubtitle, extractFonts, extractSubtitle, makePoster, makeThumbs, srtToVtt } from './extras'
import { initDelay, initTimescale, segmentStart } from './mp4'
import { capText, stripControls } from './names'

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
 * end of the coverage of the last target (the playhead drags it forward), to EOF or until the disk budget is spent.
 *
 * Disk budget: over `budgetBytes`, pieces behind the playhead go first (more than 10 min behind first, oldest first), then
 * pieces ahead that are detached from the playhead's coverage (farthest first); if nothing is left to evict, generation
 * pauses until `setPlayhead` frees space. An evicted piece is reported by `onEvicted`; if it is needed again it is
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

const HLS_TIME_S = 4
const POLL_MS = 250
/** Slack for timestamps: a run's last EXTINF ignores B-frame reordering, AAC priming shifts ~21 ms, tfdt rounds to 1 ms. */
const EPS = 0.25
/** A target this close past the frontier continues the frontier instead of jumping (no tiny holes between runs). */
const JUMP_S = HLS_TIME_S
const BEHIND_FAR_S = 600
/** A run that ends without data this far before the film's end is truncated. */
const END_SLACK_S = 1
const STALE_MS = 3_600_000
/** Opus mapping family 1 (Vorbis order) layouts by channel count; libopus refuses the 5.1(side)/7.1(wide) variants. */
const OPUS_LAYOUTS = ['', 'mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1']

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

interface Piece { startS: number; durS: number; bytes: number; hash: string; file: string }
interface Run { from: number; stopAt: number | null; playlist: string; initFile: string; abort: AbortController; seen: number; frontier: number; added: number; dead: boolean; exited: Promise<void> }
interface Track {
  id: CinemaTrackId; audio: CinemaAudioTrack | null; dir: string; pieces: Map<number, Piece>; nextN: number
  want: number; limit: number; run: Run | null; runs: number; queue: Promise<void>; ingesting: Promise<void>; timescale: number; delayS: number
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const end = (p: Piece) => p.startS + p.durS
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** ffmpeg on Windows puts the HLS init segment in the cwd when the paths use backslashes. */
const ff = (p: string) => p.replace(/\\/g, '/')

function audioArgs(a: CinemaAudioTrack): string[] {
  const ch = Math.min(Math.max(a.channels, 1), 8)
  switch (a.out) {
    case 'copy': return ['-c:a', 'copy', '-copypriorss', '0'] // no packets before the seek point: continuations do not overlap
    case 'aac': return ['-c:a', 'aac', '-b:a', '640k', '-ac', String(ch)]
    // ~96 kbps per channel (576k for 5.1, 768k for 7.1); > 8 source channels are downmixed to 7.1 by the layout.
    case 'opus': return ['-af', `aformat=channel_layouts=${OPUS_LAYOUTS[ch]}`, '-c:a', 'libopus', '-b:a', `${96 * ch}k`, '-mapping_family', '1']
    case 'flac': return ['-c:a', 'flac', ...(ch === 8 ? ['-ac', '8'] : [])]
  }
}

function parsePlaylist(text: string): { durS: number; name: string }[] {
  const out: { durS: number; name: string }[] = []
  let dur: number | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) dur = Number.parseFloat(line.slice(8))
    else if (dur !== null && /^\d+\.m4s$/.test(line.trim())) {
      out.push({ durS: dur, name: line.trim() })
      dur = null
    }
  }
  return out
}

export class PieceFactory {
  private readonly tracks = new Map<CinemaTrackId, Track>()
  /** s<id>, poster, thumbs: piece 0 (+ fonts for ASS); never evicted. */
  private readonly singles = new Map<CinemaTrackId, Piece[]>()
  private readonly pieceCbs = new Set<(e: PieceEvent) => void>()
  private readonly errorCbs = new Set<(e: { track: CinemaTrackId; reason: string }) => void>()
  private readonly evictCbs = new Set<(e: { track: CinemaTrackId; n: number[] }) => void>()
  private readonly extrasAbort = new AbortController()
  private extras: Promise<void> = Promise.resolve()
  private ready: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private firstVideo: () => void = () => {}
  private readonly firstVideoP = new Promise<void>((r) => (this.firstVideo = r))
  private nextSubId: number
  private total = 0
  private playhead = 0
  private paused = false

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

  ensure(track: CinemaTrackId, atS: number): void {
    const t = this.tracks.get(track)
    if (!t || this.closing || !Number.isFinite(atS)) return
    t.want = Math.min(Math.max(atS, 0), this.opts.film.durationS)
    this.schedule(t)
  }

  addAudio(audioId: number): void {
    const a = this.opts.film.audio.find((x) => x.id === audioId)
    if (a && this.ready && !this.closing) this.addTrack(`a${a.id}`, a, this.playhead)
  }

  setPlayhead(s: number): void {
    if (this.closing || !Number.isFinite(s)) return
    this.playhead = s
    for (const t of this.tracks.values()) t.want = Math.max(t.want, s)
    this.enforceBudget()
    if (!this.paused) for (const t of this.tracks.values()) this.schedule(t)
  }

  /** A .srt/.vtt/.ass/.ssa the host picked becomes a new subtitle track for everyone; null if unusable. */
  async addSubtitle(file: string): Promise<CinemaSubtitleTrack | null> {
    const ext = extname(file).toLowerCase()
    if (!this.ready || this.closing || !['.srt', '.vtt', '.ass', '.ssa'].includes(ext) || this.nextSubId > 999) return null
    const id = this.nextSubId++
    try {
      if ((await stat(file)).size > MAX_SUBTITLE_BYTES) return null
      const text = decodeSubtitle(await readFile(file))
      const format = ext === '.ass' || ext === '.ssa' ? 'ass' : 'vtt'
      await this.ready
      await this.addSubtitlePieces(id, format, ext === '.srt' ? srtToVtt(text) : text, [])
      const title = capText(stripControls(basename(file, extname(file))).trim(), 120)
      return { id, lang: null, title: title || null, format, external: true }
    } catch {
      return null
    }
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
      await Promise.allSettled([...pending, this.extras])
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
      id, audio, dir: join(this.opts.dir, id), pieces: new Map(), nextN: 1, want, limit: this.opts.film.durationS,
      run: null, runs: 0, queue: Promise.resolve(), ingesting: Promise.resolve(), timescale: NaN, delayS: 0,
    }
    this.tracks.set(id, t)
    this.schedule(t)
  }

  private schedule(t: Track): void {
    t.queue = t.queue.then(() => this.step(t)).catch((e: unknown) => this.emitError(t.id, message(e)))
  }

  private sorted(t: Track): Piece[] {
    return [...t.pieces.entries()].filter(([n]) => n > 0).map(([, p]) => p).sort((a, b) => a.startS - b.startS)
  }

  /** First time >= `from` not covered by contiguous pieces; null when the coverage reaches the end of the data. */
  private gap(t: Track, from: number): number | null {
    let g = from
    for (const p of this.sorted(t)) {
      if (p.startS - EPS > g) break
      if (end(p) + EPS >= g) g = Math.max(g, end(p))
    }
    return g >= t.limit - EPS ? null : g
  }

  private async step(t: Track): Promise<void> {
    await this.ready
    if (this.closing || this.paused) return
    let g = this.gap(t, t.want)
    const run = t.run
    if (run) {
      // Keep a run that is producing the target or will reach it within JUMP_S.
      if (g === null || (g >= run.from - EPS && g <= run.frontier + JUMP_S)) return
      run.abort.abort()
      await run.exited
      if (this.closing || this.paused) return
      g = this.gap(t, t.want)
    }
    if (g !== null) await this.startRun(t, g)
  }

  private async startRun(t: Track, g: number): Promise<void> {
    const { film, path, bins, videoStreamIndex, readRate } = this.opts
    const pieces = this.sorted(t)
    const prev = pieces.filter((p) => end(p) <= g + EPS).pop()
    // Continue right after the coverage when the target is close; the 10 ms keeps -ss off the previous keyframe. The ffmpeg
    // CLI seeks to 3/23 s before -ss when a stream has a decode delay (B-frames): add it back so video lands on the keyframe <= from.
    const cont = prev !== undefined && g - end(prev) < JUMP_S
    const from = cont ? end(prev) : g
    const seek = t.audio ? from : from + (cont ? 0.01 : 0) + (t.delayS > 0 ? 3 / 23 : 0)
    const stopAt = pieces.find((p) => p.startS > from + EPS)?.startS ?? null
    // The stop check is on DTS: a keyframe's DTS is its startS minus the B-frame delay; 1 ms keeps it out.
    const to = stopAt === null ? [] : ['-to', (stopAt - (t.audio ? 0 : t.delayS) - 0.001).toFixed(3)]
    await mkdir(t.dir, { recursive: true })
    if (this.closing || this.paused) return
    const k = ++t.runs
    const playlist = join(t.dir, `run${k}.m3u8`)
    const run: Run = {
      from, stopAt, playlist, initFile: join(t.dir, `run${k}-init.mp4`), abort: new AbortController(),
      seen: 0, frontier: from, added: 0, dead: false, exited: Promise.resolve(),
    }
    const media = t.audio
      ? ['-map', `0:a:${t.audio.id}`, ...audioArgs(t.audio)]
      : ['-map', `0:${videoStreamIndex}`, '-c:v', 'copy', ...(film.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-avoid_negative_ts', 'disabled']
    const args = [
      '-v', 'error', '-y', '-copyts', '-start_at_zero', ...(readRate ? ['-readrate', String(readRate)] : []),
      ...(seek > 0 ? ['-ss', seek.toFixed(3)] : []), '-i', path, ...media, ...to,
      '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', String(HLS_TIME_S), '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file', '-hls_segment_options', 'movflags=+frag_discont',
      '-start_number', String(t.nextN), '-hls_fmp4_init_filename', basename(run.initFile),
      '-hls_segment_filename', ff(join(t.dir.replace(/%/g, '%%'), '%d.m4s')), ff(playlist),
    ]
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
        t.limit = Math.min(t.limit, run.frontier)
        this.emitError(t.id, `ffmpeg ${code}: ${last}`)
      } else if (run.stopAt === null) {
        // Reached the end of the data: nothing to generate past it, ever.
        t.limit = Math.min(t.limit, run.frontier)
        if (last && run.frontier < this.opts.film.durationS - END_SLACK_S) this.emitError(t.id, `ended at ${run.frontier.toFixed(1)} s: ${last}`)
      }
    }
    // A run of ours that produced nothing must not be restarted in a loop.
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

  /** Reads the segments the run completed since the last poll: hash, absolute start, budget. */
  private async ingestNow(t: Track, run: Run): Promise<void> {
    if (run.dead || this.closing) return
    const entries = parsePlaylist(await readFile(run.playlist, 'utf8').catch(() => ''))
    const items: CinemaPieceMeta[] = []
    const from = t.nextN
    for (const { durS, name } of entries.slice(run.seen)) {
      const file = join(t.dir, name)
      const bytes = await readFile(file)
      if (!t.pieces.has(0)) {
        const init = await readFile(run.initFile)
        const hash = sha256(init)
        t.timescale = initTimescale(init)
        t.delayS = initDelay(init)
        t.pieces.set(0, { startS: -1, durS: 0, bytes: init.length, hash, file: run.initFile })
        this.total += init.length
        this.emitPieces(t.id, 0, [[-1, 0, init.length, hash]])
      } else if (run.seen === 0 && run.initFile !== t.pieces.get(0)!.file && sha256(await readFile(run.initFile)) !== t.pieces.get(0)!.hash) {
        this.emitError(t.id, 'init segment changed between runs')
      }
      const startS = segmentStart(bytes, t.timescale)
      const n = Number(name.slice(0, -4))
      const overlaps = this.sorted(t).some((p) => startS < end(p) - EPS && startS + durS > p.startS + EPS)
      if (!Number.isFinite(startS) || !Number.isFinite(durS) || overlaps || n !== t.nextN) {
        this.kill(t, run, overlaps ? 'overlapping piece' : 'unreadable piece')
        await unlink(file).catch(() => {})
        break
      }
      run.seen++
      run.added++
      run.frontier = Math.max(run.frontier, startS + durS)
      t.pieces.set(n, { startS, durS, bytes: bytes.length, hash: sha256(bytes), file })
      t.nextN = n + 1
      this.total += bytes.length
      items.push([startS, durS, bytes.length, t.pieces.get(n)!.hash])
    }
    if (items.length === 0) return
    this.emitPieces(t.id, from, items)
    if (t.id === 'v') this.firstVideo()
    this.enforceBudget()
  }

  // ---- disk budget --------------------------------------------------------------------------------------------------------

  private enforceBudget(): void {
    const gone = new Map<CinemaTrackId, number[]>()
    while (this.total > this.opts.budgetBytes) {
      const v = this.victim()
      if (!v) {
        if (!this.paused) for (const t of this.tracks.values()) t.run?.abort.abort()
        this.paused = true
        break
      }
      const p = v.t.pieces.get(v.n)!
      v.t.pieces.delete(v.n)
      this.total -= p.bytes
      void unlink(p.file).catch(() => {})
      gone.set(v.t.id, [...(gone.get(v.t.id) ?? []), v.n])
    }
    if (this.total <= this.opts.budgetBytes) this.paused = false
    for (const [track, n] of gone) for (const cb of this.evictCbs) cb({ track, n })
  }

  private victim(): { t: Track; n: number } | null {
    const p = this.playhead
    let best: { t: Track; n: number; rank: number; key: number } | null = null
    for (const t of this.tracks.values()) {
      const covered = this.gap(t, p) ?? Infinity
      for (const [n, x] of t.pieces) {
        if (n === 0) continue
        const [rank, key] = end(x) < p - BEHIND_FAR_S ? [0, x.startS] : end(x) <= p ? [1, x.startS] : x.startS > covered ? [2, -x.startS] : [3, 0]
        if (rank < 3 && (!best || rank < best.rank || (rank === best.rank && key < best.key))) best = { t, n, rank, key }
      }
    }
    return best
  }

  // ---- single-file tracks -------------------------------------------------------------------------------------------------

  private async addSingle(track: CinemaTrackId, files: string[]): Promise<void> {
    const pieces: Piece[] = []
    for (const file of files) {
      const b = await readFile(file)
      pieces.push({ startS: 0, durS: 0, bytes: b.length, hash: sha256(b), file })
    }
    if (this.closing) return
    this.singles.set(track, pieces)
    this.total += pieces.reduce((a, p) => a + p.bytes, 0)
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
