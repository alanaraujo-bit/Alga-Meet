import type { Message } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { anchorAt, estimateHeight, indexAt, prefixSums, segments, visibleRange, type Item } from './virtual'

const A = { id: 'a', username: 'ana', displayName: 'Ana', avatarUrl: null, accentColor: null, bio: '' }
const msg = (id: string, extra: Partial<Message> = {}): Message => ({
  id, channelId: 'c', author: A, content: 'oi', createdAt: '2026-11-01T12:00:00.000Z', editedAt: null, replyToId: null,
  reactions: [], attachments: [], nonce: null, ...extra,
}) as Message
const item = (id: string, head = false, extra: Partial<Message> = {}): Item => ({ kind: 'message', key: id, message: msg(id, extra), head })
const day = (k: string): Item => ({ kind: 'day', key: `day-${k}`, label: k })

/** Where the anchor's top lands in the viewport (0 = at the viewport top). */
const anchorScreenY = (offs: Float64Array, keys: string[], anchor: { key: string; delta: number }, scrollTop: number) =>
  offs[keys.indexOf(anchor.key)]! - scrollTop

describe('virtual list math', () => {
  const h = [10, 20, 30, 40]
  const offs = prefixSums(h)

  it('prefix sums and lookup', () => {
    expect([...offs]).toEqual([0, 10, 30, 60, 100])
    expect(indexAt(offs, -5)).toBe(0)
    expect(indexAt(offs, 0)).toBe(0)
    expect(indexAt(offs, 9.9)).toBe(0)
    expect(indexAt(offs, 10)).toBe(1)
    expect(indexAt(offs, 59)).toBe(2)
    expect(indexAt(offs, 1e9)).toBe(3)
    expect(indexAt(prefixSums([]), 10)).toBe(0)
  })

  it('visible range with overscan', () => {
    expect(visibleRange(offs, 25, 10, 0)).toEqual([1, 3])
    expect(visibleRange(offs, 25, 10, 100)).toEqual([0, 4])
    expect(visibleRange(prefixSums([]), 0, 100, 10)).toEqual([0, 0])
  })

  it('segments keep the total height and mount pinned rows out of range', () => {
    const big = prefixSums(Array.from({ length: 100 }, (_, i) => 10 + (i % 7)))
    const segs = segments(big, [40, 50], [3, 45, 97, 97, 200, -1])
    const mounted = segs.flatMap((s) => ('index' in s ? [s.index] : []))
    expect(mounted).toEqual([3, ...Array.from({ length: 10 }, (_, k) => 40 + k), 97])
    let y = 0
    for (const s of segs) {
      if ('gap' in s) y += s.gap
      else {
        expect(y).toBeCloseTo(big[s.index]!) // every mounted row sits exactly at its offset
        y += big[s.index + 1]! - big[s.index]!
      }
    }
    expect(y).toBeCloseTo(big[100]!)
    expect(segments(prefixSums([5, 5]), [0, 2], [])).toEqual([{ index: 0 }, { index: 1 }])
  })

  it('anchors on a message, not on the day separator above it', () => {
    const items = [day('1'), item('m1', true), item('m2')]
    const o = prefixSums([37, 60, 24])
    expect(anchorAt(items, o, 5)).toEqual({ key: 'm1', delta: 5 - 37 })
    expect(anchorAt(items, o, 100)).toEqual({ key: 'm2', delta: 3 })
    expect(anchorAt([], o, 0)).toBeNull()
  })

  it('prepending a page keeps the anchored row still', () => {
    const keys = Array.from({ length: 50 }, (_, i) => `m${100 + i}`)
    const items = keys.map((k) => item(k))
    const heights = keys.map((_, i) => 20 + (i % 5) * 9)
    const o1 = prefixSums(heights)
    const scrollTop = 333
    const anchor = anchorAt(items, o1, scrollTop)!
    const before = anchorScreenY(o1, keys, anchor, scrollTop)
    const older = Array.from({ length: 50 }, (_, i) => `m${String(i).padStart(3, '0')}`)
    const keys2 = [...older, ...keys]
    const o2 = prefixSums([...older.map(() => 47), ...heights])
    const restored = o2[keys2.indexOf(anchor.key)]! + anchor.delta
    expect(restored).toBe(scrollTop + 50 * 47)
    expect(anchorScreenY(o2, keys2, anchor, restored)).toBe(before)
  })

  it('a row above the anchor growing (image, reaction, edit) shifts the scroll by the same amount', () => {
    const keys = ['m1', 'm2', 'm3', 'm4']
    const items = keys.map((k) => item(k))
    const o1 = prefixSums([40, 40, 40, 40])
    const anchor = anchorAt(items, o1, 90)!
    expect(anchor.key).toBe('m3')
    const o2 = prefixSums([40, 40 + 180, 40, 40])
    expect(o2[keys.indexOf(anchor.key)]! + anchor.delta).toBe(90 + 180)
    // Below the anchor: nothing moves.
    const o3 = prefixSums([40, 40, 40, 40 + 180])
    expect(o3[keys.indexOf(anchor.key)]! + anchor.delta).toBe(90)
  })

  it('estimates grow with text, headers, replies, reactions and image boxes', () => {
    const base = estimateHeight(item('a'), 900)
    expect(estimateHeight(item('a', true), 900)).toBeGreaterThan(base)
    expect(estimateHeight(item('a', false, { content: 'x'.repeat(400) }), 900)).toBeGreaterThan(base)
    expect(estimateHeight(item('a', false, { content: 'x'.repeat(400) }), 500)).toBeGreaterThan(estimateHeight(item('a', false, { content: 'x'.repeat(400) }), 900))
    expect(estimateHeight(item('a', false, { replyToId: 'z' }), 900)).toBe(base + 22)
    expect(estimateHeight(item('a', false, { reactions: [{ emoji: '👍', count: 1, me: false }] }), 900)).toBe(base + 28)
    const img = (w: number, hh: number) => ({ id: 'f', filename: 'f.png', contentType: 'image/png', size: 1, url: 'x', width: w, height: hh })
    // 1280×720 fits 420 wide → 236 tall; 720×1080 hits the 320 cap.
    expect(estimateHeight(item('a', false, { attachments: [img(1280, 720)] }), 900)).toBe(base + 4 + 236)
    expect(estimateHeight(item('a', false, { attachments: [img(720, 1080)] }), 900)).toBe(base + 4 + 320)
    expect(estimateHeight({ kind: 'day', key: 'd', label: 'x' }, 900)).toBeGreaterThan(0)
  })
})
