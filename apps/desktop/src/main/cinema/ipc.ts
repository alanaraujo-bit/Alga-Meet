import { randomBytes } from 'node:crypto'
import { stat, statfs } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import { dialog } from 'electron'
import type { CinemaTrackId } from '@alga/shared'
import { IPC } from '../../shared/ipc'
import { arr, emit, handle, int, on, str } from '../ipc'
import { log } from '../log'
import { mainWindow } from '../window'
import { checkFfmpeg, ffmpegBins } from './ffmpeg'
import { VIDEO_EXTS, nextEpisodes } from './names'
import { PieceFactory, cinemaRoot, sessionDir } from './pieces'
import { probeFile } from './probe'

/*
 * Renderer bridge of the cinema engine. The renderer only ever holds opaque fileIds; the local path (and the ffprobe stream
 * index) stay in this map, in main. Unknown or closed ids throw, so invoke() rejects and send() is logged and dropped.
 */

interface Entry { path: string; factory: PieceFactory | null; unsubs: (() => void)[]; probing: Promise<unknown> | null; siblings: string[] }
const files = new Map<string, Entry>()

const SUBTITLE_EXTS = ['srt', 'ass', 'ssa', 'vtt']
const TRACK_RE = /^(v|poster|thumbs|[as]\d{1,3})$/
/** Share of the free disk the host's piece cache may use (global constraints: min(file size, 20% of free)). */
const DISK_SHARE = 0.2

const register = (path: string): { fileId: string; name: string } => {
  const fileId = randomBytes(16).toString('base64url')
  files.set(fileId, { path, factory: null, unsubs: [], probing: null, siblings: [] })
  return { fileId, name: basename(path) }
}
const entry = (v: unknown): Entry => {
  const e = files.get(str(v, 64))
  if (!e) throw new Error('unknown file')
  return e
}
const factory = (v: unknown): PieceFactory => {
  const f = entry(v).factory
  if (!f) throw new Error('file not probed')
  return f
}
const track = (v: unknown): CinemaTrackId => {
  const t = str(v, 16)
  if (!TRACK_RE.test(t)) throw new TypeError('expected track id')
  return t as CinemaTrackId
}
const seconds = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError('expected seconds')
  return v
}
/** Exact-length ArrayBuffer of a Node Buffer (its `.buffer` may be a shared pool). */
const exact = (b: Uint8Array | null): ArrayBuffer | null => (b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer : null)

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The path and its folder in both slash styles (case-insensitive) become "<arquivo>": the renderer never learns them. */
export function redact(path: string, text: string): string {
  const forms = [path, dirname(path)].flatMap((x) => [x, x.replaceAll('\\', '/'), x.replaceAll('/', '\\')])
  const re = new RegExp([...new Set(forms)].filter((x) => x.length > 1).sort((a, b) => b.length - a.length).map(esc).join('|'), 'gi')
  return text.replace(re, '<arquivo>')
}
/** Runs fn; a rejection carries only redacted text (Electron relays error messages, which may hold the path). */
async function safe<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw new Error(redact(path, err instanceof Error ? err.message : String(err)))
  }
}

/** A path must be absolute, an existing regular file with a video extension; drops may not be UNC/device paths (stat would reach out to an SMB host). */
async function validVideo(p: unknown, drop = false): Promise<string> {
  const path = str(p, 4096)
  if (drop && /^[\\/]{2}/.test(path)) throw new TypeError('network and device paths are not accepted')
  if (!isAbsolute(path) || !VIDEO_EXTS.has(extname(path).toLowerCase())) throw new TypeError('not a video file path')
  if (!(await safe(path, () => stat(path))).isFile()) throw new TypeError('not a file')
  return path
}

async function closeEntry(id: string): Promise<void> {
  const e = files.get(id)
  if (!e) return
  files.delete(id)
  for (const u of e.unsubs.splice(0)) u()
  await Promise.all([e.factory?.close(), releaseSiblings(e)])
}
async function releaseSiblings(e: Entry): Promise<void> {
  await Promise.all(e.siblings.splice(0).map(closeEntry))
}

export const closeAllCinema = (): Promise<unknown> => Promise.all([...files.keys()].map((id) => closeEntry(id).catch((err) => log.warn('cinema close failed', err))))

async function budget(path: string): Promise<number> {
  const size = (await stat(path)).size
  const free = await statfs(cinemaRoot()).then((s) => s.bavail * s.bsize, () => Number.POSITIVE_INFINITY)
  return Math.min(size, Math.floor(free * DISK_SHARE))
}

async function doProbe(fileId: string, e: Entry) {
  const r = await probeFile(e.path)
  if ('error' in r) return r
  // A re-probe replaces the previous factory and releases its sibling ids.
  for (const u of e.unsubs.splice(0)) u()
  await Promise.all([e.factory?.close(), releaseSiblings(e)])
  e.factory = null
  const bytes = await budget(e.path)
  const nextPaths = await nextEpisodes(dirname(e.path), e.path).catch(() => [])
  // Closed while probing: nothing is created, so no orphan ffmpeg.
  if (files.get(fileId) !== e) throw new Error('closed')
  const f = new PieceFactory({ path: e.path, film: r.film, dir: sessionDir(), budgetBytes: bytes, bins: ffmpegBins(), videoStreamIndex: r.videoStreamIndex })
  e.factory = f
  e.unsubs.push(
    f.onPieces((ev) => emit(IPC.cinemaPieces, { fileId, ...ev })),
    f.onEvicted((ev) => emit(IPC.cinemaEvicted, { fileId, ...ev })),
    f.onError((ev) => emit(IPC.cinemaError, { fileId, track: ev.track, reason: redact(e.path, ev.reason) })),
  )
  const next = nextPaths.map(register)
  e.siblings.push(...next.map((n) => n.fileId))
  return { film: r.film, warnings: r.warnings, next }
}

export function registerCinemaIpc(): void {
  handle(IPC.cinemaCheckFfmpeg, () => checkFfmpeg())

  handle(IPC.cinemaPick, async () => {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Video', extensions: [...VIDEO_EXTS].map((x) => x.slice(1)) }] }
    const win = mainWindow()
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = r.canceled ? undefined : r.filePaths[0]
    return path ? register(await validVideo(path)) : null
  })

  handle(IPC.cinemaFromDrop, async (p) => register(await validVideo(p, true)))

  handle(IPC.cinemaProbe, (id) => {
    const e = entry(id)
    // One probe at a time per file: concurrent calls share the in-flight one.
    e.probing ??= safe(e.path, () => doProbe(id as string, e)).finally(() => { e.probing = null })
    return e.probing
  })

  handle(IPC.cinemaStart, (id, startS, audioIds) => {
    const f = factory(id)
    const at = seconds(startS)
    const audio = arr(audioIds, 16).map((a) => int(a, 0, 999))
    return safe(entry(id).path, () => f.start(at, audio))
  })
  on(IPC.cinemaEnsure, (id, t, at) => factory(id).ensure(track(t), seconds(at)))
  on(IPC.cinemaAddAudio, (id, a) => factory(id).addAudio(int(a, 0, 999)))
  on(IPC.cinemaSetPlayhead, (id, s) => factory(id).setPlayhead(seconds(s)))

  handle(IPC.cinemaAddSubtitle, async (id) => {
    const f = factory(id)
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Subtitles', extensions: SUBTITLE_EXTS }] }
    const win = mainWindow()
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const path = r.canceled ? undefined : r.filePaths[0]
    // Both the video's and the subtitle file's own path are redacted.
    return path ? safe(entry(id).path, () => safe(path, () => f.addSubtitle(path))) : null
  })

  handle(IPC.cinemaInit, async (id, t) => exact(await safe(entry(id).path, async () => factory(id).init(track(t)))))
  handle(IPC.cinemaPiece, async (id, t, n) => exact(await safe(entry(id).path, async () => factory(id).piece(track(t), int(n, 0, 1_000_000)))))
  handle(IPC.cinemaClose, async (id) => {
    entry(id)
    await closeEntry(id as string).catch((err) => log.warn('cinema close failed', err))
  })
}
