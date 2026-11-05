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

interface Entry { path: string; factory: PieceFactory | null; unsubs: (() => void)[] }
const files = new Map<string, Entry>()

const SUBTITLE_EXTS = ['srt', 'ass', 'ssa', 'vtt']
const TRACK_RE = /^(v|poster|thumbs|[as]\d{1,3})$/
/** Share of the free disk the host's piece cache may use (global constraints: min(file size, 20% of free)). */
const DISK_SHARE = 0.2

const register = (path: string): { fileId: string; name: string } => {
  const fileId = randomBytes(16).toString('base64url')
  files.set(fileId, { path, factory: null, unsubs: [] })
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

/** A path from the renderer (drop) must be an absolute path to an existing regular file with a video extension. */
async function validVideo(p: unknown): Promise<string> {
  const path = str(p, 4096)
  if (!isAbsolute(path) || !VIDEO_EXTS.has(extname(path).toLowerCase())) throw new TypeError('not a video file path')
  if (!(await stat(path)).isFile()) throw new TypeError('not a file')
  return path
}

async function closeEntry(id: string): Promise<void> {
  const e = files.get(id)
  if (!e) return
  files.delete(id)
  for (const u of e.unsubs) u()
  await e.factory?.close()
}

export const closeAllCinema = (): Promise<unknown> => Promise.all([...files.keys()].map(closeEntry))

async function budget(path: string): Promise<number> {
  const size = (await stat(path)).size
  const free = await statfs(cinemaRoot()).then((s) => s.bavail * s.bsize, () => Number.POSITIVE_INFINITY)
  return Math.min(size, Math.floor(free * DISK_SHARE))
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

  handle(IPC.cinemaFromDrop, async (p) => register(await validVideo(p)))

  handle(IPC.cinemaProbe, async (id) => {
    const e = entry(id)
    const fileId = id as string
    const r = await probeFile(e.path)
    if ('error' in r) return r
    // A re-probe replaces the previous factory.
    for (const u of e.unsubs.splice(0)) u()
    await e.factory?.close()
    const f = new PieceFactory({ path: e.path, film: r.film, dir: sessionDir(), budgetBytes: await budget(e.path), bins: ffmpegBins(), videoStreamIndex: r.videoStreamIndex })
    e.factory = f
    e.unsubs.push(
      f.onPieces((ev) => emit(IPC.cinemaPieces, { fileId, ...ev })),
      f.onEvicted((ev) => emit(IPC.cinemaEvicted, { fileId, ...ev })),
      f.onError((ev) => emit(IPC.cinemaError, { fileId, ...ev })),
    )
    const next = (await nextEpisodes(dirname(e.path), e.path).catch(() => [])).map(register)
    return { film: r.film, warnings: r.warnings, next }
  })

  handle(IPC.cinemaStart, (id, startS, audioIds) => {
    const f = factory(id)
    f.start(seconds(startS), arr(audioIds, 16).map((a) => int(a, 0, 999)))
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
    return path ? f.addSubtitle(path) : null
  })

  handle(IPC.cinemaInit, async (id, t) => exact(await factory(id).init(track(t))))
  handle(IPC.cinemaPiece, async (id, t, n) => exact(await factory(id).piece(track(t), int(n, 0, 1_000_000))))
  handle(IPC.cinemaClose, async (id) => {
    entry(id)
    await closeEntry(id as string).catch((err) => log.warn('cinema close failed', err))
  })
}
