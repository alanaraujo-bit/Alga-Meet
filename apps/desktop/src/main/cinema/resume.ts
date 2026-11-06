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

export class ResumeStore {
  /** The load itself is cached (not its result), so concurrent first calls share one read and one map. */
  private loading: Promise<Map<string, ResumeEntry>> | null = null
  private writing: Promise<void> = Promise.resolve()
  constructor(private readonly file: string) {}

  private load(): Promise<Map<string, ResumeEntry>> {
    return (this.loading ??= readFile(this.file, 'utf8').then(
      (text) => {
        const map = new Map<string, ResumeEntry>()
        const raw = JSON.parse(text) as Record<string, ResumeEntry>
        for (const [k, v] of Object.entries(raw)) {
          if (v && Number.isFinite(v.positionS) && Number.isFinite(v.durationS) && Number.isFinite(v.at)) map.set(k, v)
        }
        return map
      },
    ).catch(() => new Map<string, ResumeEntry>())) // missing or corrupt: start empty
  }

  async get(key: string): Promise<number | null> {
    return resumable((await this.load()).get(key))
  }

  async set(key: string, positionS: number, durationS: number, now = Date.now()): Promise<void> {
    const m = await this.load()
    m.set(key, { positionS, durationS, at: now })
    if (m.size > MAX_ENTRIES) {
      const oldest = [...m].sort((a, b) => a[1].at - b[1].at).slice(0, m.size - MAX_ENTRIES)
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
