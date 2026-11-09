/**
 * Pure rules behind the feedback bridges (feedback.ts): which crash is worth offering "quer me contar?" for, and which
 * part of main.log goes along with a bug report. No Electron import, so it runs in vitest.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { FEEDBACK_CRASH_KINDS, FEEDBACK_LOG_MAX_BYTES, FEEDBACK_LOG_MAX_LINES, type FeedbackCrashKind } from '@alga/shared'

/** Left on disk when a session ends badly; read once by the next one. */
export interface CrashMarker {
  kind: FeedbackCrashKind
  at: number
  version: string
  pid: number
}

/** An older crash is not worth asking about: the person no longer remembers what they were doing. */
export const CRASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** render-process-gone reasons that are a crash. A clean exit and a kill (Task Manager, shutdown) are not. */
export const countsAsCrash = (reason: string): boolean => reason !== 'clean-exit' && reason !== 'killed'

/** A marker worth offering: well-formed, written by another process, younger than 7 days. Anything else is null. */
export function readMarker(raw: string | null, pid: number, now: number): CrashMarker | null {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '')
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const { kind, at, version, pid: by } = v as Record<string, unknown>
  if (!(FEEDBACK_CRASH_KINDS as readonly unknown[]).includes(kind)) return null
  if (typeof at !== 'number' || typeof version !== 'string' || typeof by !== 'number') return null
  if (by === pid || now - at > CRASH_MAX_AGE_MS) return null
  return { kind: kind as FeedbackCrashKind, at, version, pid: by }
}

const read = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
const pidOf = (raw: string): unknown => {
  try {
    return (JSON.parse(raw) as { pid?: unknown } | null)?.pid
  } catch {
    return undefined
  }
}

/** Records how this session went wrong. The first cause wins; never throws (it runs while things are already bad). */
export function writeMarker(file: string, marker: CrashMarker): void {
  try {
    const raw = read(file)
    if (raw !== null && pidOf(raw) === marker.pid) return
    writeFileSync(file, JSON.stringify(marker))
  } catch {}
}

/** The crash the previous session left, read once. A marker of this very session stays for the next one. */
export function takeMarker(file: string, pid: number, now: number): Omit<CrashMarker, 'pid'> | null {
  const raw = read(file)
  if (raw === null || pidOf(raw) === pid) return null
  rmSync(file, { force: true })
  const m = readMarker(raw, pid, now)
  return m && { kind: m.kind, at: m.at, version: m.version }
}

/** Removes this session's marker of `kind` (the window answered again). */
export function clearMarker(file: string, pid: number, kind: FeedbackCrashKind): void {
  const raw = read(file)
  if (raw === null) return
  try {
    const m = JSON.parse(raw) as { pid?: unknown; kind?: unknown } | null
    if (m?.pid === pid && m.kind === kind) rmSync(file, { force: true })
  } catch {}
}

/** The last `maxLines` lines that fit in `maxBytes` (UTF-8). Whole lines only: a cut line reads as a different error. */
export function tailLog(text: string, maxLines = FEEDBACK_LOG_MAX_LINES, maxBytes = FEEDBACK_LOG_MAX_BYTES): string {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i]!) + 1
    if (bytes + size > maxBytes) break
    bytes += size
    out.unshift(lines[i]!)
  }
  return out.length ? out.join('\n') + '\n' : ''
}

/** The session before the current one: everything before the last "start v…" line log.ts writes at every launch. */
export function previousSession(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/ INFO start v\d/.test(lines[i]!)) return i === 0 ? '' : lines.slice(0, i).join('\n') + '\n'
  }
  return ''
}
