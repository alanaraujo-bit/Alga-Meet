import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

// Title cleanup, episode recognition and "next episode" lookup for the cinema host. Pure string work plus one readdir.

export const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.webm', '.avi', '.ts', '.m2ts'])
const TITLE_MAX = 120

// C0/C1 controls and DEL. Bidi marks stay: escaping/isolation is the UI's job.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const SEASON_EPISODE = /^s(\d{1,2})[ ._-]?e(\d{1,3})(?!\d)/i
const NXM = /^(\d{1,2})x(\d{2,3})$/i
const YEAR = /^(19|20)\d{2}$/
// Release-name noise: resolution, source, codec, audio, HDR. Deliberately excludes words that are also real title words.
const JUNK =
  /^(\d{3,4}[pi]|[48]k|uhd|hdr10?\+?|hdr|dovi|hlg|sdr|web-?dl|web-?rip|bluray|blu-ray|bdrip|brrip|dvdrip|hdtv|remux|x26[45]|h\.?26[45]|hevc|10bit|8bit|ddp?\d?|dts(-hd)?|truehd|atmos|aac\d?|ac3|eac3|flac|opus|proper|repack|unrated|amzn|dsnp)$/i

export function stripControls(s: string): string {
  return s.replace(CONTROL, '')
}

/** Cap at `max` UTF-16 units (what zod's .max counts) without leaving a lone surrogate. */
export function capText(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

const stem = (fileName: string): string => stripControls(fileName).replace(/\.[a-z][a-z0-9]{1,3}$/i, '')
const tokens = (s: string): string[] =>
  s.replace(/\[[^\]]*\]/g, ' ').replace(/[()[\]]/g, ' ').split(/[._\s]+/).filter(Boolean)
const isJunk = (t: string): boolean => JUNK.test(t) || JUNK.test(t.split('-')[0] ?? '')
const isEpisodeToken = (t: string): boolean => SEASON_EPISODE.test(t) || NXM.test(t)

/** 'Duna.Parte.Dois.2024.2160p.WEB-DL.mkv' -> 'Duna Parte Dois (2024)'; episodes keep only the show name. */
export function cleanTitle(fileName: string): string {
  const all = tokens(stem(fileName))
  // A name that starts with the episode token ("S01E02 - Piloto") has no show name: the title is the text after it.
  const lead = all.length > 0 && isEpisodeToken(all[0]!)
  let src = lead ? all.slice(1) : all
  while (src[0] === '-') src = src.slice(1)
  const head: string[] = []
  for (const [i, t] of src.entries()) {
    if (i > 0 && (isEpisodeToken(t) || isJunk(t))) break
    head.push(t)
  }
  // The release year is the LAST year token before the junk ("Blade.Runner.2049.2017" -> "Blade Runner 2049 (2017)").
  const y = head.findLastIndex((t, i) => i > 0 && YEAR.test(t))
  const kept = y > 0 ? head.slice(0, y) : head
  while (kept.at(-1) === '-') kept.pop()
  let title = kept.join(' ').trim()
  if (!title) title = lead ? all[0]! : all.join(' ').trim() || 'Filme'
  if (y > 0 && title !== 'Filme') title += ` (${head[y]})`
  return capText(title, TITLE_MAX).trim() || 'Filme'
}

/** 'S01E02', 's1e2', '1x02' -> { season: 1, episode: 2 }; anything else (a year, 1920x1080) -> null. */
export function parseEpisode(fileName: string): { season: number; episode: number } | null {
  for (const t of tokens(stem(fileName))) {
    const m = SEASON_EPISODE.exec(t) ?? NXM.exec(t)
    if (m) return { season: Number(m[1]), episode: Number(m[2]) }
  }
  return null
}

// Files named by the bare episode token have no show name: they all share one key (same naming pattern, same folder).
const showKey = (fileName: string): string => (isEpisodeToken(tokens(stem(fileName))[0] ?? '') ? '<episode-first>' : cleanTitle(fileName)).replace(/ \((19|20)\d{2}\)$/, '').toLowerCase()

/**
 * Episodes of the same show that come after `current`, in (season, episode) order, as full paths inside `dir`.
 * Same folder only: no recursion, no symlinks or directories, video extensions only. `current` may be a name or a path.
 */
export async function nextEpisodes(dir: string, current: string): Promise<string[]> {
  const cur = basename(current)
  const at = parseEpisode(cur)
  if (!at) return []
  const key = showKey(cur)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const next: { season: number; episode: number; name: string }[] = []
  for (const e of entries) {
    if (!e.isFile() || e.name === cur || !VIDEO_EXTS.has(extname(e.name).toLowerCase())) continue
    const ep = parseEpisode(e.name)
    if (!ep || showKey(e.name) !== key) continue
    if (ep.season > at.season || (ep.season === at.season && ep.episode > at.episode)) next.push({ ...ep, name: e.name })
  }
  next.sort((a, b) => a.season - b.season || a.episode - b.episode || a.name.localeCompare(b.name))
  return next.map((n) => join(dir, n.name))
}
