// How a film reads in the room (chips, track rows, the "Você assiste" choices). Pure, texts from strings.ts.
import type { CinemaAudioTrack, CinemaFilm, CinemaSubtitleTrack } from '@alga/shared'
import { t } from '../strings'

/** 4K / 1080p / 720p by either side, so a 2.39 film (1920×804) still reads 1080p. */
export function resolution(f: Pick<CinemaFilm, 'width' | 'height'>): string {
  if (f.width >= 3200 || f.height >= 2000) return '4K'
  if (f.width >= 1800 || f.height >= 1000) return '1080p'
  if (f.width >= 1200 || f.height >= 700) return '720p'
  return `${f.height}p`
}

/** "4K HDR" (card, top bar) or "4K · HDR10 · HEVC" (sheet chip, full). */
export function videoLabel(f: CinemaFilm, full = false): string {
  const hdr = f.hdr === 'sdr' ? null : full ? (t.film.hdr[f.hdr] ?? t.film.hdrShort) : t.film.hdrShort
  return full ? [resolution(f), hdr, t.film.video[f.videoCodec]].filter(Boolean).join(' · ') : [resolution(f), hdr].filter(Boolean).join(' ')
}

export const lang = (code: string | null): [string, string] => (code && t.film.langs[code.toLowerCase()]) || [code ? code.slice(0, 2).toUpperCase() : '··', t.film.unknownLang]
const isPt = (code: string | null): boolean => lang(code)[0] === 'PT'
export const codecName = (c: string): string => t.film.codecs[c.toLowerCase()] ?? c.toUpperCase()

export const defaultAudio = (f: CinemaFilm): CinemaAudioTrack | undefined => f.audio.find((a) => a.default) ?? f.audio[0]

/** "Dolby Digital → AAC 5.1" (converted) or "AAC Estéreo" (as is). */
export function audioRoute(a: CinemaAudioTrack): string {
  const ch = t.film.channels(a.channels)
  return a.out === 'copy' ? `${codecName(a.sourceCodec)} ${ch}` : `${codecName(a.sourceCodec)} → ${t.film.out[a.out]} ${ch}`
}

/** One audio row of the sheet: badge, name, kind, route. */
export function audioRow(a: CinemaAudioTrack): { code: string; name: string; kind: string; route: string } {
  const [code, name] = lang(a.lang)
  return { code, name: `${name} ${t.film.channels(a.channels)}`, kind: a.title ?? '', route: audioRoute(a) }
}

export function subtitleRow(s: CinemaSubtitleTrack): { code: string; name: string; kind: string } {
  const [code, name] = lang(s.lang)
  return { code, name: s.title ?? name, kind: t.film.sub[s.format] ?? '' }
}

/** Card meta: "2h46 · 4K HDR · Áudio 5.1". */
export function cardMeta(f: CinemaFilm, length: string): string[] {
  const a = defaultAudio(f)
  return [length, videoLabel(f), ...(a ? [t.film.audio(t.film.channels(a.channels))] : [])]
}

/**
 * "Você assiste" (foyer): one choice per audio track. A foreign-language track gets the Portuguese subtitle with it
 * ("Legendado · Inglês 5.1"); a track's own title names it otherwise ("Dublado · Português 5.1").
 */
export function watchOptions(f: CinemaFilm): { audioId: number; subtitleId: number | null; label: string }[] {
  const ptSub = f.subtitles.find((x) => isPt(x.lang))
  return f.audio.map((a) => {
    const [, name] = lang(a.lang)
    const subbed = !!ptSub && !isPt(a.lang)
    const kind = subbed ? t.film.subtitled : (a.title ?? (isPt(a.lang) && f.audio.length > 1 ? t.film.dubbed : null))
    return { audioId: a.id, subtitleId: subbed ? ptSub.id : null, label: [kind, `${name} ${t.film.channels(a.channels)}`].filter(Boolean).join(' · ') }
  })
}
