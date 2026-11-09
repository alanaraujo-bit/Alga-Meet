import type { ReleaseItem, ReleaseNote } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { closeWelcome, highlightsOf, initialSeen, isQuiet, markViewed, pendingNotes, readSeen, shouldWelcome, unviewed, type Moment, type SeenState } from './logic'

const item = (id: string, highlight = false): ReleaseItem => ({ id, category: 'new', highlight, media: null })
const note = (version: string, items: ReleaseItem[] = [item(`${version}-a`, true), item(`${version}-b`)]): ReleaseNote => ({
  version,
  publishedAt: '2026-11-08T00:00:00Z',
  mine: {},
  content: { items, text: { 'pt-BR': { title: version, summary: '', items: Object.fromEntries(items.map((i) => [i.id, { title: i.id, body: '' }])) } } },
})
const notes = ['0.1.15', '0.1.14', '0.1.12', '0.1.10', '0.1.9'].map((v) => note(v))
const quiet: Moment = { inCall: false, gaming: false, overlay: false, attentive: true }

describe('first run', () => {
  it('an existing account gets the installed version; older ones are history', () => {
    const s = initialSeen(notes, '0.1.15', false)
    expect(s).toEqual({ lastSeen: null, viewed: ['0.1.14', '0.1.12', '0.1.10', '0.1.9'], snoozeUntil: 0 })
    expect(pendingNotes(notes, '0.1.15', s).map((n) => n.version)).toEqual(['0.1.15'])
  })

  it('a brand-new account sees nothing on its first day', () => {
    const s = initialSeen(notes, '0.1.15', true)
    expect(pendingNotes(notes, '0.1.15', s)).toEqual([])
    expect(unviewed(notes, s)).toEqual([])
  })

  it('nothing published for the installed version: no welcome', () => {
    const s = initialSeen(notes, '0.1.13', false)
    expect(pendingNotes(notes, '0.1.13', s)).toEqual([])
  })
})

describe('updates', () => {
  it('one version up: just that one', () => {
    const s: SeenState = { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 }
    expect(pendingNotes(notes, '0.1.15', s).map((n) => n.version)).toEqual(['0.1.15'])
  })

  it('skipped versions come together, newest first, capped', () => {
    const s: SeenState = { lastSeen: '0.1.9', viewed: [], snoozeUntil: 0 }
    expect(pendingNotes(notes, '0.1.15', s).map((n) => n.version)).toEqual(['0.1.15', '0.1.14', '0.1.12', '0.1.10'])
    expect(pendingNotes(notes, '0.1.12', s).map((n) => n.version)).toEqual(['0.1.12', '0.1.10'])
  })

  it('never announces a version above the installed one, nor after a downgrade', () => {
    const s: SeenState = { lastSeen: '0.1.12', viewed: [], snoozeUntil: 0 }
    expect(pendingNotes(notes, '0.1.14', s).map((n) => n.version)).toEqual(['0.1.14'])
    expect(pendingNotes(notes, '0.1.10', s)).toEqual([])
  })

  it('closing marks the newest shown as seen, so it never comes back', () => {
    const s: SeenState = { lastSeen: '0.1.9', viewed: ['0.1.9'], snoozeUntil: 123 }
    const shown = pendingNotes(notes, '0.1.15', s)
    const after = closeWelcome(s, shown)
    expect(after.lastSeen).toBe('0.1.15')
    expect(after.snoozeUntil).toBe(0)
    expect(pendingNotes(notes, '0.1.15', after)).toEqual([])
    expect(unviewed(notes, after)).toEqual([])
    // Survives a restart (what localStorage gets back).
    expect(readSeen(JSON.stringify(after))).toEqual(after)
  })

  it('never moves lastSeen backwards', () => {
    expect(closeWelcome({ lastSeen: '0.1.15', viewed: [], snoozeUntil: 0 }, [note('0.1.12')]).lastSeen).toBe('0.1.15')
  })
})

describe('the right moment', () => {
  it('never during a call, a game, another dialog or with the window away', () => {
    const p = [note('0.1.15')]
    const s: SeenState = { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 }
    expect(shouldWelcome(p, s, quiet, 0)).toBe(true)
    for (const busy of [{ inCall: true }, { gaming: true }, { overlay: true }, { attentive: false }]) {
      expect(isQuiet({ ...quiet, ...busy })).toBe(false)
      expect(shouldWelcome(p, s, { ...quiet, ...busy }, 0)).toBe(false)
    }
  })

  it('"Lembrar depois" waits until the snooze ends', () => {
    const s: SeenState = { lastSeen: '0.1.14', viewed: [], snoozeUntil: 1000 }
    expect(shouldWelcome([note('0.1.15')], s, quiet, 999)).toBe(false)
    expect(shouldWelcome([note('0.1.15')], s, quiet, 1000)).toBe(true)
  })
})

it('highlights: the highlighted items, or the first item of a version without any', () => {
  const plain = note('0.1.13', [item('x'), item('y')])
  expect(highlightsOf([note('0.1.15'), plain]).map((h) => h.item.id)).toEqual(['0.1.15-a', 'x'])
})

it('markViewed is idempotent', () => {
  const s = markViewed({ lastSeen: null, viewed: [], snoozeUntil: 0 }, '0.1.15')
  expect(markViewed(s, '0.1.15')).toBe(s)
})

it('readSeen tolerates garbage', () => {
  expect(readSeen(null)).toBeNull()
  expect(readSeen('{oops')).toBeNull()
  expect(readSeen('"x"')).toBeNull()
  expect(readSeen(JSON.stringify({ lastSeen: '1.0; drop', viewed: [1, '0.1.2'], snoozeUntil: 'soon' }))).toEqual({ lastSeen: null, viewed: ['0.1.2'], snoozeUntil: 0 })
})
