import { basename, isAbsolute } from 'node:path'
import type { CinemaAudioTrack, CinemaFilm, CinemaSubtitleTrack } from '@alga/shared'
import { ffmpegBins, runTool } from './ffmpeg'
import { capText, cleanTitle, parseEpisode, stripControls } from './names'

// Maps `ffprobe -show_streams -show_format -show_chapters -of json` into the CinemaFilm that the server and the friends see
// (spec §6.3 compatibility table). Pure and total: any input yields a film or a CinemaProbeError, never an exception.

export type CinemaWarning = 'dv_profile5' | 'high_bitrate' | 'pgs_ignored' | 'audio_converted' | 'atmos_dropped' | 'tracks_truncated'
export type CinemaProbeError = 'no_video' | 'unsupported_video' | 'no_duration' | 'unreadable'
/** `videoStreamIndex`: absolute ffprobe stream index of the chosen video (Task 8 maps it with `-map 0:<index>`). */
export type CinemaProbeResult = { film: CinemaFilm; warnings: CinemaWarning[]; videoStreamIndex: number } | { error: CinemaProbeError }

// Caps of CinemaFilmSchema (packages/shared/src/cinema.ts).
const MAX_AUDIO = 32
const MAX_SUBS = 64
const MAX_CHAPTERS = 100
const MAX_TEXT = 120
const MAX_LANG = 16
const MAX_DIM = 16384
/** Track ids travel as `a<id>`/`s<id>` with at most 3 digits. */
const MAX_ORDINAL = 999
const HIGH_BITRATE_KBPS = 60_000
const MAX_CHANNELS = 8
const MAX_KBPS = 1_000_000_000
const PROBE_TIMEOUT_MS = 15_000
/** ffprobe JSON of a file with hundreds of chapters/tracks outgrows runTool's default 64 KiB tail. */
const PROBE_TAIL_MAX = 8 * 1024 * 1024

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null)
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.map(obj).filter((o): o is Obj => o !== null) : [])
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)
const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}
/** Tag lookup, case-insensitive (mkv: `language`, mp4/ogg variants differ). Sanitized, capped, null when empty. */
const tag = (s: Obj, name: string, max: number): string | null => {
  const tags = obj(s.tags)
  const key = tags && Object.keys(tags).find((k) => k.toLowerCase() === name)
  const v = key ? str(tags[key]) : null
  const t = v === null ? '' : capText(stripControls(v).trim(), max).trim()
  return t === '' ? null : t
}
const norm = (s: unknown): string => (str(s) ?? '').toLowerCase().replace(/[\s_]+/g, '')
const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0')
const bitDepth = (pixFmt: string | null): number => {
  const m = /(\d+)(?:le|be)$/.exec(pixFmt ?? '')
  return m ? Number(m[1]) : 8
}
const dd = (n: number): string => String(n).padStart(2, '0')

// ---- video ----------------------------------------------------------------------------------------------------------------

const STILL_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif', 'webp'])
const VIDEO_CODECS = { h264: 'h264', hevc: 'hevc', av1: 'av1', vp9: 'vp9' } as const

/**
 * Full MSE type for the stream copied into fMP4, codec string per RFC 6381 / the codec registries.
 * Fields ffprobe does not expose (HEVC/AV1 tier, HEVC constraint bits) are assumed as noted below.
 */
function videoMime(codec: CinemaFilm['videoCodec'], v: Obj, width: number, height: number): string {
  const level = num(v.level)
  const pix = str(v.pix_fmt)
  const depth = bitDepth(pix)
  const profile = norm(v.profile)
  const area = width * height
  switch (codec) {
    case 'h264': {
      // avc1.PPCCLL = profile_idc, constraint_set flags, level_idc (all hex bytes; ffprobe `level` already is level_idc).
      const table = new Map<string, [number, number]>(Object.entries({
        constrainedbaseline: [0x42, 0xc0], baseline: [0x42, 0x00], main: [0x4d, 0x00], extended: [0x58, 0x00],
        high: [0x64, 0x00], high10: [0x6e, 0x00], high10intra: [0x6e, 0x00], 'high4:2:2': [0x7a, 0x00], 'high4:2:2intra': [0x7a, 0x00],
        'high4:4:4predictive': [0xf4, 0x00], 'high4:4:4': [0xf4, 0x00],
      }) as [string, [number, number]][])
      const [pp, cc] = table.get(profile) ?? (depth > 8 ? [0x6e, 0x00] : [0x64, 0x00])
      const ll = level !== null && level > 0 && level < 256 ? level : height <= 1080 ? 0x28 : 0x33
      return `video/mp4; codecs="avc1.${hex(pp, 2)}${hex(cc, 2)}${hex(ll, 2)}"`
    }
    case 'hevc': {
      // hvc1.<general_profile_idc>.<compat flags hex>.L<general_level_idc>.<constraint bytes hex>.
      // Tier is assumed Main (L): ffprobe does not expose it. Constraint: B0 = progressive + non-packed + frame-only, 40 = interlaced.
      const idc = profile.startsWith('main10') ? 2 : profile.startsWith('mainstill') ? 3 : profile === 'main' ? 1 : profile.startsWith('main') || profile === 'rext' ? 4 : depth > 8 ? 2 : 1
      const compat = idc === 1 ? 0x6 : 1 << idc // Main sets flags 1 and 2; the others only their own.
      const lvl = level !== null && level > 0 ? level : height <= 1080 ? 120 : height <= 2160 ? 153 : 186
      const field = str(v.field_order)
      const constraint = field && field !== 'progressive' && field !== 'unknown' ? '40' : 'B0'
      return `video/mp4; codecs="hvc1.${idc}.${compat.toString(16).toUpperCase()}.L${lvl}.${constraint}"`
    }
    case 'av1': {
      // av01.<profile>.<seq_level_idx><tier>.<bit depth>; ffprobe `level` is seq_level_idx. Tier assumed Main (M).
      const p = profile === 'high' ? 1 : profile === 'professional' ? 2 : 0
      const lvl = level !== null && level >= 0 && level <= 31 ? level : area <= 2_228_224 ? 8 : area <= 8_912_896 ? 12 : 16
      return `video/mp4; codecs="av01.${p}.${dd(lvl)}M.${dd(depth)}"`
    }
    case 'vp9': {
      // vp09.<profile>.<level x10>.<bit depth>; profile from "Profile N", else from bit depth (chroma subsampling is not probed).
      const pm = /profile(\d)/.exec(profile)
      const p = pm ? Number(pm[1]) : depth > 8 ? 2 : 0
      const valid = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 52, 60, 61, 62]
      const sizes: [number, number][] = [[36864, 10], [73728, 11], [122880, 20], [245760, 21], [552960, 30], [983040, 31], [2_228_224, 40], [8_912_896, 50], [35_651_584, 60]]
      const lvl = level !== null && valid.includes(level) ? level : (sizes.find(([max]) => area <= max)?.[1] ?? 62)
      return `video/mp4; codecs="vp09.${dd(p)}.${dd(lvl)}.${dd(depth)}"`
    }
  }
}

function hdrOf(v: Obj): { hdr: CinemaFilm['hdr']; dvProfile5: boolean } {
  const dovi = list(v.side_data_list).find((d) => /dovi/i.test(str(d.side_data_type) ?? ''))
  const profile = dovi ? num(dovi.dv_profile) : null
  const transfer = str(v.color_transfer)
  // Profile 8 has an HDR10/HLG-compatible base layer, so it plays as hvc1 (Chromium has no dvh1). Profile 5 has none: warn.
  const hdr = profile === 8 ? 'dv8' : transfer === 'smpte2084' ? 'hdr10' : transfer === 'arib-std-b67' ? 'hlg' : 'sdr'
  return { hdr, dvProfile5: profile === 5 }
}

// ---- audio ----------------------------------------------------------------------------------------------------------------

const LOSSLESS = new Set(['truehd', 'mlp', 'alac', 'wavpack', 'ape', 'tta', 'mp4als'])

/**
 * Policy (docs/benchmarks/cinema-spike.md, Rulings R10/R24): aac/opus/flac copy (aac only up to 6 channels, opus/flac up to 8);
 * lossless (TrueHD, DTS-HD MA by profile, PCM, ...) -> flac; other lossy up to 6 channels -> aac, 7.1 -> opus. MP3 is converted
 * (Chromium refuses it in fMP4). More than 8 source channels are downmixed to 8 and never copied.
 */
function mapAudio(s: Obj, id: number): { track: CinemaAudioTrack; atmos: boolean } {
  const codec = (str(s.codec_name) ?? '').toLowerCase()
  const profile = (str(s.profile) ?? '').toLowerCase()
  const rawCh = num(s.channels)
  const raw = rawCh !== null && rawCh >= 1 ? Math.floor(rawCh) : 2
  const channels = Math.min(raw, MAX_CHANNELS)
  const dtsHdMa = codec === 'dts' && /hd ?ma|master audio/.test(profile)
  const lossless = LOSSLESS.has(codec) || codec === 'flac' || codec.startsWith('pcm_') || dtsHdMa
  const copy = (codec === 'aac' && raw <= 6) || (codec === 'opus' && raw <= 8) || (codec === 'flac' && raw <= 8)
  const out: CinemaAudioTrack['out'] = copy ? 'copy' : lossless ? 'flac' : channels <= 6 ? 'aac' : 'opus'
  // Codec of what the peers receive: the source's own when copied, else the encoder's.
  const outCodec = copy ? codec : out
  const mime =
    outCodec === 'opus' ? 'audio/mp4; codecs="opus"'
    : outCodec === 'flac' ? 'audio/mp4; codecs="flac"'
    : `audio/mp4; codecs="mp4a.40.${copy && profile === 'he-aac' ? 5 : copy && profile === 'he-aacv2' ? 29 : 2}"`
  const source = dtsHdMa ? 'dts-hd ma' : codec === 'dts' && /hd ?hra|high res/.test(profile) ? 'dts-hd hra' : codec || 'unknown'
  const lang = tag(s, 'language', MAX_LANG)
  return {
    track: {
      id, lang: lang === 'und' ? null : lang, title: tag(s, 'title', MAX_TEXT), sourceCodec: capText(source, 32),
      channels, out, mime, default: obj(s.disposition)?.default === 1,
    },
    atmos: (codec === 'truehd' || codec === 'eac3') && profile.includes('atmos'),
  }
}

// ---- subtitles ------------------------------------------------------------------------------------------------------------

const SUB_VTT = new Set(['subrip', 'srt', 'webvtt', 'mov_text', 'text'])
const SUB_ASS = new Set(['ass', 'ssa'])
const SUB_BITMAP = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'])

// ---- film -----------------------------------------------------------------------------------------------------------------

/**
 * `id` of audio/subtitle tracks is the stream's ordinal among streams of its kind in the source (ffmpeg `-map 0:a:<id>`),
 * so it survives truncation and ignored subtitle streams. Audio is listed default-first; when over a cap the first
 * MAX_AUDIO / MAX_SUBS / MAX_CHAPTERS are kept and 'tracks_truncated' is added.
 */
export function filmFromProbe(probe: unknown, fileName: string): CinemaProbeResult {
  const root = obj(probe)
  const format = obj(root?.format)
  if (!root || !format || !Array.isArray(root.streams)) return { error: 'unreadable' }
  const streams = list(root.streams)

  // Cover art can come as attached_pic or as a plain mjpeg/png stream: neither is the movie.
  const v = streams.find((s) => s.codec_type === 'video' && obj(s.disposition)?.attached_pic !== 1 && !STILL_CODECS.has((str(s.codec_name) ?? '').toLowerCase()))
  if (!v) return { error: 'no_video' }
  const name = str(v.codec_name)
  const videoCodec = name !== null && Object.hasOwn(VIDEO_CODECS, name) ? VIDEO_CODECS[name as keyof typeof VIDEO_CODECS] : null
  const width = num(v.width)
  const height = num(v.height)
  if (!videoCodec || !width || !height || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) {
    return { error: 'unsupported_video' }
  }
  const durationS = [num(format.duration), num(v.duration)].find((d): d is number => d !== null && d > 0)
  if (durationS === undefined) return { error: 'no_duration' }

  const size = num(format.size)
  const bps = num(format.bit_rate) ?? (size !== null && size > 0 ? (size * 8) / durationS : 0)
  // Absurd inputs can overflow to Infinity/NaN, which CinemaFilmSchema rejects: unknown -> 0, capped at 1 Tbps.
  const kbps = Math.round(bps / 1000)
  const bitrateKbps = Number.isFinite(kbps) ? Math.min(Math.max(kbps, 0), MAX_KBPS) : 0
  const { hdr, dvProfile5 } = hdrOf(v)

  const audio: { track: CinemaAudioTrack; atmos: boolean }[] = []
  const subtitles: CinemaSubtitleTrack[] = []
  let bitmapSubs = false
  let aOrd = 0
  let sOrd = 0
  for (const s of streams) {
    if (s.codec_type === 'audio') {
      if (aOrd <= MAX_ORDINAL) audio.push(mapAudio(s, aOrd))
      aOrd++
    } else if (s.codec_type === 'subtitle') {
      const codec = (str(s.codec_name) ?? '').toLowerCase()
      const id = sOrd++
      if (id > MAX_ORDINAL) continue
      if (SUB_BITMAP.has(codec)) bitmapSubs = true
      else if (SUB_VTT.has(codec) || SUB_ASS.has(codec)) {
        const lang = tag(s, 'language', MAX_LANG)
        subtitles.push({ id, lang: lang === 'und' ? null : lang, title: tag(s, 'title', MAX_TEXT), format: SUB_ASS.has(codec) ? 'ass' : 'vtt', external: false })
      }
    }
  }
  if (audio.length > 0 && !audio.some((a) => a.track.default)) audio[0]!.track.default = true
  const ordered = [...audio.filter((a) => a.track.default), ...audio.filter((a) => !a.track.default)]
  const keptAudio = ordered.slice(0, MAX_AUDIO)

  const chapters = list(root.chapters).flatMap((c) => {
    const t = num(c.start_time)
    return t !== null && t >= 0 ? [{ startS: t, title: tag(c, 'title', MAX_TEXT) ?? '' }] : []
  })
  const truncated = ordered.length > MAX_AUDIO || subtitles.length > MAX_SUBS || chapters.length > MAX_CHAPTERS

  const warnings: CinemaWarning[] = []
  if (dvProfile5) warnings.push('dv_profile5')
  if (bitrateKbps > HIGH_BITRATE_KBPS) warnings.push('high_bitrate')
  if (bitmapSubs) warnings.push('pgs_ignored')
  if (keptAudio.some((a) => a.track.out !== 'copy')) warnings.push('audio_converted')
  if (keptAudio.some((a) => a.atmos)) warnings.push('atmos_dropped')
  if (truncated) warnings.push('tracks_truncated')

  const film: CinemaFilm = {
    title: cleanTitle(fileName), durationS, width, height, hdr, videoCodec, videoMime: videoMime(videoCodec, v, width, height), bitrateKbps,
    audio: keptAudio.map((a) => a.track), subtitles: subtitles.slice(0, MAX_SUBS), chapters: chapters.slice(0, MAX_CHAPTERS),
    episode: parseEpisode(fileName),
  }
  return { film, warnings, videoStreamIndex: num(v.index) ?? streams.indexOf(v) }
}

/** Runs the bundled ffprobe (15 s) on an absolute path. Any failure (missing binary, bad file, junk output) is 'unreadable'. */
export async function probeFile(path: string): Promise<CinemaProbeResult> {
  // Absolute paths only: ffprobe would otherwise take "http://..." or "-flag" as an input spec.
  if (!isAbsolute(path)) return { error: 'unreadable' }
  try {
    const r = await runTool(ffmpegBins().ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', '-i', path], {
      timeoutMs: PROBE_TIMEOUT_MS, tailMax: PROBE_TAIL_MAX,
    })
    if (r.code !== 0) return { error: 'unreadable' }
    return filmFromProbe(JSON.parse(r.stdout), basename(path))
  } catch {
    return { error: 'unreadable' }
  }
}
