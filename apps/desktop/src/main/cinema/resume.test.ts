// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ResumeStore, WatchedStore, resumeKey, seriesKey, watchedAt } from './resume'

describe('WatchedStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-watched-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('marks once, survives a reload, keys shows apart', async () => {
    const file = join(dir, 'w.json')
    const s = new WatchedStore(file)
    const a = seriesKey('C:\\Series\\Show', 'Show')
    await s.mark(a, '1:1')
    await s.mark(a, '1:1')
    await s.mark(a, '1:2')
    expect([...(await new WatchedStore(file).get(a))]).toEqual(['1:1', '1:2'])
    expect((await s.get(seriesKey('C:\\Series\\Other', 'Show'))).size).toBe(0)
    expect(readFileSync(file, 'utf8')).not.toContain('Series')
  })
  it('watched from the last 120 s, or the last 10% of a short episode', () => {
    expect(watchedAt(3600)).toBe(3480)
    expect(watchedAt(600)).toBe(540)
  })
})

const dir = mkdtempSync(join(tmpdir(), 'alga-resume-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('resume key', () => {
  it('is stable for the same file and changes when it changes', async () => {
    const f = join(dir, 'a.mkv')
    writeFileSync(f, 'hello')
    utimesSync(f, 1000, 1000)
    const k1 = await resumeKey(f)
    expect(await resumeKey(f)).toBe(k1)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
    utimesSync(f, 2000, 2000)
    expect(await resumeKey(f)).not.toBe(k1) // mtime
    utimesSync(f, 1000, 1000)
    writeFileSync(f, 'hellO')
    utimesSync(f, 1000, 1000)
    expect(await resumeKey(f)).not.toBe(k1) // content, same size and mtime
  })
})

describe('resume store', () => {
  it('limits: < 60 s and > duration - 120 s give null', async () => {
    const s = new ResumeStore(join(dir, 'r1.json'))
    await s.set('a', 59, 3600)
    await s.set('b', 60, 3600)
    await s.set('c', 3480, 3600)
    await s.set('d', 3481, 3600)
    expect([await s.get('a'), await s.get('b'), await s.get('c'), await s.get('d'), await s.get('zz')]).toEqual([null, 60, 3480, null, null])
  })

  it('keeps 200 entries, dropping the least recently saved; persists atomically', async () => {
    const file = join(dir, 'r2.json')
    const s = new ResumeStore(file)
    for (let i = 0; i < 201; i++) await s.set(`k${i}`, 100, 3600, i)
    expect(await s.get('k0')).toBeNull()
    expect(await s.get('k1')).toBe(100)
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toHaveLength(200)
    expect(await new ResumeStore(file).get('k200')).toBe(100)
  })

  it('a corrupt file starts empty', async () => {
    const file = join(dir, 'r3.json')
    writeFileSync(file, '{not json')
    const s = new ResumeStore(file)
    expect(await s.get('x')).toBeNull()
    await s.set('x', 100, 3600)
    expect(await s.get('x')).toBe(100)
  })

  it('concurrent first calls share one load: nothing saved before is lost', async () => {
    const file = join(dir, 'r4.json')
    await new ResumeStore(file).set('a', 100, 3600)
    const s = new ResumeStore(file)
    const [a] = await Promise.all([s.get('a'), s.set('b', 200, 3600)])
    expect(a).toBe(100)
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(['a', 'b'])
  })
})
