import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/*
 * "Continue from 1:02:13": a local memory of where each film file stopped. The key is derived from the file's content
 * (size + mtime + first 64 KiB), so it survives renames and moves but not edits. Main only: the path never leaves it.
 */

export interface ResumeEntry { positionS: number; durationS: number; at: number }
const MAX_ENTRIES = 200
const HEAD_BYTES = 64 * 1024
/** Below this the viewer barely started; within the last stretch the film is over. */
const MIN_S = 60
const TAIL_S = 120

export async function resumeKey(path: string): Promise<string> {
  const st = await stat(path)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return createHash('sha256').update(`${st.size}:${st.mtimeMs}:`).update(buf.subarray(0, bytesRead)).digest('hex')
  } finally {
    await fh.close()
  }
}

export const resumable = (e: ResumeEntry | undefined): number | null =>
  e && e.positionS >= MIN_S && e.positionS <= e.durationS - TAIL_S ? e.positionS : null

/** A small JSON map on disk: loaded once, the oldest entries (by `at`) dropped past `max`, every write atomic. */
class JsonMap<T extends { at: number }> {
  /** The load itself is cached (not its result), so concurrent first calls share one read and one map. */
  private loading: Promise<Map<string, T>> | null = null
  private writing: Promise<void> = Promise.resolve()
  constructor(private readonly file: string, private readonly valid: (v: T) => boolean, private readonly max: number) {}

  load(): Promise<Map<string, T>> {
    return (this.loading ??= readFile(this.file, 'utf8').then(
      (text) => {
        const map = new Map<string, T>()
        const raw = JSON.parse(text) as Record<string, T>
        for (const [k, v] of Object.entries(raw)) {
          if (v && Number.isFinite(v.at) && this.valid(v)) map.set(k, v)
        }
        return map
      },
    ).catch(() => new Map<string, T>())) // missing or corrupt: start empty
  }

  async put(key: string, value: T): Promise<void> {
    const m = await this.load()
    m.set(key, value)
    if (m.size > this.max) {
      const oldest = [...m].sort((a, b) => a[1].at - b[1].at).slice(0, m.size - this.max)
      for (const [k] of oldest) m.delete(k)
    }
    const json = JSON.stringify(Object.fromEntries(m))
    // Atomic: write a temp file, then rename over the real one. Writes are serialized.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, json)
      await rename(`${this.file}.tmp`, this.file)
    }).catch(() => {})
    await this.writing
  }
}

export class ResumeStore {
  private readonly map: JsonMap<ResumeEntry>
  constructor(file: string) {
    this.map = new JsonMap<ResumeEntry>(file, (v) => Number.isFinite(v.positionS) && Number.isFinite(v.durationS), MAX_ENTRIES)
  }

  async get(key: string): Promise<number | null> {
    return resumable((await this.map.load()).get(key))
  }

  set(key: string, positionS: number, durationS: number, now = Date.now()): Promise<void> {
    return this.map.put(key, { positionS, durationS, at: now })
  }
}

/*
 * Which episodes of a show were watched to the end, for the episode list ("assistido") and "Continuar a série". Keyed by
 * a hash of the show's folder and name (no path on disk); an episode is its "season:episode" code.
 */
export interface WatchedEntry { watched: string[]; at: number }
const MAX_SHOWS = 100
const MAX_CODES = 2000

export const seriesKey = (root: string, show: string): string =>
  createHash('sha256').update(`${root.toLowerCase()}\0${show.toLowerCase()}`).digest('hex')
export const episodeCode = (season: number, episode: number): string => `${season}:${episode}`
/** Watched: past the point where "Continuar de …" stops offering it (the last TAIL_S, or the last 10% of a short one). */
export const watchedAt = (durationS: number): number => Math.max(durationS * 0.9, durationS - TAIL_S)

export class WatchedStore {
  private readonly map: JsonMap<WatchedEntry>
  constructor(file: string) {
    this.map = new JsonMap<WatchedEntry>(file, (v) => Array.isArray(v.watched) && v.watched.every((c) => typeof c === 'string'), MAX_SHOWS)
  }

  async get(key: string): Promise<Set<string>> {
    return new Set((await this.map.load()).get(key)?.watched)
  }

  async mark(key: string, code: string, now = Date.now()): Promise<void> {
    const had = await this.get(key)
    if (had.has(code)) return
    await this.map.put(key, { watched: [...had, code].slice(-MAX_CODES), at: now })
  }
}
