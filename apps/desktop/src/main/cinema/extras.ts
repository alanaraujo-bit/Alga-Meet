import { readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CinemaFilm, CinemaSubtitleTrack } from '@alga/shared'
import { runTool, type FfmpegBins } from './ffmpeg'
import { capText, stripControls } from './names'

// Single-file cinema tracks (spec §6.3, Ruling R27): text subtitles (+ fonts attached to the MKV for ASS), the poster and
// the timeline thumbnail sprite. ffmpeg runs in the main process only, args as arrays, with a timeout and the caller's signal.

/** A subtitle text larger than this is not a subtitle. */
export const MAX_SUBTITLE_BYTES = 16 * 1024 * 1024
const MAX_FONTS = 64
const MAX_FONT_BYTES = 32 * 1024 * 1024
const QUICK_MS = 120_000
const lastLine = (s: string) => s.trim().split(/\r?\n/).pop() ?? ''

async function ffmpeg(bins: FfmpegBins, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const r = await runTool(bins.ffmpeg, ['-v', 'error', '-y', ...args], { timeoutMs, signal })
  if (r.code !== 0) throw new Error(`ffmpeg ${r.code}: ${lastLine(r.stderr)}`)
}

/** UTF-8 when it decodes cleanly, UTF-16 when it has a BOM, else Windows-1252 (Brazilian .srt files); never a BOM. */
export function decodeSubtitle(bytes: Uint8Array): string {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null
  let text: string
  if (bom) text = new TextDecoder(bom).decode(bytes)
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes)
    }
  }
  return text.replace(/^\uFEFF/, '')
}

/** SRT → WebVTT: header, LF line ends, and the decimal comma only on cue timing lines. */
export function srtToVtt(srt: string): string {
  const body = srt.replace(/\r\n?/g, '\n').replace(/^.*-->.*$/gm, (line) => line.replace(/(\d\d:\d\d),(\d{3})/g, '$1.$2'))
  return `WEBVTT\n\n${body}`
}

/** Text of embedded subtitle `0:s:<id>`: WebVTT for text formats, the ASS/SSA script as is. */
export async function extractSubtitle(bins: FfmpegBins, path: string, sub: Pick<CinemaSubtitleTrack, 'id' | 'format'>, dir: string, signal?: AbortSignal): Promise<string> {
  const out = join(dir, `s${sub.id}.${sub.format}`)
  const codec = sub.format === 'ass' ? ['-c:s', 'copy', '-f', 'ass'] : ['-c:s', 'webvtt', '-f', 'webvtt']
  await ffmpeg(bins, ['-i', path, '-map', `0:s:${sub.id}`, ...codec, out], QUICK_MS, signal)
  if ((await stat(out)).size > MAX_SUBTITLE_BYTES) throw new Error('subtitle too large')
  return decodeSubtitle(await readFile(out))
}

const FONT_RE = /\.(ttf|otf|ttc|woff2?)$/i

/**
 * Font attachments of the file, dumped one by one to `font-<i>.bin` in `dir`. Never `-dump_attachment:t ""`: that writes to
 * the attachment's own filename tag, which a hostile file can point anywhere on disk.
 */
export async function extractFonts(bins: FfmpegBins, path: string, dir: string, signal?: AbortSignal): Promise<{ name: string; file: string }[]> {
  const r = await runTool(bins.ffprobe, ['-v', 'error', '-select_streams', 't', '-show_entries', 'stream=index:stream_tags=filename,mimetype', '-of', 'json', '-i', path], { timeoutMs: QUICK_MS, signal })
  if (r.code !== 0) throw new Error(`ffprobe ${r.code}: ${lastLine(r.stderr)}`)
  const streams = (JSON.parse(r.stdout) as { streams?: { index?: unknown; tags?: Record<string, unknown> }[] }).streams ?? []
  const fonts = streams.flatMap((s) => {
    const tags = s.tags ?? {}
    const filename = typeof tags.filename === 'string' ? tags.filename : ''
    const mime = typeof tags.mimetype === 'string' ? tags.mimetype.toLowerCase() : ''
    const ok = Number.isInteger(s.index) && (/font|opentype/.test(mime) || FONT_RE.test(filename))
    return ok ? [{ index: s.index as number, name: capText(stripControls(filename).replace(/[\\/]/g, '_'), 120) || 'font' }] : []
  }).slice(0, MAX_FONTS)
  if (fonts.length === 0) return []
  const dumps = fonts.flatMap((f, i) => [`-dump_attachment:${f.index}`, join(dir, `font-${i}.bin`)])
  // The null output only exists so ffmpeg does not exit with "At least one output file must be specified".
  await ffmpeg(bins, [...dumps, '-i', path, '-map', `0:${fonts[0]!.index}`, '-f', 'null', '-'], QUICK_MS, signal)
  const out: { name: string; file: string }[] = []
  for (const [i, f] of fonts.entries()) {
    const file = join(dir, `font-${i}.bin`)
    const size = await stat(file).then((s) => s.size, () => 0)
    if (size > 0 && size <= MAX_FONT_BYTES) out.push({ name: f.name, file })
  }
  return out
}

/** Pixels at or above this luma count as blown out (also covers limited-range video, white = 235). */
const CLIP_LUMA = 235
const CLIP_SHARE = 0.05

/**
 * Poster: frames at 10/25/40 % of the film, 960 px wide WebP; the brightest one without blown highlights wins (if all are
 * blown, the least blown). Brightness from a 64x36 grayscale copy of each candidate.
 */
export async function makePoster(bins: FfmpegBins, path: string, videoIndex: number, durationS: number, out: string, signal?: AbortSignal): Promise<void> {
  const scored: { file: string; score: number }[] = []
  for (const [i, at] of [0.1, 0.25, 0.4].entries()) {
    const file = `${out}.c${i}.webp`
    const gray = `${out}.c${i}.gray`
    const v = `0:${videoIndex}`
    try {
      await ffmpeg(bins, [
        '-ss', (durationS * at).toFixed(3), '-i', path,
        '-map', v, '-frames:v', '1', '-vf', 'scale=960:-2', '-c:v', 'libwebp', '-quality', '80', file,
        '-map', v, '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', gray,
      ], QUICK_MS, signal)
      const px = await readFile(gray)
      if (px.length === 0) continue
      let sum = 0
      let blown = 0
      for (const y of px) {
        sum += y
        if (y >= CLIP_LUMA) blown++
      }
      scored.push({ file, score: blown / px.length > CLIP_SHARE ? -blown / px.length : sum / px.length })
    } finally {
      await rm(gray, { force: true })
    }
  }
  const best = scored.sort((a, b) => b.score - a.score)[0]
  if (!best) throw new Error('no poster frame')
  await rename(best.file, out)
  await Promise.all(scored.slice(1).map((c) => rm(c.file, { force: true })))
}

/** WebP caps both sides at 16383 px. */
const WEBP_MAX = 16383
export const THUMB_COLUMNS = 10
export const THUMB_WIDTH = 160
export const THUMB_EVERY_S = 10
/** Tile height for a film of `width`x`height`: 160·h/w rounded to the nearest even number. */
export const thumbHeight = (width: number, height: number) => Math.max(2, 2 * Math.round((THUMB_WIDTH / 2) * (height / width)))

/**
 * Timeline sprite: one 160 px tile per 10 s from t = 0, 10 per row, row-major. Keyframes only are decoded (fast); each tile
 * is the keyframe nearest its time. Films too long for one WebP lose their last tiles (portrait 2 h+, landscape 5 h+).
 */
export async function makeThumbs(bins: FfmpegBins, path: string, videoIndex: number, film: Pick<CinemaFilm, 'durationS' | 'width' | 'height'>, out: string, signal?: AbortSignal): Promise<void> {
  const h = thumbHeight(film.width, film.height)
  const rows = Math.min(Math.ceil(Math.max(1, Math.ceil(film.durationS / THUMB_EVERY_S)) / THUMB_COLUMNS), Math.floor(WEBP_MAX / h))
  await ffmpeg(bins, [
    '-skip_frame', 'nokey', '-i', path, '-map', `0:${videoIndex}`,
    '-vf', `fps=1/${THUMB_EVERY_S},scale=${THUMB_WIDTH}:${h},tile=${THUMB_COLUMNS}x${rows}`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '70', out,
  ], (120 + film.durationS) * 1000, signal)
}
