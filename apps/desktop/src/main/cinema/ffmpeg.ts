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

export interface RunOpts {
  timeoutMs: number
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
}

export function runTool(bin: string, args: readonly string[], opts: RunOpts): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('aborted'))
    const child = spawn(bin, [...args], { windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    let pending = ''
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const kill = (why: string) => {
      child.kill()
      done(() => reject(new Error(why)))
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
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stdout += text
      if (!opts.onStdoutLine) return
      pending += text
      const parts = pending.split(/\r?\n/)
      pending = parts.pop() ?? ''
      for (const l of parts) opts.onStdoutLine(l)
    })
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (err) => done(() => reject(err)))
    child.on('close', (code) => {
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending)
      done(() => resolve({ code: code ?? -1, stdout, stderr }))
    })
  })
}

/** Runs `ffmpeg -version` (5 s) and classifies the failure: absent, blocked by antivirus/policy, or crashing. */
export async function checkFfmpeg(args: readonly string[] = ['-version']): Promise<FfmpegCheck> {
  try {
    const r = await runTool(ffmpegBins().ffmpeg, args, { timeoutMs: 5000 })
    if (r.code !== 0) return { ok: false, reason: 'crashed', detail: `exit ${r.code}: ${r.stderr.slice(0, 300)}` }
    const m = /ffmpeg version (\S+)/.exec(r.stdout)
    return m?.[1] ? { ok: true, version: m[1] } : { ok: false, reason: 'crashed', detail: 'unexpected output' }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return { ok: false, reason: 'missing', detail: e.message }
    if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'UNKNOWN') return { ok: false, reason: 'blocked', detail: e.message }
    return { ok: false, reason: 'crashed', detail: e.message }
  }
}
