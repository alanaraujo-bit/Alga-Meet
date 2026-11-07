import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

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

// Season folders: 'Temporada 2', 'Season 02', 'S2', 'T02', 'Show S01', '2ª Temporada' (a bracketed year or tag is ignored).
const SEASON_DIR = /(?:^|[ ._-])(?:season|temporada|temp|saison|staffel|s|t)[ ._-]?(\d{1,2})$/i
const SEASON_DIR_ORDINAL = /^(\d{1,2})\s*(?:ª|º|a|o)?\s*(?:temporada|season)$/i
// Episode words when the name has no S01E02: 'E01', 'Ep01', 'Ep 01', 'Episódio 1', 'Capítulo 3'.
const EP_TOKEN = /^ep?(\d{1,3})$/i
const EP_WORD = /^(?:ep|episodio|episódio|episode|capitulo|capítulo|cap)$/i
const SEASON_TOKEN = /^s(\d{1,2})$/i
const LEAD_NUMBER = /^(\d{1,3})(?:-|$)/
// Files named by the bare episode token have no show name: they all share one key (same naming pattern, same folder).
const EPISODE_FIRST = '<episode-first>'
/** Never walk more than this: a show folder is small, a whole drive is not. */
const MAX_SEASON_DIRS = 64
const MAX_EPISODES = 2000

/** 'Temporada 2' -> { season: 2, prefix: '' }; 'Show S01' -> { season: 1, prefix: 'show' }; not a season folder -> null. */
export function seasonDir(name: string): { season: number; prefix: string } | null {
  const n = stripControls(name).replace(/[([][^)\]]*[)\]]/g, ' ').trim()
  const m = SEASON_DIR.exec(n)
  if (m) return { season: Number(m[1]), prefix: n.slice(0, m.index).trim().toLowerCase() }
  const o = SEASON_DIR_ORDINAL.exec(n)
  return o ? { season: Number(o[1]), prefix: '' } : null
}

interface Found { season: number; episode: number; start: number; end: number }
/** Where the episode sits in the name's tokens. Without S01E02/1x02, 'E02'/'Ep 2' take the folder's season (or 1); a bare leading number counts only inside a season folder. */
function findEpisode(ts: string[], folderSeason: number | null): Found | null {
  for (const [i, t] of ts.entries()) {
    const m = SEASON_EPISODE.exec(t) ?? NXM.exec(t)
    if (m) return { season: Number(m[1]), episode: Number(m[2]), start: i, end: i + 1 }
  }
  for (const [i, t] of ts.entries()) {
    const word = EP_WORD.test(t) ? /^(\d{1,3})$/.exec(ts[i + 1] ?? '') : null
    const n = EP_TOKEN.exec(t)?.[1] ?? word?.[1]
    if (n === undefined) continue
    const s = SEASON_TOKEN.exec(ts[i - 1] ?? '') // 'S01 E02'
    return { season: s ? Number(s[1]) : (folderSeason ?? 1), episode: Number(n), start: s ? i - 1 : i, end: word ? i + 2 : i + 1 }
  }
  const lead = folderSeason === null ? null : LEAD_NUMBER.exec(ts[0] ?? '')
  return lead && folderSeason !== null ? { season: folderSeason, episode: Number(lead[1]), start: 0, end: 1 } : null
}

export interface SeriesEpisode {
  path: string
  name: string
  season: number
  episode: number
  /** The episode's own title from the file name ('Piloto'), or ''. */
  title: string
}
export interface Series {
  /** The show's name: from the file names, else from the show's folder. */
  show: string
  /** The show's folder. Never leaves main. */
  root: string
  /** Every episode found, in (season, episode, name) order; `current` indexes the file asked about. */
  episodes: SeriesEpisode[]
  current: number
  /** The file's own name has no S01E02/1x02: its number came from 'Ep 2' or the folder layout. */
  fromFolder: boolean
}

interface Parsed extends SeriesEpisode { show: string; key: string }
function parse(dir: string, name: string, folderSeason: number | null): Parsed | null {
  const ts = tokens(stem(name))
  const f = findEpisode(ts, folderSeason)
  if (!f) return null
  const rest = ts.slice(f.end)
  while (rest[0] === '-') rest.shift()
  const words: string[] = []
  for (const t of rest) {
    if (isJunk(t) || YEAR.test(t)) break
    words.push(t)
  }
  while (words.at(-1) === '-') words.pop()
  const show = f.start > 0 ? cleanTitle(ts.slice(0, f.start).join(' ')).replace(/ \((19|20)\d{2}\)$/, '') : ''
  return {
    path: join(dir, name), name, season: f.season, episode: f.episode,
    title: capText(words.join(' ').trim(), 80).trim(),
    show, key: show ? show.toLowerCase() : EPISODE_FIRST,
  }
}

async function list(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
const isVideo = (e: Dirent): boolean => e.isFile() && VIDEO_EXTS.has(extname(e.name).toLowerCase())

/**
 * The show `path` belongs to, with every episode. Inside a season folder ('Temporada 1') the parent is the show's folder
 * and its sibling season folders count (same name prefix); a folder holding season folders counts them too. Otherwise
 * only the file's own folder, same show name. One level deep, no symlinks, video extensions only. null for a film or a
 * lone episode.
 */
export async function seriesOf(path: string): Promise<Series | null> {
  const dir = dirname(path)
  const cur = basename(path)
  const own = seasonDir(basename(dir))
  const root = own && dirname(dir) !== dir ? dirname(dir) : dir
  const top = await list(root)
  const prefix = own && root !== dir ? own.prefix : ''
  const seasons = top
    .filter((e) => e.isDirectory() && seasonDir(e.name)?.prefix === prefix)
    .slice(0, MAX_SEASON_DIRS)
    .map((e) => ({ dir: join(root, e.name), season: seasonDir(e.name)!.season }))
  // The parent may be unreadable (or not hold this folder after all): then only the file's own folder counts.
  const layout = seasons.length > 0 && (root === dir || seasons.some((s) => s.dir === dir))

  const self = parse(dir, cur, own?.season ?? null)
  if (!self) return null
  const found: Parsed[] = []
  const add = (d: string, entries: Dirent[], season: number | null) => {
    for (const e of entries) {
      if (found.length >= MAX_EPISODES) return
      if (!isVideo(e)) continue
      const p = parse(d, e.name, season)
      // In a show's folder only a differently named show is left out; a loose folder keeps the same show name only.
      if (p && (p.key === self.key || (layout && (p.key === EPISODE_FIRST || self.key === EPISODE_FIRST)))) found.push(p)
    }
  }
  if (layout) {
    add(root, top, null)
    for (const s of seasons) add(s.dir, await list(s.dir), s.season)
  } else {
    add(dir, root === dir ? top : await list(dir), own?.season ?? null)
  }
  found.sort((a, b) => a.season - b.season || a.episode - b.episode || a.name.localeCompare(b.name))
  const current = found.findIndex((e) => e.path === self.path)
  if (current < 0 || found.length < 2) return null
  const named = found.find((e) => e.show)?.show
  return {
    show: named || cleanTitle(basename(root)).replace(/ \((19|20)\d{2}\)$/, '') || 'Série',
    root,
    episodes: found.map(({ show: _s, key: _k, ...e }) => e),
    current,
    fromFolder: parseEpisode(cur) === null,
  }
}

/**
 * Episodes of the same show that come after `current`, in (season, episode) order, as full paths. `current` may be a
 * name inside `dir` or a path; season folders next to it count (seriesOf).
 */
export async function nextEpisodes(dir: string, current: string): Promise<string[]> {
  const s = await seriesOf(join(dir, basename(current)))
  if (!s) return []
  const at = s.episodes[s.current]!
  return s.episodes.filter((e) => e.season > at.season || (e.season === at.season && e.episode > at.episode)).map((e) => e.path)
}
