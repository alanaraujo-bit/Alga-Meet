// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decodeSubtitle, extractFonts, extractSubtitle, makePoster, makeThumbs, srtToVtt } from './extras'

const bins = { ffmpeg: join(process.cwd(), 'build', 'ffmpeg', 'ffmpeg.exe'), ffprobe: join(process.cwd(), 'build', 'ffmpeg', 'ffprobe.exe') }
const fixture = (n: string) => join(process.cwd(), 'test-fixtures', 'cinema', n)
const ready = existsSync(bins.ffmpeg) && existsSync(fixture('h264-ac3-51.mkv')) && existsSync(fixture('h264-aac-srt-ass.mkv'))

const isWebp = (file: string) => {
  const b = readFileSync(file)
  return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'
}
const size = (file: string) =>
  execFileSync(bins.ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()

describe('decodeSubtitle', () => {
  it('Windows-1252 bytes decode to the right accents', () => {
    expect(decodeSubtitle(Uint8Array.from([0x61, 0xe7, 0xe3, 0x6f]))).toBe('ação')
    expect(decodeSubtitle(Uint8Array.from([0xe7, 0xe3, 0x6f]))).toBe('ção')
  })
  it('UTF-8 stays UTF-8 and loses its BOM', () => {
    expect(decodeSubtitle(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ção')]))).toBe('ção')
    expect(decodeSubtitle(new TextEncoder().encode('Olá'))).toBe('Olá')
  })
  it('UTF-16 with BOM (Notepad "Unicode")', () => {
    expect(decodeSubtitle(Uint8Array.from([0xff, 0xfe, 0xe7, 0, 0xe3, 0, 0x6f, 0]))).toBe('ção')
  })
})

describe('srtToVtt', () => {
  it('adds the header and fixes only cue timing commas', () => {
    expect(srtToVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\nÀs 12:00:00,000 em ponto\r\n')).toBe(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nÀs 12:00:00,000 em ponto\n',
    )
  })
})

describe.skipIf(!ready)('extras on real fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-extras-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('extracts the SRT as WebVTT and the ASS as ASS', async () => {
    const vtt = await extractSubtitle(bins, fixture('h264-aac-srt-ass.mkv'), { id: 0, format: 'vtt' }, dir)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('Legenda SRT')
    const ass = await extractSubtitle(bins, fixture('h264-aac-srt-ass.mkv'), { id: 1, format: 'ass' }, dir)
    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('Dialogue:')
  })
  it('dumps attached fonts under safe names', async () => {
    const fonts = await extractFonts(bins, fixture('h264-aac-srt-ass.mkv'), dir)
    expect(fonts.map((f) => f.name)).toEqual(['arial.ttf'])
    expect(fonts[0]!.file.startsWith(dir)).toBe(true)
    expect(readFileSync(fonts[0]!.file).length).toBeGreaterThan(100_000)
    expect(await extractFonts(bins, fixture('h264-ac3-51.mkv'), dir)).toEqual([])
  })
  it('poster: WebP 960 px wide', async () => {
    const out = join(dir, 'poster.webp')
    await makePoster(bins, fixture('h264-ac3-51.mkv'), 0, 20, out)
    expect(isWebp(out)).toBe(true)
    expect(size(out)).toBe('960,540')
    expect(existsSync(join(dir, 'poster.webp.c0.webp'))).toBe(false)
  })
  it('poster: a failed candidate is skipped, none left on disk; all failed -> throws, still clean', async () => {
    const sub = mkdtempSync(join(dir, 'poster-'))
    // A 120 s "duration" puts the 25 % and 40 % candidates past the end of the 20 s file.
    await makePoster(bins, fixture('h264-ac3-51.mkv'), 0, 120, join(sub, 'p.webp'))
    expect(isWebp(join(sub, 'p.webp'))).toBe(true)
    await expect(makePoster(bins, fixture('h264-ac3-51.mkv'), 0, 1000, join(sub, 'q.webp'))).rejects.toThrow('no poster frame')
    expect(readdirSync(sub)).toEqual(['p.webp'])
  })
  it('thumbs: WebP sprite, 10 columns of 160 px, one tile per 10 s', async () => {
    const out = join(dir, 'thumbs.webp')
    await makeThumbs(bins, fixture('h264-ac3-51.mkv'), 0, { durationS: 20, width: 1920, height: 1080 }, out)
    expect(isWebp(out)).toBe(true)
    expect(size(out)).toBe('1600,90')
  })
})
