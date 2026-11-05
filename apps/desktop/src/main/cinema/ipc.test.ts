// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  sends: new Map<string, (...a: unknown[]) => void>(),
  emitted: [] as [string, unknown][],
  picks: [] as string[],
  factories: [] as { closed: boolean; cbs: Record<string, (e: unknown) => void> }[],
  piece: new Uint8Array(0) as Uint8Array | null,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => process.env.TEMP ?? '/tmp', getAppPath: () => process.cwd() },
  dialog: { showOpenDialog: async () => (h.picks.length ? { canceled: false, filePaths: [h.picks.shift()!] } : { canceled: true, filePaths: [] }) },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {},
}))
vi.mock('../window', () => ({ mainWindow: () => null }))
vi.mock('../log', () => ({ log: { warn: () => {}, info: () => {} } }))
vi.mock('../ipc', async () => {
  const real = await vi.importActual<typeof import('../ipc')>('../ipc')
  return {
    ...real,
    handle: (c: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(c, async (...a) => fn(...a)),
    on: (c: string, fn: (...a: unknown[]) => void) => h.sends.set(c, fn),
    emit: (c: string, p: unknown) => h.emitted.push([c, p]),
  }
})
vi.mock('./ffmpeg', () => ({ checkFfmpeg: async () => ({ ok: true, version: 'x' }), ffmpegBins: () => ({ ffmpeg: 'f', ffprobe: 'p' }) }))
vi.mock('./probe', () => ({ probeFile: async () => ({ film: { title: 't', durationS: 10, audio: [], subtitles: [] }, warnings: [], videoStreamIndex: 7 }) }))
vi.mock('./names', async () => ({ ...(await vi.importActual<object>('./names')), nextEpisodes: async () => ['C:\\secret\\dir\\S01E02.mkv'] }))
vi.mock('./pieces', () => ({
  cinemaRoot: () => process.env.TEMP ?? '/tmp',
  sessionDir: () => 'x',
  PieceFactory: class {
    s = { closed: false, cbs: {} as Record<string, (e: unknown) => void> }
    constructor(public opts: unknown) { h.factories.push(this.s) }
    start() {}
    ensure() {}
    addAudio() {}
    setPlayhead() {}
    async addSubtitle(p: string) { return { id: 0, lang: null, title: p, format: 'vtt', external: true } }
    async init() { return h.piece }
    async piece() { return h.piece }
    onPieces(cb: (e: unknown) => void) { this.s.cbs.pieces = cb; return () => {} }
    onEvicted(cb: (e: unknown) => void) { this.s.cbs.evicted = cb; return () => {} }
    onError(cb: (e: unknown) => void) { this.s.cbs.error = cb; return () => {} }
    async close() { this.s.closed = true }
  },
}))

import { IPC } from '../../shared/ipc'
import { registerCinemaIpc } from './ipc'

const dir = mkdtempSync(join(tmpdir(), 'alga-cinema-ipc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const movie = join(dir, 'S01E01.mkv')
writeFileSync(movie, 'x')
registerCinemaIpc()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (c: string, ...a: unknown[]) => h.handlers.get(c)!(...a) as Promise<any>
const probed = async () => {
  h.picks.push(movie)
  const { fileId } = await call(IPC.cinemaPick)
  const r = await call(IPC.cinemaProbe, fileId)
  return { fileId, r }
}
beforeEach(() => { h.emitted.length = 0; h.factories.length = 0 })

describe('cinema ipc', () => {
  it('unknown fileId rejects (invoke) and throws (send)', async () => {
    await expect(call(IPC.cinemaProbe, 'nope')).rejects.toThrow('unknown file')
    await expect(call(IPC.cinemaPiece, 'nope', 'v', 1)).rejects.toThrow()
    expect(() => h.sends.get(IPC.cinemaEnsure)!('nope', 'v', 1)).toThrow()
  })

  it('two picks of the same file give two fileIds; the path never comes back', async () => {
    h.picks.push(movie, movie)
    const a = await call(IPC.cinemaPick)
    const b = await call(IPC.cinemaPick)
    expect(a.fileId).not.toBe(b.fileId)
    expect(a.fileId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(a).toEqual({ fileId: a.fileId, name: 'S01E01.mkv' })
    expect(await call(IPC.cinemaPick)).toBeNull()
  })

  it('probe returns next as fresh ids + names only (no paths, no stream index)', async () => {
    const { r } = await probed()
    expect(r.next).toEqual([{ fileId: expect.any(String), name: 'S01E02.mkv' }])
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(r.videoStreamIndex).toBeUndefined()
  })

  it('validators: bad track, negative / fractional n, NaN atS', async () => {
    const { fileId } = await probed()
    const ensure = h.sends.get(IPC.cinemaEnsure)!
    for (const t of ['x', 'a', 'a1000', '../v', 'v ']) expect(() => ensure(fileId, t, 1)).toThrow()
    expect(() => ensure(fileId, 'v', Number.NaN)).toThrow()
    expect(() => ensure(fileId, 'v', -1)).toThrow()
    expect(() => ensure(fileId, 'a2', 5)).not.toThrow()
    await expect(call(IPC.cinemaPiece, fileId, 'v', -1)).rejects.toThrow()
    await expect(call(IPC.cinemaPiece, fileId, 'v', 1.5)).rejects.toThrow()
    await expect(call(IPC.cinemaStart, fileId, 0, [1.2])).rejects.toThrow()
    await expect(call(IPC.cinemaStart, fileId, Number.NaN, [])).rejects.toThrow()
  })

  it('piece/init return an exact-length ArrayBuffer, not a Buffer', async () => {
    const { fileId } = await probed()
    h.piece = Buffer.from('xxabcxx').subarray(2, 5) // a view into a bigger ArrayBuffer
    const b = await call(IPC.cinemaPiece, fileId, 'v', 1)
    expect(b).toBeInstanceOf(ArrayBuffer)
    expect(Buffer.from(b).toString()).toBe('abc')
    expect(await call(IPC.cinemaInit, fileId, 'v')).toBeInstanceOf(ArrayBuffer)
    h.piece = null
    expect(await call(IPC.cinemaPiece, fileId, 'v', 2)).toBeNull()
  })

  it('factory events are forwarded tagged with the fileId', async () => {
    const { fileId } = await probed()
    h.factories[0]!.cbs.pieces!({ track: 'v', from: 1, items: [] })
    h.factories[0]!.cbs.evicted!({ track: 'v', n: [1] })
    expect(h.emitted).toEqual([[IPC.cinemaPieces, { fileId, track: 'v', from: 1, items: [] }], [IPC.cinemaEvicted, { fileId, track: 'v', n: [1] }]])
  })

  it('addSubtitle: dialog -> factory; cancel -> null', async () => {
    const { fileId } = await probed()
    h.picks.push(join(dir, 'a.srt'))
    expect(await call(IPC.cinemaAddSubtitle, fileId)).toMatchObject({ id: 0, format: 'vtt' })
    expect(await call(IPC.cinemaAddSubtitle, fileId)).toBeNull()
  })

  it('close invalidates the fileId and closes the factory', async () => {
    const { fileId } = await probed()
    await call(IPC.cinemaClose, fileId)
    expect(h.factories[0]!.closed).toBe(true)
    await expect(call(IPC.cinemaPiece, fileId, 'v', 1)).rejects.toThrow('unknown file')
    await expect(call(IPC.cinemaClose, fileId)).rejects.toThrow()
  })

  it('fromDrop accepts only absolute existing video files', async () => {
    expect(await call(IPC.cinemaFromDrop, movie)).toMatchObject({ name: 'S01E01.mkv' })
    await expect(call(IPC.cinemaFromDrop, 'S01E01.mkv')).rejects.toThrow()
    await expect(call(IPC.cinemaFromDrop, join(dir, 'missing.mkv'))).rejects.toThrow()
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(call(IPC.cinemaFromDrop, join(dir, 'a.txt'))).rejects.toThrow()
    await expect(call(IPC.cinemaFromDrop, 5)).rejects.toThrow()
  })
})
