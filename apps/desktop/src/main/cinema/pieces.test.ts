// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))

import { setFfmpegBinsForTest } from './ffmpeg'
import { findBox } from './mp4'
import { probeFile } from './probe'
import { PieceFactory, cleanupStale, sessionDir, type PieceEvent } from './pieces'

const bins = { ffmpeg: join(process.cwd(), 'build', 'ffmpeg', 'ffmpeg.exe'), ffprobe: join(process.cwd(), 'build', 'ffmpeg', 'ffprobe.exe') }
const fixture = (n: string) => join(process.cwd(), 'test-fixtures', 'cinema', n)
const ready = existsSync(bins.ffmpeg) && existsSync(fixture('h264-ac3-51.mkv')) && existsSync(fixture('h264-aac-srt-ass.mkv'))
const root = mkdtempSync(join(tmpdir(), 'alga-pieces-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond: () => boolean, what: string, ms = 30_000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}

async function make(file: string, opts: { budget?: number; readRate?: number; path?: string; bins?: typeof bins } = {}) {
  setFfmpegBinsForTest(bins)
  const path = opts.path ?? fixture(file)
  const probe = await probeFile(path)
  if ('error' in probe) throw new Error(probe.error)
  const dir = sessionDir(root)
  const f = new PieceFactory({ path, film: probe.film, videoStreamIndex: probe.videoStreamIndex, dir, budgetBytes: opts.budget ?? 1e12, bins: opts.bins ?? bins, readRate: opts.readRate })
  const index = new Map<CinemaTrackId, Map<number, CinemaPieceMeta>>()
  const errors: { track: CinemaTrackId; reason: string }[] = []
  const evicted: { track: CinemaTrackId; n: number[] }[] = []
  let mediaEvents = 0
  f.onPieces((e: PieceEvent) => {
    if (/^(v|a\d+)$/.test(e.track)) mediaEvents++
    const m = index.get(e.track) ?? new Map<number, CinemaPieceMeta>()
    e.items.forEach((it, i) => m.set(e.from + i, it))
    index.set(e.track, m)
  })
  f.onError((e) => errors.push(e))
  f.onEvicted((e) => evicted.push(e))
  const media = (t: CinemaTrackId) => [...(index.get(t) ?? [])].filter(([n]) => n > 0).sort((a, b) => a[1][0] - b[1][0])
  const gone = (t: CinemaTrackId) => new Set(evicted.filter((e) => e.track === t).flatMap((e) => e.n))
  const live = (t: CinemaTrackId) => media(t).filter(([n]) => !gone(t).has(n))
  /** End of the contiguous coverage that starts at `from` (0.1 s slack). */
  const reach = (t: CinemaTrackId, from = 0) => {
    let end = from
    for (const [, m] of live(t)) if (m[0] <= end + 0.1 && m[0] + m[1] > end) end = m[0] + m[1]
    return end
  }
  /** Live piece of `t` covering time `x`. */
  const at = (t: CinemaTrackId, x: number) => live(t).find(([, m]) => m[0] <= x && x < m[0] + m[1])
  /** No new media piece and no eviction for 1.2 s: the factory settled (no run/evict loop). */
  const quiet = async () => {
    const before = [mediaEvents, evicted.length]
    await sleep(1200)
    expect([mediaEvents, evicted.length]).toEqual(before)
  }
  return { f, dir, film: probe.film, index, errors, evicted, media, live, gone, reach, at, quiet }
}

const probeLines = (args: string[], file: string) =>
  execFileSync(bins.ffprobe, ['-v', 'error', ...args, '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim().split(/\r?\n/)
const keyframes = (file: string) =>
  probeLines(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags'], file).filter((l) => l.includes('K')).map((l) => Number(l.split(',')[0]))

/** Sample payloads of an fMP4 media segment, in decode order (trun sizes over the moof-relative data offset). */
function samples(seg: Uint8Array): Uint8Array[] {
  const moof = findBox(seg, ['moof'])!
  const trun = findBox(seg, ['moof', 'traf', 'trun'])!
  const v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength)
  const flags = v.getUint32(trun.start) & 0xffffff
  expect(flags & 0x201).toBe(0x201) // data offset + per-sample size
  let o = trun.start + 8
  let data = moof.offset + v.getInt32(o)
  o += 4
  if (flags & 0x4) o += 4
  const out: Uint8Array[] = []
  for (let i = 0, count = v.getUint32(trun.start + 4); i < count; i++) {
    if (flags & 0x100) o += 4
    const size = v.getUint32(o)
    o += 4 + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0)
    out.push(seg.subarray(data, data + size))
    data += size
  }
  return out
}

describe('sessionDir / cleanupStale', () => {
  it('session dirs are random children of the root', () => {
    const a = sessionDir(root)
    expect(dirname(a)).toBe(root)
    expect(a).not.toBe(sessionDir(root))
  })
  it('removes dirs untouched for more than 1 h, keeps fresh ones', async () => {
    const r = join(root, 'stale-test')
    const old = join(r, 'old')
    mkdirSync(join(old, 'v'), { recursive: true })
    writeFileSync(join(old, 'v', '1.m4s'), 'x')
    const past = new Date(Date.now() - 2 * 3_600_000)
    for (const p of [join(old, 'v', '1.m4s'), join(old, 'v'), old]) utimesSync(p, past, past)
    mkdirSync(join(r, 'fresh'))
    await cleanupStale(r)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(r, 'fresh'))).toBe(true)
    await expect(cleanupStale(join(root, 'missing'))).resolves.toBeUndefined()
  })
})

describe.skipIf(!ready)('PieceFactory on real fixtures', () => {
  it('h264-ac3-51: video copied byte-exact and AAC audio, contiguous over 20 s, hashed', async () => {
    const s = await make('h264-ac3-51.mkv')
    s.f.start(0, [0])
    await waitFor(() => s.reach('v') > 19.8 && s.reach('a0') > 19.8, 'v and a0 to reach the end')
    for (const t of ['v', 'a0'] as const) {
      const media = s.media(t)
      expect(media[0]![1][0]).toBeCloseTo(0, 1)
      const total = media.reduce((acc, [, m]) => acc + m[1], 0)
      expect(Math.abs(total - 20)).toBeLessThan(0.1)
      media.slice(1).forEach(([, m], i) => expect(Math.abs(media[i]![1][0] + media[i]![1][1] - m[0])).toBeLessThan(0.1))
      const init = s.index.get(t)!.get(0)!
      expect(init.slice(0, 2)).toEqual([-1, 0])
      expect(await s.f.init(t)).toEqual(await s.f.piece(t, 0))
      for (const [n, m] of s.index.get(t)!) {
        const bytes = (await s.f.piece(t, n))!
        expect([bytes.length, sha(bytes)]).toEqual([m[2], m[3]])
      }
    }
    // Native video (§8): every copied sample is the source packet, byte for byte, in order.
    const ours: string[] = []
    for (const [n] of s.media('v')) for (const x of samples((await s.f.piece('v', n))!)) ours.push(`SHA256:${sha(x)}`)
    expect(ours).toEqual(probeLines(['-select_streams', 'v:0', '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256'], fixture('h264-ac3-51.mkv')))
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 60_000)

  it('every codec path: HEVC (hvc1), AV1 + Opus copy, E-AC-3/DTS to AAC, TrueHD to FLAC', async () => {
    const files = ['hevc10-hdr10-eac3-51.mkv', 'av1-opus-51.mkv', 'h264-dts-51.mkv', 'hevc10-truehd-71.mkv'].filter((n) => existsSync(fixture(n)))
    for (const file of files) {
      const s = await make(file)
      s.f.start(0, [0])
      await waitFor(() => s.reach('v') > 19.5 && s.reach('a0') > 19.5, `${file} to reach the end`)
      expect([file, s.errors]).toEqual([file, []])
      await s.f.close()
    }
  }, 60_000)

  it('ensure beyond the frontier starts a new run at a keyframe; the gap run stops at the existing piece', async () => {
    const s = await make('h264-ac3-51.mkv', { readRate: 4 })
    s.f.start(0, [0])
    const tracks = ['v', 'a0'] as const
    const at = (t: CinemaTrackId, x: number) => s.media(t).find(([, m]) => m[0] <= x && x < m[0] + m[1])
    await waitFor(() => tracks.every((t) => s.media(t).length > 0), 'first pieces')
    for (const t of tracks) expect(s.reach(t)).toBeLessThan(11) // still well before 15
    for (const t of tracks) s.f.ensure(t, 15)
    await waitFor(() => tracks.every((t) => at(t, 15)), 'pieces at 15 s')
    for (const t of tracks) s.f.ensure(t, 0)
    await waitFor(() => tracks.every((t) => s.reach(t) > 19.8), 'full coverage after the gap runs')
    for (const t of tracks) {
      const media = s.media(t)
      media.slice(1).forEach(([, m], i) => expect(Math.abs(media[i]![1][0] + media[i]![1][1] - m[0])).toBeLessThan(0.1))
      // Generation order: the run at 15 s came before the gap run that filled the piece right before it.
      const [n15, at15] = at(t, 15)!
      expect(at15[0]).toBeLessThanOrEqual(15)
      expect(media[media.findIndex(([n]) => n === n15) - 1]![0]).toBeGreaterThan(n15)
      expect([...s.index.get(t)!.keys()].sort((a, b) => a - b)).toEqual([...Array(s.index.get(t)!.size).keys()]) // dense n
    }
    expect(keyframes(fixture('h264-ac3-51.mkv')).map((k) => k.toFixed(2))).toContain(at('v', 15)![1][0].toFixed(2))
    // Per-run segment names: a killed run that lingers cannot overwrite the next run's files.
    expect(readdirSync(join(s.dir, 'v')).filter((f) => f.endsWith('.m4s')).every((f) => /^r\d+-\d+\.m4s$/.test(f))).toBe(true)
    expect(s.errors).toEqual([]) // includes: every run's init segment is byte-identical to piece 0
    await s.f.close()
  }, 60_000)

  it('close() kills the runs and deletes the session dir', async () => {
    const s = await make('h264-ac3-51.mkv', { readRate: 2 })
    s.f.start(0, [0])
    await waitFor(() => s.media('v').length > 0, 'first video piece')
    await s.f.close()
    expect(existsSync(s.dir)).toBe(false)
    expect(await s.f.piece('v', 1)).toBeNull()
    expect(s.errors).toEqual([])
  }, 30_000)

  it('1 MB budget: pieces behind the playhead are evicted, recent ones stay', async () => {
    const s = await make('h264-ac3-51.mkv', { budget: 1_000_000 })
    s.f.start(0, [])
    await waitFor(() => s.media('v').length > 0, 'first video piece')
    s.f.setPlayhead(10)
    await waitFor(() => !!s.at('v', 10) && s.media('v').filter(([, m]) => m[0] + m[1] <= 10).every(([n]) => s.gone('v').has(n)), 'old pieces gone, piece at 10 s')
    for (const [n, m] of s.media('v')) {
      if (m[0] + m[1] <= 10) expect(await s.f.piece('v', n)).toBeNull()
      else if (m[0] + m[1] > 10.1) expect((await s.f.piece('v', n))?.length).toBe(m[2])
    }
    const first = s.media('v')[0]!
    expect(first[1][0] + first[1][1]).toBeLessThanOrEqual(10)
    expect(await s.f.init('v')).not.toBeNull()
    // Needed again (seek back): regenerated under a NEW n, same bytes (copy is deterministic).
    s.f.setPlayhead(0)
    s.f.ensure('v', 0)
    await waitFor(() => s.live('v').some(([n, m]) => m[0] === 0 && n !== first[0]), 'regenerated piece at 0')
    const again = s.live('v').find(([, m]) => m[0] === 0)!
    expect(again[0]).toBeGreaterThan(first[0])
    expect(again[1]).toEqual(first[1])
    expect(s.gone('v').has(first[0])).toBe(true)
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 30_000)

  it('budget full, ensure ahead of the playhead: the target piece is made once and kept, no churn', async () => {
    const s = await make('h264-ac3-51.mkv', { budget: 1_000_000, readRate: 4 })
    s.f.start(0, [])
    await waitFor(() => s.media('v').length > 0, 'first video piece')
    expect(s.reach('v')).toBeLessThan(11)
    s.f.ensure('v', 15)
    await waitFor(() => !!s.at('v', 15), 'piece at 15 s')
    await s.quiet()
    expect(s.at('v', 15)).toBeTruthy()
    expect(s.media('v').length).toBeLessThanOrEqual(4)
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 30_000)

  it('budget full, ensure behind the playhead: regenerated once under a new n and kept, playhead piece kept, no churn', async () => {
    const s = await make('h264-ac3-51.mkv', { budget: 1_000_000 })
    s.f.start(0, [])
    await waitFor(() => s.media('v').length > 0, 'first video piece')
    s.f.setPlayhead(10)
    await waitFor(() => !!s.at('v', 10) && !s.at('v', 1), 'piece at 10 s, old pieces gone')
    const old = s.media('v')[0]!
    s.f.ensure('v', 1)
    await waitFor(() => !!s.at('v', 1), 'piece at 1 s again')
    await s.quiet()
    expect(s.at('v', 1)![0]).toBeGreaterThan(old[0])
    expect(s.at('v', 10)).toBeTruthy()
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 30_000)

  it('budget full, addAudio: the new track still gets its first pieces at the playhead, no churn', async () => {
    const s = await make('h264-ac3-51.mkv', { budget: 1_000_000 })
    s.f.start(0, [])
    await waitFor(() => s.media('v').length > 0, 'first video piece')
    await sleep(300)
    s.f.addAudio(0)
    await waitFor(() => !!s.at('a0', 0.5), 'a0 at the playhead')
    await s.quiet()
    expect(s.at('a0', 0.5)).toBeTruthy()
    expect(s.at('v', 0.5)).toBeTruthy()
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 30_000)

  it('a failed run is retried once, then reported; a later ensure() still generates (the track is not capped)', async () => {
    const b = { ...bins, ffmpeg: bins.ffprobe } // ffprobe refuses ffmpeg's arguments: exit != 0
    const s = await make('h264-ac3-51.mkv', { bins: b })
    s.f.start(0, [])
    await waitFor(() => s.errors.some((e) => e.track === 'v'), 'v error')
    await sleep(500)
    expect(s.errors.filter((e) => e.track === 'v')).toHaveLength(1)
    expect(s.media('v')).toEqual([])
    b.ffmpeg = bins.ffmpeg
    s.f.ensure('v', 0)
    await waitFor(() => s.reach('v') > 19.8, 'v after the retry')
    await s.f.close()
  }, 30_000)

  it('a run whose init segment differs from piece 0 is stopped and reported; none of its pieces go out', async () => {
    const dir = mkdtempSync(join(root, 'swap-'))
    const path = join(dir, 'film.mkv')
    copyFileSync(fixture('h264-ac3-51.mkv'), path)
    const s = await make('', { path, budget: 1_000_000, readRate: 2 })
    s.f.start(0, [])
    const has = (t: CinemaTrackId) => s.index.get(t)?.has(0) ?? false
    await waitFor(() => s.media('v').length > 0 && has('poster') && has('thumbs'), 'first piece and extras')
    // The budget stopped the run; once its ffmpeg is gone the file can be replaced by another film.
    await waitFor(() => { try { copyFileSync(fixture('av1-opus-51.mkv'), path); return true } catch { return false } }, 'file swap')
    s.f.setPlayhead(4)
    await waitFor(() => s.errors.some((e) => e.track === 'v'), 'init error')
    expect(s.errors.find((e) => e.track === 'v')!.reason).toMatch(/init segment changed/)
    expect(s.media('v').map(([n]) => n)).toEqual([1])
    await s.f.close()
  }, 30_000)

  it('addSubtitle: relative paths refused; close() waits for an in-flight one, nothing is written afterwards', async () => {
    const s = await make('h264-ac3-51.mkv')
    s.f.start(0, [])
    // Relative to the cwd on the same drive (across drives path.relative is absolute); test-fixtures is gitignored.
    const rel = join('test-fixtures', 'cinema', `${randomBytes(4).toString('hex')}.srt`)
    writeFileSync(rel, '1\n00:00:01,000 --> 00:00:02,000\nx\n')
    try {
      expect(await s.f.addSubtitle(rel)).toBeNull()
      const p = s.f.addSubtitle(join(process.cwd(), rel))
      await s.f.close()
      await p
      expect(existsSync(s.dir)).toBe(false)
    } finally {
      rmSync(rel, { force: true })
    }
  }, 30_000)

  it('truncated MKV: pieces up to the cut, then onError with a reason, nothing thrown', async () => {
    const dir = mkdtempSync(join(root, 'trunc-'))
    const path = join(dir, 'half.mkv')
    const full = readFileSync(fixture('h264-ac3-51.mkv'))
    writeFileSync(path, full.subarray(0, full.length >> 1))
    const s = await make('', { path })
    s.f.start(0, [0])
    await waitFor(() => s.errors.some((e) => e.track === 'v') && s.errors.some((e) => e.track === 'a0'), 'errors for v and a0')
    expect(s.reach('v')).toBeGreaterThan(4)
    expect(s.reach('v')).toBeLessThan(15)
    expect(s.errors.find((e) => e.track === 'v')!.reason).toMatch(/\S/)
    s.f.ensure('v', 18) // beyond the data: no new run, no new error loop
    await sleep(500)
    expect(s.errors.filter((e) => e.track === 'v')).toHaveLength(1)
    await s.f.close()
  }, 30_000)

  it('subtitles (+ attached font), poster, thumbs, copied AAC, external .srt in Windows-1252', async () => {
    const s = await make('h264-aac-srt-ass.mkv')
    s.f.start(0, [0])
    const has = (t: CinemaTrackId) => s.index.get(t)?.has(0) ?? false
    await waitFor(() => has('s0') && has('s1') && has('poster') && has('thumbs') && s.reach('a0') > 19.8, 'extras and a0')
    const json = async (t: CinemaTrackId) => JSON.parse(new TextDecoder().decode((await s.f.piece(t, 0))!))
    expect(await json('s0')).toMatchObject({ format: 'vtt', fonts: [] })
    expect((await json('s0')).text).toContain('Legenda SRT')
    const ass = await json('s1')
    expect(ass).toMatchObject({ format: 'ass', fonts: [{ name: 'arial.ttf', piece: 1 }] })
    const font = (await s.f.piece('s1', 1))!
    expect(s.index.get('s1')!.get(1)).toEqual([0, 0, font.length, sha(font)])
    for (const t of ['poster', 'thumbs'] as const) {
      const b = Buffer.from((await s.f.piece(t, 0))!)
      expect([b.toString('latin1', 0, 4), b.toString('latin1', 8, 12)]).toEqual(['RIFF', 'WEBP'])
      expect(s.index.get(t)!.get(0)!.slice(0, 2)).toEqual([0, 0])
    }
    const srt = join(root, `${randomBytes(4).toString('hex')}-legenda.srt`)
    writeFileSync(srt, Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nInforma\xe7\xe3o\r\n', 'latin1'))
    const track = await s.f.addSubtitle(srt)
    expect(track).toMatchObject({ id: 2, format: 'vtt', external: true, lang: null })
    await waitFor(() => has('s2'), 's2 piece')
    expect((await json('s2')).text).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nInformação\n')
    expect(s.errors).toEqual([])
    await s.f.close()
  }, 60_000)
})
