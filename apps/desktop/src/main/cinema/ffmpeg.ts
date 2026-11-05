import { spawn } from 'node:child_process'
import { constants, setPriority } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

// LGPL ffmpeg/ffprobe bundled as extraResources (scripts/fetch-ffmpeg.mjs fills build/ffmpeg). Main process only.

export interface FfmpegBins {
  ffmpeg: string
  ffprobe: string
}

let override: FfmpegBins | null = null
/** Tests only. */
export function setFfmpegBinsForTest(b: FfmpegBins | null): void {
  override = b
}

export function ffmpegBins(): FfmpegBins {
  if (override) return override
  const dir = app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'build', 'ffmpeg')
  return { ffmpeg: join(dir, 'ffmpeg.exe'), ffprobe: join(dir, 'ffprobe.exe') }
}

export type FfmpegCheck = { ok: true; version: string } | { ok: false; reason: 'missing' | 'blocked' | 'crashed'; detail: string }

/** Cap on the stdout/stderr tail returned by runTool (chars). */
export const TOOL_TAIL_MAX = 64 * 1024
/** After a kill, wait this long for the process to exit before force-killing its tree. */
const KILL_GRACE_MS = 2000

export interface RunOpts {
  timeoutMs: number
  signal?: AbortSignal
  /** When set, stdout is delivered line by line and NOT accumulated: the returned `stdout` is ''. */
  onStdoutLine?: (line: string) => void
  /** Cap on the returned stdout/stderr tail and on one unterminated line (default TOOL_TAIL_MAX). ffprobe JSON of big files needs more. */
  tailMax?: number
}

const tail = (acc: string, chunk: string, max: number): string => {
  const all = acc + chunk
  return all.length > max ? all.slice(all.length - max) : all
}

/** Returned stdout/stderr are only the last TOOL_TAIL_MAX chars. Timeout/abort reject (reason kept) only once the child is gone. */
export function runTool(bin: string, args: readonly string[], opts: RunOpts): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('aborted'))
    const max = opts.tailMax ?? TOOL_TAIL_MAX
    const child = spawn(bin, [...args], { windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    let pending = ''
    let settled = false
    let killReason: string | null = null
    let hard: NodeJS.Timeout | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(hard)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const kill = (why: string) => {
      if (killReason || settled) return
      killReason = why
      child.kill()
      hard = setTimeout(() => {
        if (child.pid !== undefined) spawn(`${process.env.SystemRoot ?? 'C:/Windows'}/System32/taskkill.exe`, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' }).on('error', () => {})
        finish(() => reject(new Error(why)))
      }, KILL_GRACE_MS)
    }
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs)
    const onAbort = () => kill('aborted')
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Best effort: the process may already be gone or the OS may refuse.
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (text: string) => {
      if (killReason || settled) return
      if (!opts.onStdoutLine) {
        stdout = tail(stdout, text, max)
        return
      }
      pending += text
      const parts = pending.split(/\r?\n/)
      pending = parts.pop() ?? ''
      // A line that never ends must not grow without bound: keep only its last `max` chars.
      if (pending.length > max) pending = pending.slice(pending.length - max)
      for (const l of parts) opts.onStdoutLine(l)
    })
    child.stderr.on('data', (text: string) => (stderr = tail(stderr, text, max)))
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => {
      if (killReason) return finish(() => reject(new Error(killReason!)))
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending)
      finish(() => resolve({ code: code ?? -1, stdout, stderr }))
    })
  })
}

/** Runs `ffmpeg -version` (5 s) and classifies the failure: absent, blocked by antivirus/policy, or crashing. */
export async function checkFfmpeg(args: readonly string[] = ['-version']): Promise<FfmpegCheck> {
  try {
    const r = await runTool(ffmpegBins().ffmpeg, args, { timeoutMs: 5000 })
    if (r.code !== 0) return { ok: false, reason: 'crashed', detail: `exit ${r.code}: ${r.stderr.slice(-300)}` }
    const m = /ffmpeg version (\S+)/.exec(r.stdout)
    return m?.[1] ? { ok: true, version: m[1] } : { ok: false, reason: 'crashed', detail: 'unexpected output' }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return { ok: false, reason: 'missing', detail: e.message }
    // UNKNOWN/EFTYPE: Windows refuses to load the exe. Antivirus quarantine and a corrupt file look the same and are fixed the same way.
    if (['EPERM', 'EACCES', 'UNKNOWN', 'EFTYPE'].includes(e.code ?? '')) return { ok: false, reason: 'blocked', detail: `bloqueado pelo antivírus ou arquivo corrompido (${e.code}): ${e.message}` }
    return { ok: false, reason: 'crashed', detail: e.message }
  }
}
