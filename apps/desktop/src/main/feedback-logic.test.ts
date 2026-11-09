import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CRASH_MAX_AGE_MS, clearMarker, countsAsCrash, previousSession, readMarker, tailLog, takeMarker, writeMarker } from './feedback-logic'

const now = 1_800_000_000_000
const m = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: 'renderer', at: now - 1000, version: '0.1.15', pid: 111, ...over })

describe('crash marker', () => {
  it('offers a marker left by another process', () => {
    expect(readMarker(m(), 222, now)).toEqual({ kind: 'renderer', at: now - 1000, version: '0.1.15', pid: 111 })
  })

  it('ignores our own marker, a stale one, an unknown kind and garbage', () => {
    expect(readMarker(m(), 111, now)).toBeNull()
    expect(readMarker(m({ at: now - CRASH_MAX_AGE_MS - 1 }), 222, now)).toBeNull()
    expect(readMarker(m({ kind: 'boom' }), 222, now)).toBeNull()
    expect(readMarker(m({ at: 'yesterday' }), 222, now)).toBeNull()
    expect(readMarker(m({ version: 15 }), 222, now)).toBeNull()
    for (const raw of [null, '', '{', '[]', '"x"', 'null']) expect(readMarker(raw, 222, now)).toBeNull()
  })

  it('counts real crashes only', () => {
    expect(['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit'].every(countsAsCrash)).toBe(true)
    expect(['clean-exit', 'killed'].some(countsAsCrash)).toBe(false)
  })
})

describe('crash marker file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-crash-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'crash-marker.json')
  const marker = (pid: number, kind: 'renderer' | 'unresponsive' = 'renderer') => ({ kind, at: now, version: '0.1.15', pid })

  it('the next session takes the marker once', () => {
    writeMarker(file, marker(111))
    expect(takeMarker(file, 222, now + 5000)).toEqual({ kind: 'renderer', at: now, version: '0.1.15' })
    expect(existsSync(file)).toBe(false)
    expect(takeMarker(file, 222, now + 5000)).toBeNull()
  })

  it('the session that wrote it does not take it, and keeps it for the next one', () => {
    writeMarker(file, marker(111))
    expect(takeMarker(file, 111, now)).toBeNull()
    expect(existsSync(file)).toBe(true)
    rmSync(file)
  })

  it('the first cause of a session wins', () => {
    writeMarker(file, marker(111, 'unresponsive'))
    writeMarker(file, marker(111, 'renderer'))
    expect(takeMarker(file, 222, now)?.kind).toBe('unresponsive')
  })

  it('a corrupt or stale file is removed and never offered', () => {
    writeFileSync(file, '{ not json')
    expect(takeMarker(file, 222, now)).toBeNull()
    expect(existsSync(file)).toBe(false)
    writeMarker(file, { ...marker(111), at: now - CRASH_MAX_AGE_MS - 1 })
    expect(takeMarker(file, 222, now)).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('a window that answers again clears only its own "unresponsive"', () => {
    writeMarker(file, marker(111, 'unresponsive'))
    clearMarker(file, 111, 'renderer')
    expect(existsSync(file)).toBe(true)
    clearMarker(file, 222, 'unresponsive')
    expect(existsSync(file)).toBe(true)
    clearMarker(file, 111, 'unresponsive')
    expect(existsSync(file)).toBe(false)
  })

  it('never throws when the folder is gone', () => {
    const gone = join(dir, 'nope', 'crash-marker.json')
    expect(() => writeMarker(gone, marker(111))).not.toThrow()
    expect(takeMarker(gone, 222, now)).toBeNull()
    expect(() => clearMarker(gone, 111, 'unresponsive')).not.toThrow()
  })
})

describe('recent log', () => {
  it('tails by lines and by bytes, never cutting a line', () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') + '\n'
    expect(tailLog(text).split('\n').filter(Boolean)).toHaveLength(200)
    expect(tailLog(text).trimEnd().endsWith('line 499')).toBe(true)
    // "á" is two bytes: the first line alone is 201 bytes and does not fit in 64.
    expect(tailLog('á'.repeat(100) + '\n' + 'b'.repeat(60) + '\n', 200, 64)).toBe('b'.repeat(60) + '\n')
  })

  it('returns nothing when not even the last line fits, and nothing for an empty log', () => {
    expect(tailLog('x'.repeat(100) + '\n', 200, 64)).toBe('')
    expect(tailLog('')).toBe('')
  })

  it('cuts the log at the start of the current session', () => {
    const log = '2026 INFO start v0.1.15 a\nold error\n2026 INFO start v0.1.15 b\nnew line\n'
    expect(previousSession(log)).toBe('2026 INFO start v0.1.15 a\nold error\n')
    expect(previousSession('no start line\n')).toBe('')
  })
})
